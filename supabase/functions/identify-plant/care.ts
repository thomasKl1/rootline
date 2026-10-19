// Logique pure, sans dépendance réseau : testable hors de Supabase.

/** Fiche « besoins » d'une espèce telle que renvoyée par Open Plantbook (champs utiles). */
export type PlantbookDetail = {
  pid: string
  display_pid?: string
  min_soil_moist?: number | null
  max_soil_moist?: number | null
  min_soil_ec?: number | null
  max_soil_ec?: number | null
  min_light_lux?: number | null
  max_light_lux?: number | null
  image_url?: string | null
}

export type Care = {
  moisture_min: number | null
  moisture_max: number | null
  conductivity_min: number | null
  conductivity_max: number | null
  light_min: number | null
  interval_summer_days: number
  interval_winter_days: number
  /** D'où viennent les seuils : la base Open Plantbook, ou nos valeurs par défaut. */
  source: 'openplantbook' | 'default'
  plantbook_pid: string | null
}

export type Candidate = {
  scientificName: string
  commonName: string | null
  family: string | null
  score: number | null
  care: Care
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Open Plantbook ne donne pas de fréquence d'arrosage : on la déduit de l'humidité
 * minimale tolérée. Une plante qui supporte un sol très sec (cactus, sansevieria)
 * s'arrose rarement ; une plante qui réclame un sol humide (fougère, calathea), souvent.
 * Ce ne sont que des valeurs de départ, modifiables dans l'app.
 */
export function intervalsFromMoisture(minMoisture: number | null): { summer: number; winter: number } {
  if (minMoisture == null) return { summer: 7, winter: 14 }
  if (minMoisture <= 15) return { summer: 14, winter: 28 }
  if (minMoisture <= 20) return { summer: 10, winter: 20 }
  if (minMoisture <= 30) return { summer: 7, winter: 14 }
  return { summer: 4, winter: 8 }
}

export function careFromDetail(detail: PlantbookDetail | null): Care {
  const moistureMin = num(detail?.min_soil_moist)
  const intervals = intervalsFromMoisture(moistureMin)
  return {
    moisture_min: moistureMin,
    moisture_max: num(detail?.max_soil_moist),
    conductivity_min: num(detail?.min_soil_ec),
    conductivity_max: num(detail?.max_soil_ec),
    light_min: num(detail?.min_light_lux),
    interval_summer_days: intervals.summer,
    interval_winter_days: intervals.winter,
    source: detail ? 'openplantbook' : 'default',
    plantbook_pid: detail?.pid ?? null,
  }
}

/** Choisit, parmi les résultats de recherche Open Plantbook, celui qui correspond à l'espèce. */
export function pickPlantbookMatch(
  scientificName: string,
  results: { pid: string; display_pid?: string }[],
): string | null {
  if (results.length === 0) return null
  const target = scientificName.trim().toLowerCase()
  const exact = results.find(
    (r) => r.pid.toLowerCase() === target || (r.display_pid ?? '').toLowerCase() === target,
  )
  if (exact) return exact.pid
  // Sinon, une variété ou un cultivar de la même espèce (« monstera deliciosa 'variegata' »).
  const sameSpecies = results.find((r) => r.pid.toLowerCase().startsWith(target))
  return sameSpecies?.pid ?? null
}

/** Résultat Pl@ntNet → candidat (sans les seuils). */
export function fromPlantnet(r: {
  score?: number
  species?: {
    scientificNameWithoutAuthor?: string
    commonNames?: string[]
    family?: { scientificNameWithoutAuthor?: string }
  }
}): Omit<Candidate, 'care'> | null {
  const name = r.species?.scientificNameWithoutAuthor
  if (!name) return null
  return {
    scientificName: name,
    commonName: r.species?.commonNames?.[0] ?? null,
    family: r.species?.family?.scientificNameWithoutAuthor ?? null,
    score: typeof r.score === 'number' ? r.score : null,
  }
}
