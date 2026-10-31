import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && key)

// Noté avant createClient, qui efface ensuite les jetons de l'adresse :
// la page a-t-elle été ouverte par le lien de connexion de l'e-mail ?
export const openedFromEmailLink = /[#&?](access_token|code|token_hash)=/.test(window.location.href)

// La clé publishable est publique par conception : l'accès aux données est
// protégé par la connexion et par les règles RLS de la base.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
