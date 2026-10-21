// Tests de la fonction diagnose, sans réseau : Pl@ntNet et Mistral sont simulés.
// Lancer : deno test -A supabase/functions/diagnose/index.test.ts

import { mistralAnswer, parseDiseases, userText } from './prompt.ts'

function assertEquals(a: unknown, b: unknown) {
  const x = JSON.stringify(a), y = JSON.stringify(b)
  if (x !== y) throw new Error(`attendu ${y}, reçu ${x}`)
}
function assert(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
}

// deno-lint-ignore no-explicit-any
let handler: (r: Request) => Promise<Response>
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: any) => {
  handler = h
}
Deno.env.set('PLANTNET_API_KEY', 'k')
Deno.env.set('MISTRAL_API_KEY', 'm')

let mistralStatus: Record<string, number> = {}
// deno-lint-ignore no-explicit-any
let lastMistralBody: any = null
const calls: string[] = []
// deno-lint-ignore no-explicit-any
globalThis.fetch = async (input: any, init?: any) => {
  const url = String(input)
  if (url.includes('plantnet')) {
    calls.push('plantnet')
    return Response.json({
      results: [
        { name: 'PSDMSY', description: 'Taches bactériennes', score: 0.42 },
        { name: 'XXXXXX', description: 'Bruit', score: 0.01 },
        { name: 'ERYSPP', description: 'Oïdium', score: 0.2 },
      ],
    })
  }
  if (url.includes('mistral')) {
    lastMistralBody = JSON.parse(init.body)
    calls.push(`mistral:${lastMistralBody.model}`)
    const status = mistralStatus[lastMistralBody.model] ?? 200
    if (status !== 200) return new Response('{"message":"nope"}', { status })
    return Response.json({ choices: [{ message: { content: '**Ce que je vois** : des feuilles jaunes.' } }] })
  }
  return new Response('nope', { status: 500 })
}
await import('./index.ts')

const post = async (body: unknown) => {
  const res = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

Deno.test('photo et question : indices Pl@ntNet transmis à Mistral', async () => {
  calls.length = 0
  mistralStatus = {}
  const { status, body } = await post({ context: 'Plante : Calathea', question: 'Feuilles jaunes ?', image: btoa('jpeg') })
  assertEquals(status, 200)
  assertEquals(calls, ['plantnet', 'mistral:mistral-medium-latest'])
  assertEquals(body.diseases.map((d: { name: string }) => d.name), ['PSDMSY', 'ERYSPP'])
  assertEquals(body.answer, '**Ce que je vois** : des feuilles jaunes.')
  const text = lastMistralBody.messages[1].content[0].text as string
  assert(text.includes('Plante : Calathea') && text.includes('Taches bactériennes (42 %)') && text.includes('Question : Feuilles jaunes ?'), text)
  assertEquals(lastMistralBody.messages[1].content[1].image_url.startsWith('data:image/jpeg;base64,'), true)
})

Deno.test('question seule : pas de Pl@ntNet, pas d’image', async () => {
  calls.length = 0
  const { status } = await post({ context: 'Plante : Ficus', question: 'Combien de lumière ?' })
  assertEquals(status, 200)
  assertEquals(calls, ['mistral:mistral-medium-latest'])
  assertEquals(lastMistralBody.messages[1].content.length, 1)
})

Deno.test('modèle indisponible : repli sur le petit modèle', async () => {
  calls.length = 0
  mistralStatus = { 'mistral-medium-latest': 400 }
  const { status, body } = await post({ context: '', question: 'Aide' })
  assertEquals(status, 200)
  assertEquals(calls, ['mistral:mistral-medium-latest', 'mistral:mistral-small-latest'])
  assertEquals(body.model, 'mistral-small-latest')
})

Deno.test('erreurs : quota, requête vide', async () => {
  mistralStatus = { 'mistral-medium-latest': 429 }
  assertEquals((await post({ context: '', question: 'Aide' })).status, 429)
  mistralStatus = {}
  assertEquals((await post({ context: 'x' })).status, 400)
})

Deno.test('logique pure', () => {
  assertEquals(parseDiseases({ results: [{ name: 'A', score: 0.5 }] }), [{ name: 'A', description: 'A', score: 0.5 }])
  assertEquals(parseDiseases(null), [])
  assert(userText('fiche', null, [], true).includes("Pl@ntNet n'a reconnu aucune maladie"), 'pas de maladie')
  assert(userText('fiche', null, [], false).includes('Pas de question'), 'bilan')
  assertEquals(mistralAnswer({ choices: [{ message: { content: [{ type: 'text', text: 'Bonjour' }] } }] }), 'Bonjour')
  assertEquals(mistralAnswer({}), null)
})
