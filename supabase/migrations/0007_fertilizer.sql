-- Rootline : conseil d'engrais par plante.
--
-- La catégorie d'engrais est déduite du genre botanique par l'app et par la fonction des
-- rappels (supabase/functions/notifications/fertilizer.ts). Cette colonne ne sert que si
-- l'utilisateur choisit lui-même une autre catégorie ; vide = automatique.

alter table public.plants
  add column fertilizer_category text
  check (fertilizer_category in ('foliage', 'sensitive', 'flowering', 'succulent', 'orchid', 'acid', 'fern', 'citrus', 'none'));
