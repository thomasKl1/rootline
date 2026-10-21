// Engrais : catégorie de la plante, conseil et échéance.
// Fichier partagé : utilisé par l'app (src/lib/fertilizer.ts le réexporte) et par la fonction
// serveur notifications. Aucune dépendance, pour tourner dans le navigateur comme dans Deno.
//
// Les conseils sont des règles générales de jardinage, regroupées par famille de plantes :
// aucune source gratuite ne donne l'engrais idéal espèce par espèce.

export const FERTILIZER_CATEGORIES = [
  'foliage',
  'sensitive',
  'flowering',
  'succulent',
  'orchid',
  'acid',
  'fern',
  'citrus',
  'none',
] as const
export type FertilizerCategory = (typeof FERTILIZER_CATEGORIES)[number]

export type FertilizerAdvice = {
  label: string
  /** Type d'engrais à acheter. */
  product: string
  dose: string
  /** Jours entre deux apports pendant la saison ; null = pas d'engrais. */
  intervalDays: number | null
  /** Mois de la saison d'apport (1 = janvier), bornes comprises. */
  season: [number, number]
  note?: string
}

export const FERTILIZER: Record<FertilizerCategory, FertilizerAdvice> = {
  foliage: {
    label: 'Plante verte',
    product: 'Engrais plantes vertes (riche en azote)',
    dose: 'dose indiquée sur l’emballage',
    intervalDays: 14,
    season: [4, 9],
  },
  sensitive: {
    label: 'Sensible au sel',
    product: 'Engrais plantes vertes',
    dose: 'demi-dose',
    intervalDays: 21,
    season: [4, 9],
    note: 'Sensible aux sels minéraux : eau peu calcaire, et rince le terreau à l’eau claire s’il blanchit.',
  },
  flowering: {
    label: 'Plante fleurie',
    product: 'Engrais plantes fleuries (riche en potassium)',
    dose: 'dose indiquée sur l’emballage',
    intervalDays: 14,
    season: [4, 9],
    note: 'Pendant la floraison ; engrais plantes vertes le reste de la belle saison.',
  },
  succulent: {
    label: 'Cactus, plante grasse',
    product: 'Engrais cactus et plantes grasses (pauvre en azote)',
    dose: 'demi-dose',
    intervalDays: 30,
    season: [5, 8],
  },
  orchid: {
    label: 'Orchidée, broméliacée',
    product: 'Engrais orchidées',
    dose: 'très dilué (quart de dose)',
    intervalDays: 14,
    season: [4, 10],
    note: 'Toujours sur un substrat déjà humide.',
  },
  acid: {
    label: 'Terre acide',
    product: 'Engrais plantes de terre de bruyère',
    dose: 'dose indiquée sur l’emballage',
    intervalDays: 21,
    season: [4, 9],
    note: 'Arrose de préférence à l’eau de pluie ou peu calcaire.',
  },
  fern: {
    label: 'Fougère',
    product: 'Engrais plantes vertes',
    dose: 'demi-dose',
    intervalDays: 30,
    season: [4, 9],
  },
  citrus: {
    label: 'Agrume',
    product: 'Engrais agrumes',
    dose: 'dose indiquée sur l’emballage',
    intervalDays: 14,
    season: [3, 10],
  },
  none: {
    label: 'Sans engrais',
    product: 'Aucun engrais',
    dose: '—',
    intervalDays: null,
    season: [1, 12],
    note: 'Les plantes carnivores se nourrissent seules : l’engrais leur brûle les racines.',
  },
}

// Genres botaniques courants en intérieur → catégorie. Le reste est « plante verte ».
const BY_GENUS: Record<string, FertilizerCategory> = {}
const add = (cat: FertilizerCategory, genera: string) => {
  for (const g of genera.split(' ')) BY_GENUS[g.toLowerCase()] = cat
}
add('sensitive', 'Calathea Goeppertia Maranta Ctenanthe Stromanthe Dracaena Chlorophytum')
add(
  'flowering',
  'Aphelandra Anthurium Saintpaulia Streptocarpus Hibiscus Cyclamen Clivia Medinilla Columnea Aeschynanthus Jasminum Bougainvillea Mandevilla Pelargonium Schlumbergera Spathiphyllum Begonia Hoya',
)
add(
  'succulent',
  'Aloe Echeveria Crassula Haworthia Haworthiopsis Gasteria Sedum Kalanchoe Sansevieria Zamioculcas Opuntia Mammillaria Echinocactus Echinopsis Euphorbia Senecio Curio Agave Lithops Cereus Gymnocalycium Portulacaria Adenium Graptopetalum Pachyphytum',
)
add('orchid', 'Phalaenopsis Dendrobium Oncidium Cattleya Vanda Cymbidium Paphiopedilum Miltonia Guzmania Vriesea Aechmea Tillandsia Neoregelia')
add('acid', 'Gardenia Rhododendron Camellia Azalea Vaccinium Pieris Hydrangea Erica')
add('fern', 'Nephrolepis Asplenium Adiantum Pteris Platycerium Davallia Phlebodium Polypodium Blechnum')
add('citrus', 'Citrus Fortunella')
add('none', 'Dionaea Nepenthes Sarracenia Drosera Pinguicula')

