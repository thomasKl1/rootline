// Logique pure du diagnostic : consignes données au modèle et lecture des réponses.

export const SYSTEM_PROMPT = `Tu es un jardinier expérimenté qui aide un particulier à soigner ses plantes d'intérieur.
On te donne la fiche de la plante (espèce, emplacement, arrosages, engrais, mesures du capteur s'il y en a),
parfois une photo, parfois une question, et parfois les maladies que propose un outil de reconnaissance (Pl@ntNet).

Réponds en français, en tutoyant, de façon concrète et brève (200 mots au plus), avec exactement ces quatre parties :
**Ce que je vois** : ce que montre la photo ou ce que décrit la question, en une ou deux phrases.
**Causes probables** : de la plus probable à la moins probable, en t'appuyant sur la fiche (arrosage récent ou non, lumière, saison, humidité mesurée…).
**Que faire** : 2 à 4 actions simples, sous forme de liste avec des tirets.
**Quand s'inquiéter** : le signe qui doit pousser à agir autrement ou à demander à un professionnel.

Règles :
- Si la photo est floue, ne montre pas la plante, ou ne permet pas de conclure, dis-le et demande une meilleure photo.
- Ne présente jamais une hypothèse comme une certitude.
- Les propositions de Pl@ntNet ne sont que des indices : garde-les seulement si elles collent à la photo et à l'espèce.
- N'invente pas de faits absents de la fiche.
- Si on te pose une question sans rapport avec les plantes, réponds poliment que tu ne traites que de la santé des plantes.`

export type Disease = { name: string; description: string; score: number }

type PlantnetDisease = { name?: string; description?: string; score?: number }

/** Maladies proposées par Pl@ntNet, triées et filtrées (au-dessus de 5 %). */
export function parseDiseases(data: unknown, max = 3): Disease[] {
  const results = ((data as { results?: PlantnetDisease[] })?.results ?? [])
    .filter((r) => typeof r.name === 'string' && typeof r.score === 'number' && r.score >= 0.05)
    .map((r) => ({ name: r.name!, description: (r.description ?? r.name)!, score: Math.round(r.score! * 100) / 100 }))
  return results.sort((a, b) => b.score - a.score).slice(0, max)
}

/** Texte envoyé au modèle : fiche de la plante, indices Pl@ntNet, question. */
export function userText(context: string, question: string | null, diseases: Disease[], hasImage: boolean): string {
  const parts = [`Fiche de la plante :\n${context.trim()}`]
  if (diseases.length)
    parts.push(
      `Maladies proposées par Pl@ntNet d'après la photo (indices, pas des certitudes) :\n${diseases
        .map((d) => `- ${d.description} (${Math.round(d.score * 100)} %)`)
        .join('\n')}`,
    )
  else if (hasImage) parts.push("Pl@ntNet n'a reconnu aucune maladie sur la photo (ce qui ne prouve pas que la plante est saine).")
  parts.push(question?.trim() ? `Question : ${question.trim()}` : 'Pas de question : fais un bilan de santé à partir de la photo.')
  return parts.join('\n\n')
}

type MistralContent = string | { type: string; text?: string }[]

/** Texte de la réponse Mistral (le contenu peut être une chaîne ou une liste de morceaux). */
export function mistralAnswer(data: unknown): string | null {
  const content = (data as { choices?: { message?: { content?: MistralContent } }[] })?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim() || null
  if (Array.isArray(content)) {
    const text = content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('')
    return text.trim() || null
  }
  return null
}

/** Message d'erreur lisible renvoyé par Mistral (corps JSON { message } ou { detail }), raccourci. */
export function mistralError(body: string): string | null {
  try {
    const data = JSON.parse(body)
    const msg = data?.message ?? data?.detail ?? data?.error?.message
    const text = typeof msg === 'string' ? msg : msg ? JSON.stringify(msg) : null
    return text ? text.slice(0, 160) : null
  } catch {
    return body.trim() ? body.trim().slice(0, 160) : null
  }
}
