// Tests de la passerelle, sans réseau ni base : la base est simulée.
// Lancer : deno test -A supabase/functions/ingest-readings/index.test.ts

import { calibrate, cleanMeasure, detectWatering, normalizeMac } from './detect.ts'

function assertEquals(a: unknown, b: unknown) {
  const x = JSON.stringify(a), y = JSON.stringify(b)
  if (x !== y) throw new Error(`attendu ${y}, reçu ${x}`)
}

// --- Base simulée : juste assez du client Supabase pour ingest ----------------------

type Row = Record<string, unknown>
class FakeDb {
  constructor(public tables: Record<string, Row[]>) {}
  from(table: string) {
    return new FakeQuery(this, table)
  }
}
class FakeQuery {
  filters: ((r: Row) => boolean)[] = []
  op: 'select' | 'insert' = 'select'
  payload: Row = {}
  max = Infinity
  orderBy: { col: string; asc: boolean } | null = null
  constructor(private db: FakeDb, private table: string) {}
  select() { return this }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this }
  order(col: string, o: { ascending: boolean }) { this.orderBy = { col, asc: o.ascending }; return this }
  limit(n: number) { this.max = n; return this }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this }
  then(ok: (v: { data: unknown; error: unknown }) => void, ko?: (e: unknown) => void) {
    return this.run().then(ok, ko)
  }
  run(): Promise<{ data: unknown; error: unknown }> {
    const rows = (this.db.tables[this.table] ??= [])
    if (this.op === 'insert') {
      rows.push({ ...this.payload })
      return Promise.resolve({ data: null, error: null })
    }
    let out = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    return Promise.resolve({ data: out.slice(0, this.max), error: null })
  }
}

// deno-lint-ignore no-explicit-any
;(Deno as any).serve = () => {}
const { ingest } = await import('./index.ts')

const NOW = new Date('2026-10-29T18:00:00Z')
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()
const MAC = '5C:85:7E:14:9C:6D'

function garden(extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    plants: [
      { id: 'calathea', household_id: 'maison', name: 'Calathea', sensor_mac: MAC, archived_at: null, sensor_dry: null, sensor_wet: null },
    ],
    readings: [],
    events: [],
    ...extra,
  })
}

// --- Règles ----------------------------------------------------------------------

Deno.test('adresse MAC : normalisée, ou refusée', () => {
  assertEquals(normalizeMac(' 5c-85-7e-14-9c-6d '), MAC)
  assertEquals(normalizeMac('5C:85:7E:14:9C'), null)
  assertEquals(normalizeMac(42), null)
})

Deno.test('mesure nettoyée : NaN, texte et hors plage deviennent null', () => {
  assertEquals(
    cleanMeasure({ sensor_mac: MAC, moisture: 'nan', conductivity: 141, light: -3, temperature: 21.9, battery: 99.6 }),
    { sensor_mac: MAC, moisture: null, conductivity: 141, light: null, temperature: 21.9, battery: 100 },
  )
  assertEquals(cleanMeasure({ sensor_mac: MAC, moisture: null, temperature: null }), null)
  assertEquals(cleanMeasure({ sensor_mac: 'n/a', moisture: 30 }), null)
})

Deno.test('arrosage : bond d’humidité depuis le point bas des 3 dernières heures', () => {
  const prev = [
    { measured_at: ago(15), moisture: 6 },
    { measured_at: ago(30), moisture: 5 },
    { measured_at: ago(300), moisture: 1 }, // trop ancienne : ignorée
  ]
  assertEquals(detectWatering(9, prev, null, NOW), true) // +4 depuis 5
  assertEquals(detectWatering(8, prev, null, NOW), false) // +3 : variation ordinaire
  assertEquals(detectWatering(40, [], null, NOW), false) // rien à comparer
})

Deno.test('arrosage : arrosages réels du 2 novembre (première mesure après arrosage) détectés', () => {
  const flat = (v: number) => [{ measured_at: ago(15), moisture: v }, { measured_at: ago(30), moisture: v }]
  assertEquals(detectWatering(17, flat(11), null, NOW), true) // Ape +6
  assertEquals(detectWatering(21, flat(17), null, NOW), true) // Aphelandra +4
  assertEquals(detectWatering(18, flat(10), null, NOW), true) // Calathea +8
  assertEquals(detectWatering(11, flat(5), null, NOW), true) // Monstera +6
})

