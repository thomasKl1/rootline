// Calcul de l'urgence d'arrosage d'une plante.
// Fichier partagé : utilisé par l'app (src/lib/status.ts le réexporte) et par la fonction
// serveur notifications. Aucune dépendance, pour tourner dans le navigateur comme dans Deno.

/** Ce dont le calcul a besoin d'une plante (la ligne complète de la table convient). */
export type StatusPlant = {
  sensor_mac: string | null
  moisture_min: number | null
  interval_summer_days: number | null
  interval_winter_days: number | null
}

/** Dernière mesure du capteur de la plante. */
export type StatusReading = { moisture: number | null }

export type Urgency = 'late' | 'today' | 'soon' | 'ok'

export type PlantStatus = {
  urgency: Urgency
  /** Ligne d'état affichée sous le nom, ex. « Humidité 22 % · seuil 30 % ». */
  detail: string
  /** Résumé court pour la liste « Ça va bien », ex. « 48 % » ou « dans 3 j ». */
  short: string
  /** Humidité actuelle (0–100) si un capteur a remonté une mesure. */
  moisture: number | null
  /** La plante s'arrose à la main (pas de capteur, ou capteur sans mesure). */
  manual: boolean
}

const DAY = 86_400_000
const SOON_MARGIN = 5 // points d'humidité au-dessus du seuil pour « bientôt »

/** Avril à septembre = rythme d'été. */
export function isSummer(date = new Date()) {
  const m = date.getMonth() + 1
  return m >= 4 && m <= 9
}

export function intervalFor(plant: StatusPlant, date = new Date()): number | null {
  const summer = plant.interval_summer_days
  const winter = plant.interval_winter_days
  return isSummer(date) ? (summer ?? winter) : (winter ?? summer)
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Nombre de jours calendaires entre deux dates (b − a). */
function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY)
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

export function computeStatus(
  plant: StatusPlant,
  reading: StatusReading | undefined,
  lastWatered: Date | undefined,
  now = new Date(),
): PlantStatus {
  // 1. Plante avec capteur et mesure récente : l'humidité réelle décide.
  if (plant.sensor_mac && reading?.moisture != null) {
    const m = Math.round(reading.moisture)
    const min = plant.moisture_min ?? 25
    const urgency: Urgency = m < min ? 'late' : m < min + SOON_MARGIN ? 'soon' : 'ok'
    return {
      urgency,
      detail: `Humidité ${m} % · seuil ${min} %`,
      short: `${m} %`,
      moisture: m,
      manual: false,
    }
  }

  // 2. Sinon : calendrier selon l'espèce et la saison.
  const interval = intervalFor(plant, now)
  const pending = plant.sensor_mac ? 'En attente du capteur' : 'Sans capteur'
  if (!interval) {
    return { urgency: 'ok', detail: `${pending} · fréquence à définir`, short: 'à régler', moisture: null, manual: true }
  }
  if (!lastWatered) {
    return { urgency: 'today', detail: `${pending} · jamais arrosée ici`, short: "aujourd'hui", moisture: null, manual: true }
  }

  const since = daysBetween(lastWatered, now)
  const dueIn = interval - since
  const sinceText = since === 0 ? "arrosée aujourd'hui" : `arrosée il y a ${plural(since, 'jour')}`
  const urgency: Urgency = dueIn < 0 ? 'late' : dueIn === 0 ? 'today' : dueIn <= 2 ? 'soon' : 'ok'
  const short = dueIn < 0 ? `retard ${-dueIn} j` : dueIn === 0 ? "aujourd'hui" : `dans ${dueIn} j`
  return { urgency, detail: `${pending} · ${sinceText}`, short, moisture: null, manual: true }
}

export const URGENCY_ORDER: Urgency[] = ['late', 'today', 'soon', 'ok']

export const URGENCY_LABEL: Record<Urgency, string> = {
  late: 'En retard',
  today: "Aujourd'hui",
  soon: 'Bientôt',
  ok: 'Ça va bien',
}
