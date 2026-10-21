-- Rootline : plan de l'appartement.
--
-- Le plan est rangé dans le foyer, au format JSON (voir README, « Le plan de l'appartement ») :
-- pièces (polygones), fenêtres (segments avec l'orientation de leur façade) et direction du nord.
-- La position de chaque plante sur le plan est déjà dans plants.map_x / map_y (0–1).

alter table public.households
  add column floor_plan jsonb
  check (floor_plan is null or (jsonb_typeof(floor_plan) = 'object' and floor_plan ? 'rooms'));

comment on column public.households.floor_plan is
  'Plan de l''appartement : { width, height, north, rooms: [{ name, points }], windows: [{ room, from, to, orientation }] }';

-- Les événements (arrosage, engrais, note) peuvent porter un texte libre : on le borne.
alter table public.events
  add constraint events_note_length check (note is null or char_length(note) <= 500);
