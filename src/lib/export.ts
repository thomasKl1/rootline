import { supabase } from './supabase'

const PAGE = 1000 // nombre de lignes maximum renvoyées par l'API Supabase à chaque requête

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Récupère toutes les lignes d'une requête, page par page. */
async function fetchAll<T>(query: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export type ExportProgress = (step: string) => void

/**
 * Rassemble toutes les données du foyer dans un seul fichier JSON :
 * foyer et plan, plantes (avec leur photo), arrosages / engrais / notes, mesures des capteurs.
 */
export async function buildExport(householdId: string, progress: ExportProgress): Promise<File> {
  progress('Foyer et plantes…')
  const [household, plants] = await Promise.all([
    supabase.from('households').select('name, timezone, reminder_hour, floor_plan, created_at').eq('id', householdId).single(),
    supabase.from('plants').select('*').eq('household_id', householdId).order('created_at'),
  ])
  if (household.error) throw new Error(household.error.message)
  if (plants.error) throw new Error(plants.error.message)

  progress('Historique…')
  const events = await fetchAll((from, to) =>
    supabase
      .from('events')
      .select('id, plant_id, kind, source, occurred_at, note')
      .eq('household_id', householdId)
      .order('occurred_at')
      .range(from, to),
  )

  progress('Mesures des capteurs…')
  const readings = await fetchAll((from, to) =>
    supabase
      .from('readings')
      .select('sensor_mac, measured_at, moisture, conductivity, light, temperature, battery')
      .eq('household_id', householdId)
      .order('measured_at')
      .range(from, to),
  )

  progress('Photos…')
  const withPhotos = []
  for (const p of plants.data ?? []) {
    let photo: string | null = null
    if (p.photo_path) {
      const { data } = await supabase.storage.from('plant-photos').download(p.photo_path)
      if (data) photo = await blobToDataUrl(data)
    }
    withPhotos.push({ ...p, photo })
  }

  const content = {
    format: 'rootline-export',
    version: 1,
    exported_at: new Date().toISOString(),
    household: household.data,
    plants: withPhotos,
    events,
    readings,
  }
  const date = new Date().toISOString().slice(0, 10)
  return new File([JSON.stringify(content, null, 1)], `rootline-${date}.json`, { type: 'application/json' })
}

/**
 * Remet le fichier à l'utilisateur. Sur iPhone, l'app installée ne sait pas télécharger :
 * on passe par la feuille de partage (« Enregistrer dans Fichiers »). Ailleurs, téléchargement.
 */
export async function deliverFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  if (ios && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}

export function formatSize(bytes: number) {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} ko` : `${(bytes / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}
