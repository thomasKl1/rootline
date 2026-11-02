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
 * foyer et plan, plantes (avec leur photo), arrosages / engrais / notes / photos, mesures des capteurs.
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
      .select('id, plant_id, kind, source, occurred_at, note, photo_path')
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

  progress('Diagnostics…')
  const diagnoses = await fetchAll((from, to) =>
    supabase
      .from('diagnoses')
      .select('id, plant_id, created_at, question, answer, diseases, photo_path, model')
      .eq('household_id', householdId)
      .order('created_at')
      .range(from, to),
  )

  progress('Photos…')
  const diagnosesWithPhotos = []
  for (const d of diagnoses as { photo_path: string | null }[]) {
    let photo: string | null = null
    if (d.photo_path) {
      const { data } = await supabase.storage.from('plant-photos').download(d.photo_path)
      if (data) photo = await blobToDataUrl(data)
    }
    const { photo_path: _path, ...rest } = d
    diagnosesWithPhotos.push({ ...rest, photo })
  }

  // Photos de l'historique : l'image voyage dans le fichier, à la place de son chemin.
  const eventsWithPhotos = []
  for (const e of events as { kind: string; photo_path: string | null }[]) {
    const { photo_path: path, ...rest } = e
    if (e.kind !== 'photo') {
      eventsWithPhotos.push(rest)
      continue
    }
    let photo: string | null = null
    if (path) {
      const { data } = await supabase.storage.from('plant-photos').download(path)
      if (data) photo = await blobToDataUrl(data)
    }
    eventsWithPhotos.push({ ...rest, photo })
  }

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
    version: 3,
    exported_at: new Date().toISOString(),
    household: household.data,
    plants: withPhotos,
    events: eventsWithPhotos,
    readings,
    diagnoses: diagnosesWithPhotos,
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

// ---------------------------------------------------------------------------
// Restauration d'une sauvegarde
// ---------------------------------------------------------------------------

type BackupPlant = { id: string; name: string; photo: string | null }
export type Backup = {
  format: 'rootline-export'
  exported_at: string
  household: { floor_plan: unknown } | null
  plants: BackupPlant[]
  events: unknown[]
  readings: unknown[]
  /** Depuis la version 2 de l'export. */
  diagnoses?: BackupDiagnosis[]
}

type BackupDiagnosis = {
  id: string
  plant_id: string
  created_at: string
  question: string | null
  answer: string
  diseases: unknown
  model: string | null
  photo: string | null
}

/** Lit et vérifie un fichier de sauvegarde ; lève une erreur en français s'il ne convient pas. */
export async function readBackup(file: File): Promise<Backup> {
  let data: Partial<Backup>
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error("Ce fichier n'est pas un JSON valide.")
  }
  if (data?.format !== 'rootline-export') throw new Error("Ce fichier n'est pas une sauvegarde Rootline.")
  if (!Array.isArray(data.plants) || !Array.isArray(data.events) || !Array.isArray(data.readings))
    throw new Error('Sauvegarde incomplète : plantes, événements ou mesures manquants.')
  return data as Backup
}

export type ImportResult = {
  plants: number
  events: number
  readings: number
  /** Photos des plantes et photos de l'historique renvoyées dans le stockage. */
  photos: number
  diagnoses: number
  plan: boolean
}

const READINGS_CHUNK = 2000

function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Ajoute au foyer ce qui manque d'une sauvegarde, sans rien écraser. */
export async function importBackup(householdId: string, backup: Backup, progress: ExportProgress): Promise<ImportResult> {
  progress('Plantes et historique…')
  // Les photos voyagent à part : on ne les envoie pas à la base.
  const plants = backup.plants.map(({ photo: _photo, ...rest }) => rest)
  // Les photos de l'historique (export version 3) sont importées à part, avec leur image.
  const isShot = (e: unknown): e is BackupShot => (e as { kind?: string })?.kind === 'photo'
  const shots = backup.events.filter(isShot)
  const events = backup.events.filter((e) => !isShot(e))
  const { data, error } = await supabase.rpc('import_backup', {
    p_household: householdId,
    p_data: { format: backup.format, household: backup.household, plants, events },
  })
  if (error) throw new Error(error.message.includes('not_allowed') ? "Tu n'as pas accès à ce foyer." : error.message)
  const created = (data?.created ?? {}) as Record<string, string>
  // Toutes les plantes du fichier → leur id dans ce foyer (renvoyé depuis la migration 0009).
  const ids = (data?.ids ?? created) as Record<string, string>

  let readings = 0
  for (let i = 0; i < backup.readings.length; i += READINGS_CHUNK) {
    progress(`Mesures… ${Math.round((i / backup.readings.length) * 100)} %`)
    const { data: n, error: e } = await supabase.rpc('import_readings', {
      p_household: householdId,
      p_rows: backup.readings.slice(i, i + READINGS_CHUNK),
    })
    if (e) throw new Error(e.message)
    readings += (n as number) ?? 0
  }

  progress('Photos…')
  let photos = 0
  for (const p of backup.plants) {
    const newId = created[p.id]
    if (!newId || !p.photo) continue
    const path = `${householdId}/${newId}.jpg`
    const up = await supabase.storage.from('plant-photos').upload(path, dataUrlToBlob(p.photo), { upsert: true, contentType: 'image/jpeg' })
    if (up.error) continue // la plante est là ; seule sa photo manque
    await supabase.from('plants').update({ photo_path: path }).eq('id', newId)
    photos++
  }

  const diagnoses = await importDiagnoses(householdId, backup.diagnoses ?? [], ids, progress)
  const shotsAdded = await importShots(householdId, shots, ids, progress)

  return {
    diagnoses,
    plants: Object.keys(created).length,
    events: ((data?.events_added as number) ?? 0) + shotsAdded,
    readings,
    photos: photos + shotsAdded,
    plan: data?.plan_restored === true,
  }
}

