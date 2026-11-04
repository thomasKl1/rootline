// Rootline — règles de la passerelle : nettoyage des mesures et détection d'un arrosage.
// Sans dépendance, pour être testé sans réseau ni base.

/**
 * Hausse d'humidité (en points de %, après calibration) qui signale un arrosage.
 * Mesuré sur les arrosages réels : la première mesure après l'arrosage monte de 4 à 14 points, puis
 * redescend de quelques points en une heure ; hors arrosage, les variations restent sous 3 points.
 */
export const WATERING_JUMP = 4
/** Fenêtre (heures) dans laquelle on cherche l'humidité la plus basse avant la mesure. */
export const BASELINE_HOURS = 3
/** Délai minimal (heures) après un arrosage, manuel ou détecté, avant d'en détecter un nouveau. */
export const COOLDOWN_HOURS = 6

const HOUR = 3600_000
const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/

export type Measure = {
  sensor_mac: string
  moisture: number | null
  conductivity: number | null
  light: number | null
  temperature: number | null
  battery: number | null
}

/** Adresse au format AA:BB:CC:DD:EE:FF, ou null si elle n'en est pas une (tirets acceptés). */
export function normalizeMac(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const mac = v.trim().toUpperCase().replaceAll('-', ':')
  return MAC.test(mac) ? mac : null
}

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return null
  return n
}

/**
 * Humidité ramenée sur une échelle commune à tous les capteurs : `dry` (capteur à l'air libre) → 0 %,
 * `wet` (capteur plongé dans l'eau) → 100 %. Sans calibration (`wet` vide), la valeur brute est gardée.
 * Arrondie au dixième et bornée à 0–100.
 */
export function calibrate(raw: number | null, dry: number | null, wet: number | null): number | null {
  if (raw == null || wet == null) return raw
  const low = dry ?? 0
  if (wet <= low) return raw
  const v = ((raw - low) / (wet - low)) * 100
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10
}

/**
 * Une mesure envoyée par la passerelle, nettoyée : valeur hors plage ou illisible (NaN, texte) → null.
 * Renvoie null si l'adresse est invalide ou si aucune valeur n'est exploitable.
 */
export function cleanMeasure(raw: unknown): Measure | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const sensor_mac = normalizeMac(r.sensor_mac)
  if (!sensor_mac) return null
  const battery = num(r.battery, 0, 100)
  const m: Measure = {
    sensor_mac,
    moisture: num(r.moisture, 0, 100),
    conductivity: num(r.conductivity, 0, 20000),
    light: num(r.light, 0, 200000),
    temperature: num(r.temperature, -40, 80),
    battery: battery == null ? null : Math.round(battery),
  }
  const { sensor_mac: _, ...values } = m
  return Object.values(values).some((v) => v != null) ? m : null
}

/**
 * Arrosage détecté si l'humidité a monté d'au moins WATERING_JUMP points par rapport à la plus basse
 * des BASELINE_HOURS dernières heures, et qu'aucun arrosage n'a été noté depuis COOLDOWN_HOURS.
 */
export function detectWatering(
  moisture: number | null,
  previous: { measured_at: string; moisture: number | null }[],
  lastWatered: Date | null,
  now: Date,
): boolean {
  if (moisture == null) return false
  if (lastWatered && now.getTime() - lastWatered.getTime() < COOLDOWN_HOURS * HOUR) return false
  const since = now.getTime() - BASELINE_HOURS * HOUR
  const recent = previous
    .filter((p) => p.moisture != null && new Date(p.measured_at).getTime() >= since)
    .map((p) => p.moisture as number)
  if (recent.length === 0) return false
  return moisture - Math.min(...recent) >= WATERING_JUMP
}
