import { FunctionsHttpError } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { FERTILIZER, fertilizerStatus } from './fertilizer'
import { ORIENTATION_LABEL } from './plan'
import { computeStatus } from './status'
import { supabase } from './supabase'
import type { Plant, PlantEvent, Reading } from './types'

const BUCKET = 'plant-photos'

export type Disease = { name: string; description: string; score: number }

export type Diagnosis = {
  id: string
  plant_id: string
  created_at: string
  question: string | null
  answer: string
  diseases: Disease[]
  photo_path: string | null
  model: string | null
}

type ContextInput = {
  plant: Plant
  events: PlantEvent[]
  reading: Reading | undefined
  lastWatered: Date | undefined
  lastFertilized: Date | undefined
}

const fmt = (d: Date | string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const KIND = { water: 'arrosage', fertilize: 'engrais', note: 'note' } as const

/**
 * Fiche de la plante en texte, pour l'IA ou pour Claude : tout ce que l'app sait déjà.
 * Elle reste lisible par un humain (elle est aussi collée dans le message à Claude).
 */
export function buildContext({ plant, events, reading, lastWatered, lastFertilized }: ContextInput): string {
  const now = new Date()
  const status = computeStatus(plant, reading, lastWatered, now)
  const fert = fertilizerStatus(plant, lastFertilized, reading?.conductivity, now)
  const lines: string[] = []
  const species = [plant.species, plant.species_common].filter(Boolean).join(', ')
  lines.push(`Plante : ${plant.name}${species ? ` (${species})` : ''}`)
  if (plant.room)
    lines.push(
      `Emplacement : ${plant.room}${plant.window_orientation ? `, près d'une fenêtre orientée ${ORIENTATION_LABEL[plant.window_orientation]}` : ''}`,
    )
  lines.push(`Date du jour : ${fmt(now)}`)
  if (plant.interval_summer_days || plant.interval_winter_days)
    lines.push(
      `Arrosage prévu : tous les ${plant.interval_summer_days ?? '?'} j en été, ${plant.interval_winter_days ?? '?'} j en hiver`,
    )
  lines.push(`État de l'arrosage : ${status.detail}${lastWatered ? ` (dernier arrosage le ${fmt(lastWatered)})` : ''}`)
  lines.push(
    `Engrais : ${FERTILIZER[fert.category].label.toLowerCase()} ; ${fert.detail.toLowerCase()}${lastFertilized ? ` (dernier apport le ${fmt(lastFertilized)})` : ''}`,
  )
  if (reading) {
    const m: string[] = []
    if (reading.moisture != null) m.push(`humidité du sol ${Math.round(reading.moisture)} %`)
    if (reading.conductivity != null) m.push(`conductivité ${Math.round(reading.conductivity)} µS/cm`)
    if (reading.light != null) m.push(`lumière ${Math.round(reading.light)} lux`)
    if (reading.temperature != null) m.push(`température ${reading.temperature.toFixed(1)} °C`)
    if (m.length) lines.push(`Dernière mesure du capteur (${fmt(reading.measured_at)}) : ${m.join(', ')}`)
  }
  const range = (a: number | null, b: number | null, unit: string) => (a != null || b != null ? `${a ?? '?'}–${b ?? '?'} ${unit}` : null)
  const thresholds = [
    range(plant.moisture_min, plant.moisture_max, '% d’humidité'),
    range(plant.conductivity_min, plant.conductivity_max, 'µS/cm'),
    plant.light_min != null ? `au moins ${plant.light_min} lux` : null,
  ].filter(Boolean)
  if (thresholds.length) lines.push(`Besoins de l'espèce : ${thresholds.join(', ')}`)
  const recent = events.slice(0, 10)
  if (recent.length) {
    lines.push('Historique récent :')
    for (const e of recent) lines.push(`- ${fmt(e.occurred_at)} : ${KIND[e.kind]}${e.note ? ` — ${e.note}` : ''}`)
  }
  return lines.join('\n')
}

/** Lance le diagnostic (Pl@ntNet + Mistral), puis l'enregistre avec sa photo. */
export async function runDiagnosis(input: {
  plant: Plant
  context: string
  question: string | null
  photo: { blob: Blob; base64: string } | null
}): Promise<{ diagnosis: Diagnosis | null; error: string | null }> {
  const { plant, context, question, photo } = input
  const { data, error } = await supabase.functions.invoke('diagnose', {
    body: { context, question, image: photo?.base64 ?? null },
  })
  if (error) {
    let message = 'Le diagnostic a échoué. Vérifie ta connexion et réessaie.'
    if (error instanceof FunctionsHttpError) {
      try {
        message = (await error.context.json()).error ?? message
      } catch {
        /* réponse non JSON */
      }
    }
    return { diagnosis: null, error: message }
  }

  const id = crypto.randomUUID()
  let photoPath: string | null = null
  if (photo) {
    const path = `${plant.household_id}/diagnostics/${id}.jpg`
    const up = await supabase.storage.from(BUCKET).upload(path, photo.blob, { contentType: 'image/jpeg' })
    if (!up.error) photoPath = path
  }
  const row = {
    id,
    household_id: plant.household_id,
    plant_id: plant.id,
    question,
    answer: String(data.answer),
    diseases: data.diseases ?? [],
    photo_path: photoPath,
    model: data.model ?? null,
  }
  const saved = await supabase.from('diagnoses').insert(row).select('*').single()
  // La réponse s'affiche même si l'enregistrement échoue : elle n'est pas perdue pour autant à l'écran.
  if (saved.error) return { diagnosis: { ...row, created_at: new Date().toISOString() }, error: `Réponse non enregistrée : ${saved.error.message}` }
  return { diagnosis: saved.data as Diagnosis, error: null }
}

/** Diagnostics d'une plante, du plus récent au plus ancien, avec un lien vers chaque photo. */
export function useDiagnoses(plantId: string) {
  const [list, setList] = useState<Diagnosis[]>([])
  const [photos, setPhotos] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('diagnoses')
      .select('*')
      .eq('plant_id', plantId)
      .order('created_at', { ascending: false })
      .limit(50)
    const rows = (data ?? []) as Diagnosis[]
    setList(rows)
    const paths = rows.map((d) => d.photo_path).filter((p): p is string => !!p)
    const urls = new Map<string, string>()
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    }
    setPhotos(urls)
  }, [plantId])

  useEffect(() => {
    void load()
  }, [load])

  const remove = useCallback(
    async (d: Diagnosis) => {
      const { error } = await supabase.from('diagnoses').delete().eq('id', d.id)
      if (!error && d.photo_path) await supabase.storage.from(BUCKET).remove([d.photo_path])
      await load()
      return error?.message ?? null
    },
    [load],
  )

  return { list, photos, reload: load, remove }
}

/** Message complet pour Claude : la question, puis la fiche de la plante. */
export function claudeMessage(context: string, question: string | null) {
  return [
    question?.trim() ? question.trim() : 'Peux-tu faire un bilan de santé de ma plante à partir de la photo ?',
    '',
    'Voici sa fiche (application Rootline) :',
    context,
  ].join('\n')
}

/**
 * Envoie la question à l'app Claude. Avec une photo, la feuille de partage du téléphone
 * transmet photo et texte ensemble ; sinon, ou si le partage n'est pas possible, le texte est
 * copié et claude.ai s'ouvre avec la question pré-remplie.
 */
export async function askClaude(text: string, photo: Blob | null): Promise<'shared' | 'opened' | 'cancelled'> {
  const files = photo ? [new File([photo], 'plante.jpg', { type: 'image/jpeg' })] : []
  if (files.length && navigator.canShare?.({ files, text })) {
    try {
      await navigator.share({ files, text })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* le texte part quand même dans l'adresse */
  }
  window.open(`https://claude.ai/new?q=${encodeURIComponent(text.slice(0, 6000))}`, '_blank', 'noopener')
  return 'opened'
}
