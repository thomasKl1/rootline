-- Rootline : rappels quotidiens et notifications push.
--
-- Fonctionnement : une tâche planifiée appelle la fonction notifications toutes les heures.
-- La fonction n'envoie le récapitulatif d'un foyer qu'à SON heure de rappel (8 h par défaut,
-- dans son fuseau horaire), une seule fois par jour, et seulement s'il y a des plantes à arroser.
--
-- ⚠️ Avant d'exécuter ce fichier sur ta propre instance, remplace <ton-projet> ci-dessous
--    par l'identifiant de ton projet Supabase (ex. abcdefghijklmnop).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Heure et fuseau du récapitulatif, par foyer.
alter table public.households
  add column timezone text not null default 'Europe/Paris',
  add column reminder_hour smallint not null default 8 check (reminder_hour between 0 and 23);

-- Configuration réservée au serveur : clés VAPID des notifications, secret de la tâche planifiée.
-- RLS activée sans aucune règle : ni l'app ni l'API publique ne peuvent la lire.
create table public.app_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

insert into public.app_config (key, value) values
  ('cron_secret', to_jsonb(encode(extensions.gen_random_bytes(32), 'hex'))),
  ('functions_url', to_jsonb('https://<ton-projet>.supabase.co/functions/v1'::text));

-- Récapitulatifs déjà envoyés : un par foyer et par jour (date locale du foyer).
create table public.reminders_sent (
  household_id  uuid not null references public.households(id) on delete cascade,
  local_date    date not null,
  plant_names   text[] not null default '{}',
  sent_at       timestamptz not null default now(),
  primary key (household_id, local_date)
);
alter table public.reminders_sent enable row level security;
revoke all on public.reminders_sent from anon, authenticated;

-- Appel horaire de la fonction (à la minute 2 de chaque heure).
select cron.schedule(
  'rootline-reminders',
  '2 * * * *',
  $$
  select net.http_post(
    url := (select value #>> '{}' from public.app_config where key = 'functions_url') || '/notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value #>> '{}' from public.app_config where key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
