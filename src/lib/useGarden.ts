import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import type { FloorPlan, Orientation } from './plan'
import { ROOMS, type EventKind, type Plant, type Reading, type WaterEvent } from './types'

export type NewPlant = {
  name: string
  room: string | null
  species: string | null
  species_common: string | null
  moisture_min: number | null
  moisture_max: number | null
  conductivity_min: number | null
  conductivity_max: number | null
  light_min: number | null
  interval_summer_days: number | null
  interval_winter_days: number | null
}

/** Champs modifiables d'une plante : ceux de l'ajout, plus son emplacement sur le plan. */
export type PlantUpdate = Partial<
  NewPlant & { window_orientation: Orientation | null; map_x: number | null; map_y: number | null }
>

export type Household = {
  id: string
  name: string
  timezone: string
  reminder_hour: number
  floor_plan: FloorPlan | null
}

type GardenState = {
  loading: boolean
  error: string | null
  householdId: string | null
  household: Household | null
  plants: Plant[]
  lastWatered: Map<string, Date>
  latestReading: Map<string, Reading>
  /** URL temporaire (1 h) de la photo de chaque plante, par id de plante. */
  photoUrls: Map<string, string>
}

const initial: GardenState = {
  loading: true,
  error: null,
  householdId: null,
  household: null,
  plants: [],
  lastWatered: new Map(),
  latestReading: new Map(),
  photoUrls: new Map(),
}

const PHOTO_BUCKET = 'plant-photos'

/** Les photos sont dans un espace privé : on demande des liens signés, valables une heure. */
async function signPhotos(plants: Plant[]) {
  const withPhoto = plants.filter((p) => p.photo_path)
  const urls = new Map<string, string>()
  if (withPhoto.length === 0) return urls
  const { data } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(withPhoto.map((p) => p.photo_path!), 3600)
  for (const item of data ?? []) {
    const plant = withPhoto.find((p) => p.photo_path === item.path)
    if (plant && item.signedUrl) urls.set(plant.id, item.signedUrl)
  }
  return urls
}

/** Charge le foyer de l'utilisateur, ses plantes, leurs derniers arrosages et mesures. */
export function useGarden() {
  const [state, setState] = useState<GardenState>(initial)

  const load = useCallback(async () => {
    const membership = await supabase
      .from('household_members')
      .select('household_id')
      .order('joined_at', { ascending: false }) // le foyer rejoint le plus récemment
      .limit(1)
      .maybeSingle()
    if (membership.error) {
      setState((s) => ({ ...s, loading: false, error: membership.error.message }))
      return
    }
    const householdId = membership.data?.household_id ?? null
    if (!householdId) {
      setState({ ...initial, loading: false, error: 'Aucun foyer trouvé pour ce compte.' })
      return
    }

    const [household, plants, events, readings] = await Promise.all([
      supabase.from('households').select('id, name, timezone, reminder_hour, floor_plan').eq('id', householdId).single(),
      supabase.from('plants').select('*').eq('household_id', householdId).is('archived_at', null).order('name'),
      supabase
        .from('events')
        .select('id, plant_id, occurred_at, source')
        .eq('household_id', householdId)
        .eq('kind', 'water')
        .order('occurred_at', { ascending: false })
        .limit(300),
      supabase
        .from('readings')
        .select('sensor_mac, measured_at, moisture, conductivity, light, temperature, battery')
        .eq('household_id', householdId)
        .order('measured_at', { ascending: false })
        .limit(300),
    ])

    const error = household.error ?? plants.error ?? events.error ?? readings.error
    if (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }))
      return
    }

    // Les résultats sont triés du plus récent au plus ancien : on garde le premier vu.
    const lastWatered = new Map<string, Date>()
    for (const e of (events.data ?? []) as WaterEvent[]) {
      if (!lastWatered.has(e.plant_id)) lastWatered.set(e.plant_id, new Date(e.occurred_at))
    }
    const latestReading = new Map<string, Reading>()
    for (const r of (readings.data ?? []) as Reading[]) {
      if (!latestReading.has(r.sensor_mac)) latestReading.set(r.sensor_mac, r)
    }

    const plantList = (plants.data ?? []) as Plant[]
    setState({
      loading: false,
      error: null,
      householdId,
      household: household.data as Household,
      plants: plantList,
      lastWatered,
      latestReading,
      photoUrls: await signPhotos(plantList),
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Crée la plante, puis envoie sa photo dans le dossier du foyer (<foyer>/<plante>.jpg). */
  const addPlant = useCallback(
    async (p: NewPlant, photo: Blob | null) => {
      const householdId = state.householdId
      if (!householdId) return 'Foyer introuvable.'
      const { data, error } = await supabase
        .from('plants')
        .insert({ ...p, household_id: householdId })
        .select('id')
        .single()
      if (error) return error.message

      if (photo) {
        const path = `${householdId}/${data.id}.jpg`
        const upload = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, photo, { contentType: 'image/jpeg', upsert: true })
        // La plante est enregistrée même si la photo échoue : on ne bloque pas l'ajout.
        if (!upload.error) await supabase.from('plants').update({ photo_path: path }).eq('id', data.id)
      }
      await load()
      return null
    },
    [state.householdId, load],
  )

  /** Réglages du foyer (heure du récapitulatif, fuseau horaire). */
  const updateHousehold = useCallback(
    async (fields: Partial<Omit<Household, 'id'>>) => {
      if (!state.householdId) return 'Foyer introuvable.'
      const { error } = await supabase.from('households').update(fields).eq('id', state.householdId)
      if (error) return error.message
      await load()
      return null
    },
    [state.householdId, load],
  )

  const updatePlant = useCallback(
    async (id: string, fields: PlantUpdate) => {
      const { error } = await supabase.from('plants').update(fields).eq('id', id)
      if (error) return error.message
      await load()
      return null
    },
    [load],
  )

  /** Supprime la plante, son historique (en cascade dans la base) et sa photo. */
  const deletePlant = useCallback(
    async (plant: Plant) => {
      const { error } = await supabase.from('plants').delete().eq('id', plant.id)
      if (error) return error.message
      if (plant.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([plant.photo_path])
      await load()
      return null
    },
    [load],
  )

  /** Enregistre un événement manuel (arrosage, engrais, note) ; renvoie son id pour pouvoir l'annuler. */
  const addEvent = useCallback(
    async (plant: Plant, kind: EventKind, note: string | null = null) => {
      const { data, error } = await supabase
        .from('events')
        .insert({ household_id: plant.household_id, plant_id: plant.id, kind, source: 'manual', note })
        .select('id')
        .single()
      if (error) return { id: null, error: error.message }
      await load()
      return { id: data.id as string, error: null }
    },
    [load],
  )

  const water = useCallback((plant: Plant) => addEvent(plant, 'water'), [addEvent])

  const undoEvent = useCallback(
    async (eventId: string) => {
      const { error } = await supabase.from('events').delete().eq('id', eventId)
      await load()
      return error?.message ?? null
    },
    [load],
  )

  const plan = state.household?.floor_plan ?? null
  const rooms = useMemo(() => (plan ? plan.rooms.map((r) => r.name) : ROOMS), [plan])

  return { ...state, plan, rooms, reload: load, updateHousehold, addPlant, updatePlant, deletePlant, addEvent, water, undoEvent }
}
