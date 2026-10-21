-- Rootline : diagnostics de santé des plantes.
--
-- Un diagnostic = une photo et/ou une question, la réponse de l'IA (Mistral) et les maladies
-- probables proposées par Pl@ntNet. Il est gardé dans l'historique de la plante.
-- La photo est rangée dans le bucket plant-photos, sous <foyer>/diagnostics/<id>.jpg :
-- les règles de stockage existantes (dossier du foyer) s'appliquent.

create table public.diagnoses (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  plant_id      uuid not null references public.plants(id) on delete cascade,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  question      text check (question is null or char_length(question) <= 2000),
  answer        text not null check (char_length(answer) <= 20000),
  diseases      jsonb not null default '[]'::jsonb,   -- [{ name, description, score }] de Pl@ntNet
  photo_path    text,
  model         text                                  -- modèle qui a répondu (ex. mistral-medium-latest)
);

create index diagnoses_plant_time_idx on public.diagnoses(plant_id, created_at desc);

alter table public.diagnoses enable row level security;

create policy "membres : lire les diagnostics" on public.diagnoses
  for select to authenticated using (private.is_household_member(household_id));
create policy "membres : ajouter des diagnostics" on public.diagnoses
  for insert to authenticated with check (
    private.is_household_member(household_id)
    and exists (select 1 from public.plants p where p.id = plant_id and p.household_id = diagnoses.household_id)
  );
create policy "membres : modifier un diagnostic" on public.diagnoses
  for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy "membres : supprimer des diagnostics" on public.diagnoses
  for delete to authenticated using (private.is_household_member(household_id));
