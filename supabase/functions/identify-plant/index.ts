// Rootline — identification d'une plante et propositions de seuils.
//
// POST { image: "<jpeg en base64>" }  → identification Pl@ntNet, puis seuils Open Plantbook
// POST { query: "monstera" }          → recherche par nom dans Open Plantbook
//
// Réponse : { candidates: Candidate[], remaining?: number }
//
// Secrets nécessaires (Supabase > Edge Functions > Secrets) :
//   PLANTNET_API_KEY, OPENPLANTBOOK_CLIENT_ID, OPENPLANTBOOK_CLIENT_SECRET
// La fonction est déployée avec verify_jwt = true : seuls les utilisateurs connectés l'appellent.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  type Candidate,
  careFromDetail,
  fromPlantnet,
  pickPlantbookMatch,
  type PlantbookDetail,
} from './care.ts'

const PLANTNET_URL = 'https://my-api.plantnet.org/v2/identify/all'
const PLANTBOOK_URL = 'https://open.plantbook.io/api/v1'
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_CANDIDATES = 3

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// --- Open Plantbook -----------------------------------------------------------

let plantbookToken: { value: string; expiresAt: number } | null = null
let pendingToken: Promise<string | null> | null = null

/** Jeton OAuth Open Plantbook, mis en cache ; les appels simultanés partagent la même demande. */
function getPlantbookToken(): Promise<string | null> {
  if (plantbookToken && plantbookToken.expiresAt > Date.now() + 60_000) return Promise.resolve(plantbookToken.value)
  pendingToken ??= fetchPlantbookToken().finally(() => {
    pendingToken = null
  })
  return pendingToken
}

async function fetchPlantbookToken(): Promise<string | null> {
  const clientId = Deno.env.get('OPENPLANTBOOK_CLIENT_ID')
  const secret = Deno.env.get('OPENPLANTBOOK_CLIENT_SECRET')
  if (!clientId || !secret) return null
  const res = await fetch(`${PLANTBOOK_URL}/token/`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
  })
  if (!res.ok) {
    console.error('Open Plantbook token', res.status, await res.text())
    return null
  }
  const data = await res.json()
  plantbookToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return plantbookToken.value
}

async function plantbookGet(path: string): Promise<unknown | null> {
  const token = await getPlantbookToken()
  if (!token) return null
  const res = await fetch(`${PLANTBOOK_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    if (res.status !== 404) console.error('Open Plantbook', path, res.status)
    return null
  }
  return res.json()
}

async function plantbookSearch(text: string): Promise<{ pid: string; display_pid?: string }[]> {
  const data = (await plantbookGet(`/plant/search?alias=${encodeURIComponent(text)}`)) as
    | { results?: { pid: string; display_pid?: string }[] }
    | null
  return data?.results ?? []
}

async function plantbookDetail(pid: string): Promise<PlantbookDetail | null> {
  return (await plantbookGet(`/plant/detail/${encodeURIComponent(pid)}/`)) as PlantbookDetail | null
}

/** Seuils pour une espèce : recherche puis fiche détaillée ; valeurs par défaut si introuvable. */
async function careFor(scientificName: string) {
  try {
    const results = await plantbookSearch(scientificName)
    const pid = pickPlantbookMatch(scientificName, results)
    return careFromDetail(pid ? await plantbookDetail(pid) : null)
  } catch (e) {
    console.error('Open Plantbook', scientificName, e)
    return careFromDetail(null)
  }
}

// --- Pl@ntNet -------------------------------------------------------------------

async function identify(imageBase64: string): Promise<Response> {
  const key = Deno.env.get('PLANTNET_API_KEY')
  if (!key) return json({ error: 'Clé Pl@ntNet manquante dans les secrets Supabase.' }, 500)

  const cleaned = imageBase64.replace(/^data:image\/\w+;base64,/, '')
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0))
  } catch {
    return json({ error: 'Image illisible.' }, 400)
  }
  if (bytes.length > MAX_IMAGE_BYTES) return json({ error: 'Image trop lourde (6 Mo maximum).' }, 413)

  const form = new FormData()
  form.append('images', new Blob([bytes], { type: 'image/jpeg' }), 'plante.jpg')
  form.append('organs', 'auto')

  const url = `${PLANTNET_URL}?api-key=${encodeURIComponent(key)}&lang=fr&nb-results=${MAX_CANDIDATES}`
  const res = await fetch(url, { method: 'POST', body: form })
  if (res.status === 404) return json({ candidates: [] }) // Pl@ntNet : aucune espèce reconnue
  if (!res.ok) {
    console.error('Pl@ntNet', res.status, await res.text())
    return json({ error: "Le service d'identification ne répond pas. Réessaie dans un instant." }, 502)
  }
  const data = await res.json()
  const base = ((data.results ?? []) as Parameters<typeof fromPlantnet>[0][])
    .map(fromPlantnet)
    .filter((c): c is Omit<Candidate, 'care'> => c !== null)
    .slice(0, MAX_CANDIDATES)

  const candidates: Candidate[] = await Promise.all(
    base.map(async (c) => ({ ...c, care: await careFor(c.scientificName) })),
  )
  return json({ candidates, remaining: data.remainingIdentificationRequests ?? null })
}

// --- Recherche par nom -----------------------------------------------------------

async function search(query: string): Promise<Response> {
  const q = query.trim()
  if (q.length < 3) return json({ candidates: [] })
  const results = (await plantbookSearch(q)).slice(0, 5)
  const candidates: Candidate[] = await Promise.all(
    results.map(async (r) => ({
      scientificName: r.display_pid ?? r.pid,
      commonName: null,
      family: null,
      score: null,
      care: careFromDetail(await plantbookDetail(r.pid)),
    })),
  )
  return json({ candidates })
}

// --- Point d'entrée --------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)

  let body: { image?: string; query?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Requête invalide.' }, 400)
  }

  try {
    if (typeof body.image === 'string') return await identify(body.image)
    if (typeof body.query === 'string') return await search(body.query)
    return json({ error: 'Envoie une image ou un nom de plante.' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Erreur inattendue.' }, 500)
  }
})
