// Rootline — diagnostic de santé d'une plante.
//
// POST { context: string, question?: string, image?: "<jpeg en base64>" }
//   1. Avec une photo : maladies probables selon Pl@ntNet (indices).
//   2. Réponse de Mistral (modèle qui lit les images), avec la fiche de la plante et ces indices.
// Réponse : { answer, diseases: [{ name, description, score }], model }
//
// La fiche (context) est préparée par l'app à partir de ce qu'elle affiche déjà : la fonction
// ne lit pas la base. Elle est déployée avec verify_jwt = true : seuls les utilisateurs
// connectés l'appellent.
//
// Secrets (Supabase > Edge Functions > Secrets) : MISTRAL_API_KEY, PLANTNET_API_KEY.
// Facultatif : MISTRAL_MODEL (par défaut mistral-medium-latest).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { type Disease, mistralAnswer, parseDiseases, SYSTEM_PROMPT, userText } from './prompt.ts'

const PLANTNET_DISEASES_URL = 'https://my-api.plantnet.org/v2/diseases/identify'
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions'
const DEFAULT_MODEL = 'mistral-medium-latest'
const FALLBACK_MODEL = 'mistral-small-latest'
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_CONTEXT = 6000
const MAX_QUESTION = 2000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** Maladies probables selon Pl@ntNet ; une liste vide en cas d'échec (c'est un indice, pas l'essentiel). */
async function plantnetDiseases(bytes: Uint8Array<ArrayBuffer>): Promise<Disease[]> {
  const key = Deno.env.get('PLANTNET_API_KEY')
  if (!key) return []
  const form = new FormData()
  form.append('images', new Blob([bytes], { type: 'image/jpeg' }), 'plante.jpg')
  form.append('organs', 'auto')
  try {
    const res = await fetch(`${PLANTNET_DISEASES_URL}?api-key=${encodeURIComponent(key)}&lang=fr&nb-results=5`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      if (res.status !== 404) console.error('Pl@ntNet maladies', res.status, await res.text())
      return []
    }
    return parseDiseases(await res.json())
  } catch (e) {
    console.error('Pl@ntNet maladies', e)
    return []
  }
}

async function askMistral(model: string, text: string, imageBase64: string | null) {
  const content: unknown[] = [{ type: 'text', text }]
  if (imageBase64) content.push({ type: 'image_url', image_url: `data:image/jpeg;base64,${imageBase64}` })
  return fetch(MISTRAL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('MISTRAL_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    }),
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)
  if (!Deno.env.get('MISTRAL_API_KEY'))
    return json({ error: 'Clé Mistral manquante : ajoute MISTRAL_API_KEY dans les secrets Supabase.' }, 500)

  let body: { context?: string; question?: string | null; image?: string | null }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Requête invalide.' }, 400)
  }
  const context = (body.context ?? '').slice(0, MAX_CONTEXT)
  const question = body.question?.trim() ? body.question.trim().slice(0, MAX_QUESTION) : null
  const image = body.image ? body.image.replace(/^data:image\/\w+;base64,/, '') : null
  if (!question && !image) return json({ error: 'Joins une photo ou pose une question.' }, 400)

  let bytes: Uint8Array<ArrayBuffer> | null = null
  if (image) {
    try {
      bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0))
    } catch {
      return json({ error: 'Image illisible.' }, 400)
    }
    if (bytes.length > MAX_IMAGE_BYTES) return json({ error: 'Image trop lourde (6 Mo maximum).' }, 413)
  }

  try {
    const diseases = bytes ? await plantnetDiseases(bytes) : []
    const text = userText(context, question, diseases, bytes !== null)

    let model = Deno.env.get('MISTRAL_MODEL') || DEFAULT_MODEL
    let res = await askMistral(model, text, image)
    // Modèle indisponible sur l'offre gratuite : on se rabat sur un modèle plus petit.
    if ((res.status === 400 || res.status === 403 || res.status === 404) && model !== FALLBACK_MODEL) {
      console.error('Mistral', model, res.status, await res.text())
      model = FALLBACK_MODEL
      res = await askMistral(model, text, image)
    }
    if (res.status === 429) return json({ error: 'Quota gratuit de Mistral atteint pour le moment. Réessaie dans quelques minutes.' }, 429)
    if (res.status === 401) return json({ error: 'Clé Mistral refusée : vérifie MISTRAL_API_KEY dans les secrets Supabase.' }, 502)
    if (!res.ok) {
      console.error('Mistral', model, res.status, await res.text())
      return json({ error: "Le service de diagnostic ne répond pas. Réessaie dans un instant." }, 502)
    }
    const answer = mistralAnswer(await res.json())
    if (!answer) return json({ error: 'Réponse vide du service de diagnostic.' }, 502)
    return json({ answer, diseases, model })
  } catch (e) {
    console.error(e)
    return json({ error: 'Erreur inattendue.' }, 500)
  }
})
