import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Plant, Reading, WaterEvent } from './types'

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

type GardenState = {
  loading: boolean
  error: string | null
  householdId: string | null
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
    const membership = await supabase.from('household_members').select('household_id').limit(1).maybeSingle()
    if (membership.error) {
      setState((s) => ({ ...s, loading: false, error: membership.error.message }))
      return
    }
    const householdId = membership.data?.household_id ?? null
    if (!householdId) {
      setState({ ...initial, loading: false, error: 'Aucun foyer trouvé pour ce compte.' })
      return
    }

    const [plants, events, readings] = await Promise.all([
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

    const error = plants.error ?? events.error ?? readings.error
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

  /** Enregistre un arrosage manuel ; renvoie l'id de l'événement pour pouvoir l'annuler. */
  const water = useCallback(
    async (plant: Plant) => {
      const { data, error } = await supabase
        .from('events')
        .insert({ household_id: plant.household_id, plant_id: plant.id, kind: 'water', source: 'manual' })
        .select('id')
        .single()
      if (error) return { id: null, error: error.message }
      await load()
      return { id: data.id as string, error: null }
    },
    [load],
  )

  const undoEvent = useCallback(
    async (eventId: string) => {
      await supabase.from('events').delete().eq('id', eventId)
      await load()
    },
    [load],
  )

  return { ...state, reload: load, addPlant, water, undoEvent }
}