Deno.test('calibration : air libre → 0 %, eau → 100 %, bornée et arrondie', () => {
  assertEquals(calibrate(82, 0, 82), 100)
  assertEquals(calibrate(41, null, 82), 50)
  assertEquals(calibrate(17, 0, 82), 20.7)
  assertEquals(calibrate(90, 0, 82), 100) // au-delà de l'eau : bornée
  assertEquals(calibrate(1, 2, 82), 0)
  assertEquals(calibrate(17, null, null), 17) // pas calibré : valeur brute
  assertEquals(calibrate(17, 50, 40), 17) // calibration incohérente : ignorée
  assertEquals(calibrate(null, 0, 82), null)
})

Deno.test('arrosage : pas de doublon après un arrosage récent (manuel ou détecté)', () => {
  const prev = [{ measured_at: ago(15), moisture: 5 }]
  assertEquals(detectWatering(40, prev, new Date(ago(60)), NOW), false)
  assertEquals(detectWatering(40, prev, new Date(ago(7 * 60)), NOW), true)
})

// --- Réception -------------------------------------------------------------------

Deno.test('mesure enregistrée dans le foyer de la plante, capteur inconnu ignoré', async () => {
  const db = garden()
  // deno-lint-ignore no-explicit-any
  const report = await ingest(db as any, {
    readings: [
      { sensor_mac: MAC.toLowerCase(), moisture: 5, conductivity: 15, light: 132, temperature: 21.1, battery: null },
      { sensor_mac: '5C:85:7E:14:9D:92', moisture: 30 },
    ],
  }, NOW)
  assertEquals(report, { stored: 1, waterings: [], ignored: [{ sensor_mac: '5C:85:7E:14:9D:92', reason: 'capteur associé à aucune plante' }] })
  assertEquals(db.tables.readings, [{
    sensor_mac: MAC, moisture: 5, conductivity: 15, light: 132, temperature: 21.1, battery: null,
    moisture_raw: 5, household_id: 'maison', measured_at: NOW.toISOString(),
  }])
})

Deno.test('arrosage détecté : événement automatique créé une seule fois', async () => {
  const db = garden({ readings: [{ sensor_mac: MAC, measured_at: ago(15), moisture: 5 }] })
  // deno-lint-ignore no-explicit-any
  const first = await ingest(db as any, { sensor_mac: MAC, moisture: 42 }, NOW)
  assertEquals(first.waterings, ['Calathea'])
  assertEquals(db.tables.events.map((e) => [e.plant_id, e.kind, e.source]), [['calathea', 'water', 'auto']])

  // Quart d'heure suivant : l'humidité reste haute, pas de second arrosage.
  const later = new Date(NOW.getTime() + 15 * 60_000)
  // deno-lint-ignore no-explicit-any
  const second = await ingest(db as any, { sensor_mac: MAC, moisture: 45 }, later)
  assertEquals(second.waterings, [])
  assertEquals(db.tables.events.length, 1)
})

Deno.test('capteur calibré : humidité calibrée enregistrée, brute gardée, arrosage jugé sur la calibrée', async () => {
  const db = garden({ readings: [{ sensor_mac: MAC, measured_at: ago(15), moisture: 13.4 }] }) // 11 brut
  Object.assign(db.tables.plants[0], { sensor_dry: 0, sensor_wet: 82 })
  // deno-lint-ignore no-explicit-any
  const report = await ingest(db as any, { sensor_mac: MAC, moisture: 14 }, NOW) // +3 brut, +3,7 calibré
  assertEquals(report.waterings, [])
  const row = db.tables.readings.at(-1)!
  assertEquals([row.moisture, row.moisture_raw], [17.1, 14])
})

Deno.test('plante archivée : mesure gardée, pas d’arrosage détecté', async () => {
  const db = garden({ readings: [{ sensor_mac: MAC, measured_at: ago(15), moisture: 5 }] })
  db.tables.plants[0].archived_at = ago(60 * 24)
  // deno-lint-ignore no-explicit-any
  const report = await ingest(db as any, { sensor_mac: MAC, moisture: 42 }, NOW)
  assertEquals(report.stored, 1)
  assertEquals(report.waterings, [])
})