// Espèces rangées à part de leur genre.
const BY_SPECIES: Record<string, FertilizerCategory> = {
  'dracaena trifasciata': 'succulent', // l'ancienne Sansevieria, que Pl@ntNet range dans Dracaena
  'dracaena angolensis': 'succulent',
  'euphorbia pulcherrima': 'flowering', // le poinsettia
}

/** Catégorie déduite du nom scientifique (genre, ou espèce pour quelques exceptions). */
export function categoryForSpecies(species: string | null | undefined): FertilizerCategory {
  if (!species) return 'foliage'
  const words = species.trim().toLowerCase().split(/\s+/)
  const binomial = words.slice(0, 2).join(' ')
  return BY_SPECIES[binomial] ?? BY_GENUS[words[0]] ?? 'foliage'
}

/** Ce dont le calcul a besoin d'une plante (la ligne complète de la table convient). */
export type FertilizerPlant = {
  species: string | null
  fertilizer_category: string | null
  sensor_mac: string | null
  conductivity_min: number | null
  conductivity_max: number | null
}

export function categoryOf(plant: FertilizerPlant): FertilizerCategory {
  const c = plant.fertilizer_category
  return c && (FERTILIZER_CATEGORIES as readonly string[]).includes(c) ? (c as FertilizerCategory) : categoryForSpecies(plant.species)
}

export type FertilizerStatus = {
  category: FertilizerCategory
  advice: FertilizerAdvice
  /** Vrai s'il faut donner de l'engrais maintenant. */
  due: boolean
  /** Trop d'engrais mesuré par le capteur : rincer plutôt que nourrir. */
  excess: boolean
  /** Ligne d'état, ex. « Engrais dans 6 j » ou « Pause hivernale jusqu'en avril ». */
  detail: string
}

const DAY = 86_400_000
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export function inSeason(advice: FertilizerAdvice, date: Date) {
  const m = date.getMonth() + 1
  return m >= advice.season[0] && m <= advice.season[1]
}

/**
 * Échéance d'engrais. Avec un capteur et une mesure de conductivité, la mesure décide :
 * sous le minimum → nourrir, au-dessus du maximum → rincer. Sinon, le calendrier de la catégorie.
 */
export function fertilizerStatus(
  plant: FertilizerPlant,
  lastFertilized: Date | undefined,
  conductivity: number | null | undefined,
  now = new Date(),
): FertilizerStatus {
  const category = categoryOf(plant)
  const advice = FERTILIZER[category]
  const base = { category, advice, due: false, excess: false }

  if (advice.intervalDays == null) return { ...base, detail: 'Pas d’engrais pour cette plante' }

  if (!inSeason(advice, now)) {
    return { ...base, detail: `Pause hivernale jusqu’en ${MONTHS[advice.season[0] - 1]}` }
  }

  if (plant.sensor_mac && conductivity != null) {
    const ec = Math.round(conductivity)
    if (plant.conductivity_max != null && ec > plant.conductivity_max)
      return { ...base, excess: true, detail: `Trop d’engrais (${ec} µS/cm) : rince le terreau à l’eau claire` }
    if (plant.conductivity_min != null && ec < plant.conductivity_min)
      return { ...base, due: true, detail: `Sol pauvre (${ec} µS/cm) : engrais à donner` }
    if (plant.conductivity_min != null || plant.conductivity_max != null)
      return { ...base, detail: `Engrais suffisant (${ec} µS/cm)` }
  }

  if (!lastFertilized) return { ...base, due: true, detail: 'Engrais à donner (aucun apport noté)' }
  const days = Math.floor((now.getTime() - lastFertilized.getTime()) / DAY)
  const left = advice.intervalDays - days
  return left <= 0
    ? { ...base, due: true, detail: `Engrais à donner (dernier il y a ${days} j)` }
    : { ...base, detail: `Engrais dans ${left} j` }
}
