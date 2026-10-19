-- Rootline : schéma initial
-- À exécuter une fois dans Supabase > SQL Editor (ou via `supabase db push`).
-- Toutes les données sont rattachées à un foyer (household) ; chaque utilisateur
-- ne voit que les foyers dont il est membre (Row Level Security).

-- ---------------------------------------------------------------------------
-- Foyers et membres
-- ---------------------------------------------------------------------------
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Mon foyer',
  created_at  timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members(user_id);

-- Vrai si l'utilisateur connecté est membre du foyer.
-- SECURITY DEFINER pour éviter la récursion des politiques RLS sur household_members.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

-- Chaque nouvel utilisateur reçoit automatiquement son propre foyer.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
  insert into public.households (name) values ('Mon foyer') returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Plantes
-- ---------------------------------------------------------------------------
create table public.plants (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 80),
  species               text,                 -- nom scientifique (Pl@ntNet)
  species_common        text,                 -- nom courant
  photo_path            text,                 -- chemin dans le bucket plant-photos
  room                  text,                 -- Salon, Chambre…
  window_orientation    text check (window_orientation in ('N','NE','E','SE','S','SO','O','NO')),
  map_x                 real check (map_x between 0 and 1),   -- position sur le plan (0–1)
  map_y                 real check (map_y between 0 and 1),
  notes                 text,
  sensor_mac            text unique,          -- adresse du capteur Flower Care lié
  moisture_min          smallint check (moisture_min between 0 and 100),
  moisture_max          smallint check (moisture_max between 0 and 100),
  conductivity_min      integer check (conductivity_min >= 0),   -- µS/cm
  conductivity_max      integer check (conductivity_max >= 0),
  light_min             integer check (light_min >= 0),          -- lux
  interval_summer_days  smallint check (interval_summer_days between 1 and 90),
  interval_winter_days  smallint check (interval_winter_days between 1 and 90),
  created_at            timestamptz not null default now(),
  archived_at           timestamptz
);

create index plants_household_idx on public.plants(household_id);

-- ---------------------------------------------------------------------------
-- Mesures des capteurs (écrites par la passerelle via une fonction dédiée)
-- ---------------------------------------------------------------------------
create table public.readings (
  id            bigint generated always as identity primary key,
  household_id  uuid not null references public.households(id) on delete cascade,
  sensor_mac    text not null,
  measured_at   timestamptz not null default now(),
  moisture      real,      -- %
  conductivity  real,      -- µS/cm
  light         real,      -- lux
  temperature   real,      -- °C
  battery       smallint   -- %
);

create index readings_sensor_time_idx on public.readings(sensor_mac, measured_at desc);
create index readings_household_time_idx on public.readings(household_id, measured_at desc);

-- ---------------------------------------------------------------------------
-- Événements : arrosages, engrais, notes
-- ---------------------------------------------------------------------------
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  plant_id      uuid not null references public.plants(id) on delete cascade,
  kind          text not null check (kind in ('water', 'fertilize', 'note')),
  source        text not null default 'manual' check (source in ('manual', 'auto')),
  occurred_at   timestamptz not null default now(),
  note          text,
  created_by    uuid references auth.users(id) on delete set null default auth.uid()
);

create index events_plant_time_idx on public.events(plant_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Abonnements aux notifications push (un par appareil)
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.plants             enable row level security;
alter table public.readings           enable row level security;
alter table public.events             enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "membres : lire le foyer" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "membres : renommer le foyer" on public.households
  for update to authenticated using (public.is_household_member(id));

create policy "membres : voir les membres" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));

create policy "membres : lire les plantes" on public.plants
  for select to authenticated using (public.is_household_member(household_id));
create policy "membres : ajouter des plantes" on public.plants
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "membres : modifier les plantes" on public.plants
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
create policy "membres : supprimer des plantes" on public.plants
  for delete to authenticated using (public.is_household_member(household_id));

-- Les mesures sont en lecture seule pour l'app ; la passerelle écrit via une
-- fonction serveur qui utilise la clé de service.
create policy "membres : lire les mesures" on public.readings
  for select to authenticated using (public.is_household_member(household_id));

create policy "membres : lire les événements" on public.events
  for select to authenticated using (public.is_household_member(household_id));
create policy "membres : ajouter des événements" on public.events
  for insert to authenticated with check (
    public.is_household_member(household_id)
    and exists (select 1 from public.plants p where p.id = plant_id and p.household_id = events.household_id)
  );
create policy "membres : supprimer des événements" on public.events
  for delete to authenticated using (public.is_household_member(household_id));

create policy "chacun : ses abonnements" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Photos des plantes : bucket privé, un dossier par foyer
-- (chemin : <household_id>/<plant_id>.jpg)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do nothing;

create policy "membres : lire les photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'plant-photos' and public.is_household_member(((storage.foldername(name))[1])::uuid));
create policy "membres : envoyer des photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plant-photos' and public.is_household_member(((storage.foldername(name))[1])::uuid));
create policy "membres : remplacer des photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'plant-photos' and public.is_household_member(((storage.foldername(name))[1])::uuid));
create policy "membres : supprimer des photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plant-photos' and public.is_household_member(((storage.foldername(name))[1])::uuid));
