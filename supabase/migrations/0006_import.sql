-- Rootline : restaurer une sauvegarde (fichier exporté depuis Réglages > Exporter mes données).
--
-- Règle : on ajoute ce qui manque, on n'écrase rien.
--  - une plante déjà présente (même identifiant, ou même nom et même date de création, dans ce
--    foyer) est laissée telle quelle ;
--  - une plante absente est recréée, avec un nouvel identifiant si l'ancien est pris ailleurs ;
--  - les événements et les mesures déjà présents ne sont pas dupliqués ;
--  - le plan n'est repris que si le foyer n'en a pas.
-- Les photos sont renvoyées ensuite par l'app (stockage Supabase).

-- Plantes, événements et plan. Renvoie les plantes recréées : { "<ancien id>": "<nouvel id>" }.
create or replace function public.import_backup(p_household uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  old_id uuid;
  new_id uuid;
  plant public.plants;
  id_map jsonb := '{}'::jsonb;    -- toutes les plantes du fichier → leur id dans ce foyer
  created jsonb := '{}'::jsonb;   -- seulement celles recréées
  events_added integer := 0;
  n integer;
begin
  if not private.is_household_member(p_household) then
    raise exception 'not_allowed';
  end if;
  if p_data ->> 'format' is distinct from 'rootline-export' then
    raise exception 'bad_format';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_data -> 'plants', '[]'::jsonb)) loop
    old_id := (item ->> 'id')::uuid;
    if exists (select 1 from public.plants p where p.id = old_id and p.household_id = p_household) then
      id_map := id_map || jsonb_build_object(old_id::text, old_id);
      continue;
    end if;
    -- Déjà importée dans ce foyer sous un autre identifiant (même nom, même date de création).
    select p.id into new_id from public.plants p
    where p.household_id = p_household and p.name = item ->> 'name'
      and p.created_at = (item ->> 'created_at')::timestamptz
    limit 1;
    if new_id is not null then
      id_map := id_map || jsonb_build_object(old_id::text, new_id);
      continue;
    end if;
    new_id := case when exists (select 1 from public.plants p where p.id = old_id) then gen_random_uuid() else old_id end;

    plant := jsonb_populate_record(null::public.plants, item - 'photo');
    plant.id := new_id;
    plant.household_id := p_household;
    plant.photo_path := null; -- l'app renvoie la photo puis renseigne le chemin
    -- Un capteur ne peut être lié qu'à une seule plante.
    if plant.sensor_mac is not null and exists (select 1 from public.plants p where p.sensor_mac = plant.sensor_mac) then
      plant.sensor_mac := null;
    end if;
    plant.created_at := coalesce(plant.created_at, now());
    insert into public.plants select plant.*;

    id_map := id_map || jsonb_build_object(old_id::text, new_id);
    created := created || jsonb_build_object(old_id::text, new_id);
  end loop;

  -- Événements des plantes du fichier, sans doublon (même id, ou même plante + type + date).
  insert into public.events (id, household_id, plant_id, kind, source, occurred_at, note, created_by)
  select
    case when exists (select 1 from public.events x where x.id = (e ->> 'id')::uuid) then gen_random_uuid() else (e ->> 'id')::uuid end,
    p_household,
    (id_map ->> (e ->> 'plant_id'))::uuid,
    e ->> 'kind',
    coalesce(e ->> 'source', 'manual'),
    (e ->> 'occurred_at')::timestamptz,
    left(e ->> 'note', 500),
    null
  from jsonb_array_elements(coalesce(p_data -> 'events', '[]'::jsonb)) e
  where id_map ? (e ->> 'plant_id')
    and not exists (
      select 1 from public.events x
      where (x.id = (e ->> 'id')::uuid and x.household_id = p_household)
         or (x.plant_id = (id_map ->> (e ->> 'plant_id'))::uuid and x.kind = e ->> 'kind'
             and x.occurred_at = (e ->> 'occurred_at')::timestamptz)
    );
  get diagnostics events_added = row_count;

  -- Le plan, seulement si le foyer n'en a pas encore.
  update public.households h
  set floor_plan = p_data -> 'household' -> 'floor_plan'
  where h.id = p_household and h.floor_plan is null
    and jsonb_typeof(p_data -> 'household' -> 'floor_plan') = 'object';
  get diagnostics n = row_count;

  return jsonb_build_object('created', created, 'events_added', events_added, 'plan_restored', n > 0);
end;
$$;
revoke execute on function public.import_backup(uuid, jsonb) from public, anon;
grant execute on function public.import_backup(uuid, jsonb) to authenticated;

-- Mesures des capteurs, envoyées par paquets (l'app ne peut pas écrire dans readings directement).
create or replace function public.import_readings(p_household uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer;
begin
  if not private.is_household_member(p_household) then
    raise exception 'not_allowed';
  end if;
  insert into public.readings (household_id, sensor_mac, measured_at, moisture, conductivity, light, temperature, battery)
  select p_household, r.sensor_mac, r.measured_at, r.moisture, r.conductivity, r.light, r.temperature, r.battery
  from jsonb_to_recordset(p_rows) as r(
    sensor_mac text, measured_at timestamptz, moisture real, conductivity real, light real, temperature real, battery smallint
  )
  where r.sensor_mac is not null and r.measured_at is not null
    and not exists (
      select 1 from public.readings x
      where x.sensor_mac = r.sensor_mac and x.measured_at = r.measured_at
    );
  get diagnostics added = row_count;
  return added;
end;
$$;
revoke execute on function public.import_readings(uuid, jsonb) from public, anon;
grant execute on function public.import_readings(uuid, jsonb) to authenticated;
