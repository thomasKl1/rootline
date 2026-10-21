import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Plant, PlantEvent, Reading } from './types'

const DAY = 86_400_000
/** Les courbes couvrent au plus 30 jours. */
export const READINGS_DAYS = 30

type History = {
  loading: boolean
  error: string | null
  /** Du plus récent au plus ancien. */
  events: PlantEvent[]
  /** Du plus ancien au plus récent. */
  readings: Reading[]
}

/**
 * Historique d'une plante : ses événements (arrosages, engrais, notes) et, si elle a un capteur,
 * ses mesures des 30 derniers jours. `version` change à chaque rechargement du jardin.
 */
export function usePlantHistory(plant: Plant, version: unknown) {
  const [state, setState] = useState<History>({ loading: true, error: null, events: [], readings: [] })

  const load = useCallback(async () => {
    const since = new Date(Date.now() - READINGS_DAYS * DAY).toISOString()
    const [events, readings] = await Promise.all([
      supabase
        .from('events')
        .select('id, plant_id, occurred_at, source, kind, note')
        .eq('plant_id', plant.id)
        .order('occurred_at', { ascending: false })
        .limit(200),
      plant.sensor_mac
        ? supabase
            .from('readings')
            .select('sensor_mac, measured_at, moisture, conductivity, light, temperature, battery')
            .eq('sensor_mac', plant.sensor_mac)
            .gte('measured_at', since)
            .order('measured_at', { ascending: true })
            .limit(5000)
        : Promise.resolve({ data: [] as Reading[], error: null }),
    ])
    const error = events.error ?? readings.error
    setState({
      loading: false,
      error: error?.message ?? null,
      events: (events.data ?? []) as PlantEvent[],
      readings: (readings.data ?? []) as Reading[],
    })
  }, [plant.id, plant.sensor_mac])

  useEffect(() => {
    void load()
  }, [load, version])

  return state
}

export type Sample = { t: number; v: number }

/** Moyenne des mesures par tranche de temps (une heure, six heures…), pour lisser les courbes. */
export function bucket(readings: Reading[], key: 'moisture' | 'conductivity' | 'light' | 'temperature', size: number): Sample[] {
  const sums = new Map<number, { s: number; n: number }>()
  for (const r of readings) {
    const v = r[key]
    if (v == null) continue
    const b = Math.floor(new Date(r.measured_at).getTime() / size) * size
    const cur = sums.get(b) ?? { s: 0, n: 0 }
    cur.s += v
    cur.n += 1
    sums.set(b, cur)
  }
  return [...sums.entries()].sort((a, b) => a[0] - b[0]).map(([t, { s, n }]) => ({ t: t + size / 2, v: s / n }))
}

/** Intervalle moyen entre deux arrosages, en jours, sur les arrosages donnés (du plus récent au plus ancien). */
export function averageInterval(dates: Date[]): number | null {
  if (dates.length < 2) return null
  const span = dates[0].getTime() - dates[dates.length - 1].getTime()
  return span / DAY / (dates.length - 1)
}