type BackupShot = { id: string; plant_id: string; kind: 'photo'; occurred_at: string; note: string | null; photo: string | null }

/**
 * Photos de l'historique : rattachées à la plante correspondante de ce foyer, sans doublon
 * (même id, ou même plante et même date), l'image renvoyée dans le stockage avant l'événement.
 */
async function importShots(householdId: string, list: BackupShot[], ids: Record<string, string>, progress: ExportProgress): Promise<number> {
  const todo = list.filter((s) => ids[s.plant_id] && s.photo)
  if (!todo.length) return 0
  progress("Photos de l'historique…")
  const { data: existing } = await supabase
    .from('events')
    .select('id, plant_id, occurred_at')
    .eq('household_id', householdId)
    .eq('kind', 'photo')
  const seen = new Set((existing ?? []).flatMap((e) => [e.id, `${e.plant_id}|${new Date(e.occurred_at).getTime()}`]))

  let added = 0
  for (const s of todo) {
    const plantId = ids[s.plant_id]
    const at = new Date(s.occurred_at).getTime()
    if (seen.has(s.id) || seen.has(`${plantId}|${at}`)) continue
    const path = `${householdId}/history/${plantId}/${at}.jpg`
    const up = await supabase.storage.from('plant-photos').upload(path, dataUrlToBlob(s.photo!), { upsert: true, contentType: 'image/jpeg' })
    if (up.error) continue
    const row = { household_id: householdId, plant_id: plantId, kind: 'photo', source: 'manual', occurred_at: s.occurred_at, note: s.note, photo_path: path }
    let ins = await supabase.from('events').insert({ ...row, id: s.id })
    if (ins.error) ins = await supabase.from('events').insert(row)
    if (ins.error) {
      await supabase.storage.from('plant-photos').remove([path])
      continue
    }
    added++
  }
  return added
}

/**
 * Diagnostics de la sauvegarde : rattachés à la plante correspondante de ce foyer, sans doublon
 * (même id, ou même plante et même date), avec leur photo renvoyée dans le stockage.
 */
async function importDiagnoses(
  householdId: string,
  list: BackupDiagnosis[],
  ids: Record<string, string>,
  progress: ExportProgress,
): Promise<number> {
  const todo = list.filter((d) => ids[d.plant_id])
  if (!todo.length) return 0
  progress('Diagnostics…')
  const { data: existing } = await supabase.from('diagnoses').select('id, plant_id, created_at').eq('household_id', householdId)
  const seen = new Set((existing ?? []).flatMap((e) => [e.id, `${e.plant_id}|${new Date(e.created_at).getTime()}`]))

  let added = 0
  for (const d of todo) {
    const plantId = ids[d.plant_id]
    if (seen.has(d.id) || seen.has(`${plantId}|${new Date(d.created_at).getTime()}`)) continue
    const row = {
      household_id: householdId,
      plant_id: plantId,
      created_at: d.created_at,
      question: d.question,
      answer: d.answer,
      diseases: d.diseases ?? [],
      model: d.model,
      photo_path: null as string | null,
    }
    // L'id d'origine, sauf s'il est déjà pris (sauvegarde d'un autre foyer du même projet).
    let ins = await supabase.from('diagnoses').insert({ ...row, id: d.id }).select('id').single()
    if (ins.error) ins = await supabase.from('diagnoses').insert(row).select('id').single()
    if (ins.error || !ins.data) continue
    added++
    const id = ins.data.id as string
    if (d.photo) {
      const path = `${householdId}/diagnostics/${id}.jpg`
      const up = await supabase.storage.from('plant-photos').upload(path, dataUrlToBlob(d.photo), { upsert: true, contentType: 'image/jpeg' })
      if (!up.error) await supabase.from('diagnoses').update({ photo_path: path }).eq('id', id)
    }
  }
  return added
}
