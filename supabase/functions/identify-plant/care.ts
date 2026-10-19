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
  /**
   * Comment l'espèce a été retrouvée dans Open Plantbook :
   * species = nom exact, synonym = ancien nom botanique, common = nom courant,
   * genus = une autre espèce du même genre (approximatif), null = rien trouvé.
   */
  match: MatchKind | null
}

export type MatchKind = 'species' | 'synonym' | 'common' | 'genus'

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

export function careFromDetail(detail: PlantbookDetail | null, match: MatchKind | null = 'species'): Care {
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
    match: detail ? match : null,
  }
}

/**
 * Renommages botaniques récents. Pl@ntNet suit la classification actuelle, alors
 * qu'Open Plantbook connaît souvent les plantes d'intérieur sous leur ancien nom.
 * [nouveau nom (début), ancien nom], en minuscules.
 */
export const SYNONYMS: [string, string][] = [
  ['goeppertia', 'calathea'],
  ['dracaena trifasciata', 'sansevieria trifasciata'],
  ['dracaena angolensis', 'sansevieria cylindrica'],
  ['thaumatophyllum', 'philodendron'],
  ['epipremnum aureum', 'scindapsus aureus'],
  ['callisia repens', 'tradescantia repens'],
  ['curio rowleyanus', 'senecio rowleyanus'],
]

export type SearchStep = { term: string; kind: MatchKind }

/** Anciens noms possibles pour un nom scientifique. */
export function synonymsOf(scientificName: string): string[] {
  const name = scientificName.trim().toLowerCase()
  const out: string[] = []
  for (const [current, old] of SYNONYMS) {
    if (name.startsWith(current)) out.push(old + name.slice(current.length))
  }
  return [...new Set(out)].filter((n) => n !== name)
}

/** Genres acceptables pour une correspondance approximative (le genre et ses anciens noms). */
export function genusVariants(scientificName: string, genus: string | null): string[] {
  const g = (genus ?? scientificName.split(' ')[0] ?? '').toLowerCase()
  const variants = [g, ...synonymsOf(g)].filter(Boolean)
  return [...new Set(variants)]
}

/**
 * Ordre de recherche dans Open Plantbook, du plus précis au plus approximatif :
 * nom exact, anciens noms, noms courants, puis le genre seul.
 */
export function searchPlan(scientificName: string, genus: string | null, commonNames: string[]): SearchStep[] {
  const steps: SearchStep[] = [{ term: scientificName, kind: 'species' }]
  for (const s of synonymsOf(scientificName)) steps.push({ term: s, kind: 'synonym' })
  for (const c of commonNames.slice(0, 3)) {
    if (c.trim().length >= 3) steps.push({ term: c, kind: 'common' })
  }
  for (const g of genusVariants(scientificName, genus)) steps.push({ term: g, kind: 'genus' })
  // Pas deux fois le même terme.
  const seen = new Set<string>()
  return steps.filter((s) => {
    const key = s.term.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Choisit un résultat de recherche selon l'étape :
 * - nom exact ou ancien nom : la même espèce (ou un cultivar de celle-ci) ;
 * - nom courant ou genre : une plante du même genre, pour ne pas confondre
 *   deux plantes qui partagent un nom courant.
 */
export function pickForStep(
  step: SearchStep,
  results: { pid: string; display_pid?: string }[],
  variants: string[],
): string | null {
  if (step.kind === 'species' || step.kind === 'synonym') return pickPlantbookMatch(step.term, results)
  const hit = results.find((r) => variants.some((g) => r.pid.toLowerCase().startsWith(g + ' ') || r.pid.toLowerCase() === g))
  return hit?.pid ?? null
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

/** Candidat Pl@ntNet, avec les indices qui servent à retrouver ses besoins. */
export type PlantnetMatch = Omit<Candidate, 'care'> & { genus: string | null; commonNames: string[] }

/** Résultat Pl@ntNet → candidat (sans les seuils). */
export function fromPlantnet(r: {
  score?: number
  species?: {
    scientificNameWithoutAuthor?: string
    commonNames?: string[]
    genus?: { scientificNameWithoutAuthor?: string }
    family?: { scientificNameWithoutAuthor?: string }
  }
}): PlantnetMatch | null {
  const name = r.species?.scientificNameWithoutAuthor
  if (!name) return null
  return {
    scientificName: name,
    commonName: r.species?.commonNames?.[0] ?? null,
    family: r.species?.family?.scientificNameWithoutAuthor ?? null,
    score: typeof r.score === 'number' ? r.score : null,
    genus: r.species?.genus?.scientificNameWithoutAuthor ?? null,
    commonNames: r.species?.commonNames ?? [],
  }
}
