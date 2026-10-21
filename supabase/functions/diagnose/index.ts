// Rootline — diagnostic de santé d'une plante.
//
// POST { context: string, question?: string, image?: "<jpeg en base64>" }
//   1. Avec une photo : maladies probables selon Pl@ntNet (indices).
//   2. Réponse d'un modèle qui lit les images, avec la fiche de la plante et ces indices.
// Réponse : { answer, diseases: [{ name, description, score }], model }
//
// Modèle utilisé, selon les secrets présents (Supabase > Edge Functions > Secrets) :
//   - GITHUB_MODELS_TOKEN : GitHub Models, gratuit (jeton GitHub avec la permission « Models : lecture »)
//   - sinon MISTRAL_API_KEY : Mistral (désormais réservé aux offres payantes de Mistral)
// Facultatif : DIAGNOSE_MODEL pour imposer un modèle. PLANTNET_API_KEY pour les maladies.
//
// La fiche (context) est préparée par l'app à partir de ce qu'elle affiche déjà : la fonction
// ne lit pas la base. Elle est déployée avec verify_jwt = true : seuls les utilisateurs
// connectés l'appellent.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { type Disease, mistralAnswer, mistralError, parseDiseases, SYSTEM_PROMPT, userText } from './prompt.ts'

const PLANTNET_DISEASES_URL = 'https://my-api.plantnet.org/v2/diseases/identify'
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_CONTEXT = 6000
const MAX_QUESTION = 2000

type Provider = {
  name: string
  url: string
  key: string
  /** Modèle principal, puis modèle de repli si le premier est refusé ou saturé. */
  models: [string, string]
  /** Format de l'image dans le message (OpenAI : objet { url } ; Mistral : chaîne). */
  image: (dataUrl: string) => unknown
}

function provider(): Provider | null {
  const github = Deno.env.get('GITHUB_MODELS_TOKEN')
  if (github)
    return {
      name: 'GitHub Models',
      url: 'https://models.github.ai/inference/chat/completions',
      key: github,
      models: ['openai/gpt-4.1-mini', 'openai/gpt-4o-mini'],
      image: (url) => ({ url, detail: 'high' }),
    }
  const mistral = Deno.env.get('MISTRAL_API_KEY')
  if (mistral)
    return {
      name: 'Mistral',
      url: 'https://api.mistral.ai/v1/chat/completions',
      key: mistral,
      models: ['mistral-medium-latest', 'mistral-small-latest'],
      image: (url) => url,
    }
  return null
}

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

/** Compteurs de limite renvoyés par le service (requêtes et jetons restants), pour les journaux. */
function rateHeaders(res: Response): string {
  const out: string[] = []
  res.headers.forEach((v, k) => {
    if (k.toLowerCase().includes('ratelimit') || k.toLowerCase() === 'retry-after') out.push(`${k}=${v}`)
  })
  return out.length ? `[${out.join(' ')}]` : '[pas de compteur]'
}

function ask(p: Provider, model: string, text: string, imageBase64: string | null) {
  const content: unknown[] = [{ type: 'text', text }]
  if (imageBase64) content.push({ type: 'image_url', image_url: p.image(`data:image/jpeg;base64,${imageBase64}`) })
  return fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
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
  const p = provider()
  if (!p) return json({ error: 'Aucun modèle configuré : ajoute GITHUB_MODELS_TOKEN dans les secrets Supabase.' }, 500)

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

    const [main, fallback] = p.models
    let model = Deno.env.get('DIAGNOSE_MODEL') || main
    let res = await ask(p, model, text, image)
    // Modèle indisponible ou saturé sur l'offre gratuite (les limites sont fixées par modèle) :
    // on se rabat sur le modèle de repli, après une courte pause.
    if ([400, 403, 404, 429].includes(res.status) && model !== fallback) {
      console.error(p.name, model, res.status, rateHeaders(res), await res.text())
      model = fallback
      await new Promise((r) => setTimeout(r, 1200))
      res = await ask(p, model, text, image)
    }
    if (!res.ok) {
      const detail = await res.text()
      console.error(p.name, model, res.status, rateHeaders(res), detail)
      const reason = mistralError(detail)
      if (res.status === 401)
        return json({ error: `Clé ${p.name} refusée : vérifie le secret dans Supabase.` }, 502)
      if (res.status === 429)
        return json({ error: `${p.name} : limite de l'offre gratuite atteinte${reason ? ` (« ${reason} »)` : ''}. Réessaie plus tard.` }, 429)
      return json({ error: `Le service de diagnostic ne répond pas${reason ? ` (« ${reason} »)` : ''}. Réessaie dans un instant.` }, 502)
    }
    const answer = mistralAnswer(await res.json())
    if (!answer) return json({ error: 'Réponse vide du service de diagnostic.' }, 502)
    return json({ answer, diseases, model })
  } catch (e) {
    console.error(e)
    return json({ error: 'Erreur inattendue.' }, 500)
  }
})
