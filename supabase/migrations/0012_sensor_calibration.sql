-- Rootline : calibration des capteurs d'humidité.
--
-- Un Flower Care ne monte pas à 100 % dans l'eau (souvent 70 à 90 %), et chaque exemplaire a sa
-- propre échelle. On note, par plante (donc pour le capteur qui lui est lié), la valeur brute du
-- capteur à l'air libre (sensor_dry → 0 %) et plongé dans l'eau (sensor_wet → 100 %).
-- La passerelle (ingest-readings) enregistre l'humidité calibrée dans readings.moisture et garde
-- la valeur brute dans readings.moisture_raw. Changer la calibration recalcule l'historique.

alter table public.plants
  add column sensor_dry real check (sensor_dry between 0 and 100),
  add column sensor_wet real check (sensor_wet between 0 and 100),
  add constraint plants_sensor_calibration_check check (sensor_wet is null or sensor_wet > coalesce(sensor_dry, 0));

alter table public.readings add column moisture_raw real;   -- valeur du capteur avant calibration
update public.readings set moisture_raw = moisture where moisture_raw is null;

-- Même règle que calibrate() dans supabase/functions/ingest-readings/detect.ts.
create or replace function public.calibrate_moisture(raw real, dry real, wet real)
returns real
language sql
immutable
set search_path = ''
as $$
  select case
    when raw is null or wet is null or wet <= coalesce(dry, 0) then raw
    else round(least(100, greatest(0, (raw - coalesce(dry, 0)) / (wet - coalesce(dry, 0)) * 100))::numeric, 1)::real
  end;
$$;

-- Recalcule l'humidité des mesures du capteur quand sa calibration (ou le capteur lié) change.
-- SECURITY DEFINER : l'app n'a pas le droit d'écrire dans readings.
create or replace function public.recalibrate_readings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sensor_mac is null then return new; end if;
  update public.readings r
     set moisture = public.calibrate_moisture(r.moisture_raw, new.sensor_dry, new.sensor_wet)
   where r.sensor_mac = new.sensor_mac
     and r.household_id = new.household_id
     and r.moisture_raw is not null;
  return new;
end;
$$;

revoke execute on function public.recalibrate_readings() from public, anon, authenticated;

create trigger plants_recalibrate_readings
  after insert or update of sensor_mac, sensor_dry, sensor_wet on public.plants
  for each row
  when (new.sensor_mac is not null)
  execute function public.recalibrate_readings();
