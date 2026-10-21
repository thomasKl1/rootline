-- Rootline : partager le suivi avec d'autres personnes de la maison.
--
-- Un membre crée une invitation (lien valable 7 jours, utilisable une seule fois). La personne
-- invitée ouvre le lien, se connecte, puis rejoint le foyer : mêmes plantes, même plan, mêmes
-- rappels. Le propriétaire peut retirer un membre ; un membre peut quitter le foyer. Toute
-- personne sans foyer en reçoit aussitôt un nouveau, vide, pour que l'app fonctionne toujours.

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  token         text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_by   uuid references auth.users(id) on delete set null
);

create index invitations_household_idx on public.invitations(household_id);

alter table public.invitations enable row level security;

create policy "membres : voir les invitations" on public.invitations
  for select to authenticated using (private.is_household_member(household_id));
create policy "membres : inviter" on public.invitations
  for insert to authenticated
  with check (private.is_household_member(household_id) and created_by = (select auth.uid()));
create policy "membres : annuler une invitation" on public.invitations
  for delete to authenticated using (private.is_household_member(household_id));

-- L'ordre des membres sert à choisir le foyer affiché : on indexe la date d'arrivée.
create index household_members_user_joined_idx on public.household_members(user_id, joined_at desc);

-- ---------------------------------------------------------------------------
-- Fonctions internes
-- ---------------------------------------------------------------------------

-- Donne un foyer vide à un utilisateur qui n'en a plus (après un départ ou un retrait).
create or replace function private.ensure_household(uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
  if exists (select 1 from public.household_members where user_id = uid) then
    return;
  end if;
  insert into public.households (name) values ('Mon foyer') returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, uid, 'owner');
end;
$$;
revoke execute on function private.ensure_household(uuid) from public, anon, authenticated;

-- Nom affichable d'un utilisateur : son nom Google s'il en a un, sinon le début de son e-mail.
create or replace function private.display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
  from auth.users u where u.id = uid;
$$;
revoke execute on function private.display_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions appelées par l'app
-- ---------------------------------------------------------------------------

-- Aperçu d'une invitation, lisible avant connexion (le jeton fait office de secret).
create or replace function public.invitation_preview(p_token text)
returns table (inviter text, status text, is_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.display_name(i.created_by),
    case
      when i.accepted_at is not null then 'used'
      when i.expires_at < now() then 'expired'
      else 'valid'
    end,
    -- Vrai si la personne connectée fait déjà partie du foyer (elle ouvre son propre lien).
    exists (select 1 from public.household_members m where m.household_id = i.household_id and m.user_id = (select auth.uid()))
  from public.invitations i
  where i.token = p_token;
$$;
revoke execute on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;

-- Rejoindre le foyer d'une invitation. Le foyer vide créé à l'inscription est supprimé ;
-- un compte qui suit déjà des plantes doit d'abord les supprimer (pas de fusion).
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inv public.invitations;
  other uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'invitation_not_found';
  end if;

  -- Déjà membre (lien ouvert deux fois) : rien à faire.
  if exists (select 1 from public.household_members where household_id = inv.household_id and user_id = uid) then
    return inv.household_id;
  end if;

  if inv.accepted_at is not null then
    raise exception 'invitation_used';
  end if;
  if inv.expires_at < now() then
    raise exception 'invitation_expired';
  end if;

  -- Les autres foyers de l'utilisateur doivent être vides et à lui seul : on les supprime.
  for other in select m.household_id from public.household_members m where m.user_id = uid loop
    if exists (select 1 from public.plants p where p.household_id = other) then
      raise exception 'has_plants';
    end if;
    if exists (select 1 from public.household_members m where m.household_id = other and m.user_id <> uid) then
      raise exception 'has_members';
    end if;
  end loop;
  delete from public.households h
  where h.id in (select m.household_id from public.household_members m where m.user_id = uid);

  insert into public.household_members (household_id, user_id, role) values (inv.household_id, uid, 'member');
  update public.invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.household_id;
end;
$$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- Les personnes du foyer de l'utilisateur connecté, avec leur e-mail.
create or replace function public.household_people()
returns table (user_id uuid, name text, email text, role text, joined_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, private.display_name(m.user_id), u.email::text, m.role, m.joined_at, m.user_id = (select auth.uid())
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id in (select household_id from public.household_members where user_id = (select auth.uid()))
  order by m.role = 'owner' desc, m.joined_at;
$$;
revoke execute on function public.household_people() from public, anon;
grant execute on function public.household_people() to authenticated;

-- Le propriétaire retire un membre ; celui-ci repart avec un foyer vide.
create or replace function public.remove_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hid uuid;
begin
  select m.household_id into hid
  from public.household_members m
  where m.user_id = uid and m.role = 'owner'
    and exists (select 1 from public.household_members x where x.household_id = m.household_id and x.user_id = p_user);
  if hid is null or p_user = uid then
    raise exception 'not_allowed';
  end if;
  delete from public.household_members where household_id = hid and user_id = p_user;
  perform private.ensure_household(p_user);
end;
$$;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- Un membre quitte le foyer ; le propriétaire ne peut pas partir (il retire les autres).
create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if exists (select 1 from public.household_members where user_id = uid and role = 'owner') then
    raise exception 'owner_cannot_leave';
  end if;
  delete from public.household_members where user_id = uid;
  perform private.ensure_household(uid);
end;
$$;
revoke execute on function public.leave_household() from public, anon;
grant execute on function public.leave_household() to authenticated;
