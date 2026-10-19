export type Plant = {
  id: string
  household_id: string
  name: string
  species: string | null
  species_common: string | null
  photo_path: string | null
  room: string | null
  sensor_mac: string | null
  moisture_min: number | null
  moisture_max: number | null
  interval_summer_days: number | null
  interval_winter_days: number | null
  notes: string | null
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

export type WaterEvent = {
  id: string
  plant_id: string
  occurred_at: string
  source: 'manual' | 'auto'
}

export const ROOMS = ['Salon', 'Chambre', 'Cuisine', 'Bureau', "Salle d'eau", 'Couloir', 'Toilettes'] as const
