import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Care = {
  moisture_min: number | null
  moisture_max: number | null
  conductivity_min: number | null
  conductivity_max: number | null
  light_min: number | null
  interval_summer_days: number
  interval_winter_days: number
  source: 'openplantbook' | 'default'
  plantbook_pid: string | null
  /** Nom exact, ancien nom botanique, nom courant, ou genre seul (approximatif). */
  match: 'species' | 'synonym' | 'common' | 'genus' | null
}

export type Candidate = {
  scientificName: string
  commonName: string | null
  family: string | null
  score: number | null
  care: Care
}

type Result = { candidates: Candidate[]; error: string | null }

async function call(
  body: { image: string } | { query: string } | { species: string; commonName: string | null },
): Promise<Result> {
  const { data, error } = await supabase.functions.invoke('identify-plant', { body })
  if (error) {
    let message = "L'identification a échoué. Vérifie ta connexion et réessaie."
    if (error instanceof FunctionsHttpError) {
      try {
        message = (await error.context.json()).error ?? message
      } catch {
        /* réponse non JSON : on garde le message générique */
      }
    }
    return { candidates: [], error: message }
  }
  return { candidates: (data?.candidates ?? []) as Candidate[], error: null }
}

/** Identifie l'espèce à partir d'une photo (JPEG en base64) et propose ses seuils. */
export const identifyPhoto = (base64: string) => call({ image: base64 })

/** Recherche une espèce par son nom (au moins 3 lettres). */
export const searchSpecies = (query: string) => call({ query })

/** Recalcule les besoins d'une espèce déjà enregistrée. */
export async function careForSpecies(species: string, commonName: string | null) {
  const r = await call({ species, commonName })
  return { care: r.candidates[0]?.care ?? null, error: r.error }
}
