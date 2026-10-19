-- Rootline : sortir les fonctions internes de l'API publique.
-- L'analyse de sécurité Supabase signale que handle_new_user() et is_household_member()
-- sont appelables via /rest/v1/rpc/… Elles ne sont utiles qu'en interne (déclencheur et
-- règles RLS) : on les range dans un schéma « private », non exposé par l'API.
-- Les règles RLS et le déclencheur référencent les fonctions par identifiant interne :
-- ils continuent de fonctionner après le déplacement.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.handle_new_user() set schema private;
alter function public.is_household_member(uuid) set schema private;

-- Le déclencheur s'exécute avec les droits du propriétaire : personne n'a besoin de l'appeler.
revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- Les règles RLS sont évaluées avec le rôle de l'utilisateur connecté : il doit pouvoir
-- exécuter la fonction, mais plus via l'API puisqu'elle n'est plus dans « public ».
revoke execute on function private.is_household_member(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;
