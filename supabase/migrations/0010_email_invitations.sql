-- Rootline : inviter quelqu'un par e-mail.
--
-- Une invitation peut désormais viser une adresse e-mail. L'app envoie à cette adresse l'e-mail de
-- connexion de Rootline (lien + code) ; une fois connectée avec cette adresse, la personne se voit
-- proposer de rejoindre le foyer, sans avoir besoin du lien. Une invitation par e-mail ne peut être
-- acceptée que par cette adresse. Les invitations par lien (sans e-mail) ne changent pas.

alter table public.invitations
  add column email text check (email is null or (email = lower(email) and email like '%_@_%'));

create index invitations_email_idx on public.invitations(email) where email is not null;

-- L'invitation par e-mail encore valable de la personne connectée (la plus récente), s'il y en a une.
-- Le jeton n'est rendu qu'à la personne dont l'adresse est celle de l'invitation.
create or replace function public.my_email_invitation()
returns table (token text, inviter text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.token, private.display_name(i.created_by)
  from public.invitations i
  where i.email = lower((select auth.email()))
    and i.accepted_at is null
    and i.expires_at > now()
    and not exists (
      select 1 from public.household_members m
      where m.household_id = i.household_id and m.user_id = (select auth.uid())
    )
  order by i.created_at desc
  limit 1;
$$;
revoke execute on function public.my_email_invitation() from public, anon;
grant execute on function public.my_email_invitation() to authenticated;

-- Rejoindre le foyer d'une invitation (version 0005), avec en plus le contrôle de l'adresse.
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
  if inv.email is not null and inv.email <> lower(coalesce((select auth.email()), '')) then
    raise exception 'wrong_email';
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
