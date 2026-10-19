import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Plant, Reading, WaterEvent } from './types'

export type NewPlant = {
  name: string
  room: string | null
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
}

const initial: GardenState = {
  loading: true,
  error: null,
  householdId: null,
  plants: [],
  lastWatered: new Map(),
  latestReading: new Map(),
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

    setState({
      loading: false,
      error: null,
      householdId,
      plants: (plants.data ?? []) as Plant[],
      lastWatered,
      latestReading,
    })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const addPlant = useCallback(
    async (p: NewPlant) => {
      if (!state.householdId) return 'Foyer introuvable.'
      const { error } = await supabase.from('plants').insert({ ...p, household_id: state.householdId })
      if (error) return error.message
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
