import type { Orientation } from './plan'

export type Plant = {
  id: string
  household_id: string
  name: string
  species: string | null
  species_common: string | null
  photo_path: string | null
  room: string | null
  window_orientation: Orientation | null
  map_x: number | null
  map_y: number | null
  sensor_mac: string | null
  moisture_min: number | null
  moisture_max: number | null
  conductivity_min: number | null
  conductivity_max: number | null
  light_min: number | null
  interval_summer_days: number | null
  interval_winter_days: number | null
  notes: string | null
  /** Catégorie d'engrais choisie à la main ; null = déduite de l'espèce. */
  fertilizer_category: string | null
  created_at: string
}

export type Reading = {
  sensor_mac: string
  measured_at: string
  moisture: number | null
  conductivity: number | null
  light: number | null
  temperature: number | null
  battery: number | null
}

export type EventKind = 'water' | 'fertilize' | 'note'

export type WaterEvent = {
  id: string
  plant_id: string
  occurred_at: string
  source: 'manual' | 'auto'
}

export type PlantEvent = WaterEvent & { kind: EventKind; note: string | null }

/** Pièces proposées tant qu'aucun plan n'est importé. */
export const ROOMS = ['Salon', 'Chambre', 'Cuisine', 'Bureau', "Salle d'eau", 'Couloir', 'Toilettes'] as const
