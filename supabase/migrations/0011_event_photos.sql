-- Rootline : photos dans l'historique d'une plante.
--
-- Un nouveau type d'événement, « photo », avec une légende facultative (colonne note) pour suivre
-- l'évolution de la plante dans le temps. L'image est rangée dans le bucket plant-photos, sous
-- <foyer>/history/<plante>/<horodatage>.jpg : les règles de stockage existantes (dossier du foyer)
-- s'appliquent.

alter table public.events drop constraint if exists events_kind_check;
alter table public.events
  add constraint events_kind_check check (kind in ('water', 'fertilize', 'note', 'photo'));

alter table public.events add column if not exists photo_path text;

alter table public.events
  add constraint events_photo_path check ((kind = 'photo') = (photo_path is not null));
