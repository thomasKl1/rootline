// Tests du récapitulatif quotidien, sans réseau ni base : la base et l'envoi push sont simulés.
// Lancer : deno test -A supabase/functions/notifications/index.test.ts

import webpush from 'npm:web-push@3.6.7'
import { digestMessage, localClock, toWallClock } from './digest.ts'
import { categoryForSpecies, fertilizerStatus } from './fertilizer.ts'

function assertEquals(a: unknown, b: unknown) {
  const x = JSON.stringify(a), y = JSON.stringify(b)
  if (x !== y) throw new Error(`attendu ${y}, reçu ${x}`)
}

// --- Base simulée : juste assez du client Supabase pour runReminders -----------------

type Row = Record<string, unknown>
class FakeDb {
  tables: Record<string, Row[]>
  constructor(tables: Record<string, Row[]>) {
    this.tables = tables
  }
  from(table: string) {
    return new FakeQuery(this, table)
  }
}
class FakeQuery {
  filters: ((r: Row) => boolean)[] = []
  op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  payload: Row = {}
  max = Infinity
  orderBy: { col: string; asc: boolean } | null = null
  constructor(private db: FakeDb, private table: string) {}
  select() { return this }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this }
  order(col: string, o: { ascending: boolean }) { this.orderBy = { col, asc: o.ascending }; return this }
  limit(n: number) { this.max = n; return this }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this }
  update(row: Row) { this.op = 'update'; this.payload = row; return this }
  delete() { this.op = 'delete'; return this }
  maybeSingle() { return this.run().then(({ data, error }) => ({ data: (data as Row[])?.[0] ?? null, error })) }
  upsert(row: Row) { this.op = 'insert'; this.payload = row; return this }
  then(ok: (v: { data: unknown; error: unknown }) => void, ko?: (e: unknown) => void) {
    return this.run().then(ok, ko)
  }
  run(): Promise<{ data: unknown; error: unknown }> {
    const rows = (this.db.tables[this.table] ??= [])
    const match = (r: Row) => this.filters.every((f) => f(r))
    if (this.op === 'insert') {
      if (this.table === 'reminders_sent' && rows.some((r) => r.household_id === this.payload.household_id && r.local_date === this.payload.local_date)) {
        return Promise.resolve({ data: null, error: { message: 'duplicate key' } })
      }
      rows.push({ ...this.payload })
      return Promise.resolve({ data: null, error: null })
    }
    if (this.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, this.payload)); return Promise.resolve({ data: null, error: null }) }
    if (this.op === 'delete') { this.db.tables[this.table] = rows.filter((r) => !match(r)); return Promise.resolve({ data: null, error: null }) }
    let out = rows.filter(match)
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    return Promise.resolve({ data: out.slice(0, this.max), error: null })
  }
}

// --- Envoi simulé ----------------------------------------------------------------

const sent: { endpoint: string; payload: { title: string; body: string } }[] = []
// deno-lint-ignore no-explicit-any
;(webpush as any).sendNotification = async (sub: { endpoint: string }, payload: string) => {
  if (sub.endpoint.includes('expire')) throw Object.assign(new Error('Gone'), { statusCode: 410 })
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) })
}
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = () => {}
const { runReminders } = await import('./index.ts')

// 20 octobre 2026, 6 h 05 UTC = 8 h 05 à Paris (heure d'été).
const NOW = new Date('2026-10-20T06:05:00Z')
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()

function world() {
  return new FakeDb({
    households: [
      { id: 'paris', timezone: 'Europe/Paris', reminder_hour: 8 },
      { id: 'tokyo', timezone: 'Asia/Tokyo', reminder_hour: 8 },
    ],
    household_members: [{ household_id: 'paris', user_id: 'thomas' }],
    plants: [
      { id: 'p1', household_id: 'paris', name: 'Fougère', sensor_mac: null, moisture_min: null, interval_summer_days: 4, interval_winter_days: 4 },
      { id: 'p2', household_id: 'paris', name: 'Calathea', sensor_mac: null, moisture_min: null, interval_summer_days: 4, interval_winter_days: 8 },
      { id: 'p3', household_id: 'paris', name: 'Monstera', sensor_mac: 'AA', moisture_min: 30, interval_summer_days: 7, interval_winter_days: 14 },
      { id: 'p4', household_id: 'paris', name: 'Sansevieria', sensor_mac: null, moisture_min: null, interval_summer_days: 14, interval_winter_days: 28 },
    ],
    events: [
      { household_id: 'paris', plant_id: 'p1', kind: 'water', occurred_at: iso(6) }, // en retard
      { household_id: 'paris', plant_id: 'p2', kind: 'water', occurred_at: iso(8) }, // aujourd'hui (hiver : 8 j)
      { household_id: 'paris', plant_id: 'p4', kind: 'water', occurred_at: iso(3) }, // ça va
    ],
    readings: [{ household_id: 'paris', sensor_mac: 'AA', moisture: 22, measured_at: iso(0) }], // sous le seuil
    push_subscriptions: [
      { id: 's1', user_id: 'thomas', endpoint: 'https://push/pixel', p256dh: 'x', auth: 'y' },
      { id: 's2', user_id: 'thomas', endpoint: 'https://push/expire', p256dh: 'x', auth: 'y' },
    ],
    app_config: [{ key: 'vapid', value: { publicKey: 'pub', privateKey: 'priv' } }],
    reminders_sent: [],
  })
}

Deno.test("récapitulatif envoyé à l'heure du foyer, une seule fois", async () => {
  sent.length = 0
  const db = world()
  // deno-lint-ignore no-explicit-any
  const report = await runReminders(db as any, NOW)
  assertEquals(report, [{ household: 'paris', status: '1 envoi(s)' }]) // Tokyo : pas son heure
  assertEquals(sent.map((s) => s.endpoint), ['https://push/pixel'])
  assertEquals(sent[0].payload.title, '3 plantes ont soif')
  assertEquals(sent[0].payload.body, "À arroser aujourd'hui : Fougère, Monstera et Calathea.")
  // L'abonnement expiré a été supprimé, le jour est marqué comme traité.
  assertEquals(db.tables.push_subscriptions.map((s) => s.id), ['s1'])
  assertEquals(db.tables.reminders_sent[0].plant_names, ['Fougère', 'Monstera', 'Calathea'])
  // Deuxième passage dans la même heure : rien de plus.
  // deno-lint-ignore no-explicit-any
  assertEquals(await runReminders(db as any, NOW), [{ household: 'paris', status: 'déjà envoyé' }])
  assertEquals(sent.length, 1)
})

Deno.test('pas de notification quand tout va bien', async () => {
  sent.length = 0
  const db = world()
  db.tables.events.push(
    { household_id: 'paris', plant_id: 'p1', kind: 'water', occurred_at: iso(0) },
    { household_id: 'paris', plant_id: 'p2', kind: 'water', occurred_at: iso(0) },
  )
  db.tables.readings.unshift({ household_id: 'paris', sensor_mac: 'AA', moisture: 55, measured_at: iso(0) })
  db.tables.readings.sort((a, b) => (String(a.measured_at) < String(b.measured_at) ? 1 : -1))
  // deno-lint-ignore no-explicit-any
  assertEquals(await runReminders(db as any, NOW), [{ household: 'paris', status: 'rien à arroser' }])
  assertEquals(sent.length, 0)
})

Deno.test('heure et date locales', () => {
  assertEquals(localClock(NOW, 'Europe/Paris'), { hour: 8, date: '2026-10-20' })
  assertEquals(localClock(new Date('2026-12-20T07:30:00Z'), 'Europe/Paris'), { hour: 8, date: '2026-12-20' })
  assertEquals(localClock(new Date('2026-10-19T23:30:00Z'), 'Europe/Paris').date, '2026-10-20')
  const wall = toWallClock(new Date('2026-10-19T23:30:00Z'), 'Europe/Paris')
  assertEquals([wall.getDate(), wall.getHours(), wall.getMinutes()], [20, 1, 30])
})

Deno.test('texte du récapitulatif', () => {
  assertEquals(digestMessage([], []), null)
  assertEquals(digestMessage(['Fougère'], []), { title: 'Fougère a soif', body: "Son arrosage est en retard. Un petit verre d'eau ?" })
  assertEquals(digestMessage([], ['Ficus'])?.body, "C'est le jour de l'arroser.")
  assertEquals(digestMessage(['A', 'B'], ['C', 'D', 'E'])?.body, "À arroser aujourd'hui : A, B, C et 2 autres.")
})

Deno.test('texte du récapitulatif avec engrais', () => {
  assertEquals(digestMessage([], [], ['Calathea']), { title: 'Engrais pour Calathea', body: "C'est le moment de lui donner de l'engrais." })
  assertEquals(digestMessage(['Ficus'], [], ['Calathea', 'Ficus'])?.body, "Son arrosage est en retard. Un petit verre d'eau ? Engrais : Calathea et Ficus.")
  assertEquals(digestMessage([], [], ['A', 'B'])?.title, '2 plantes attendent leur engrais')
})

Deno.test('catégorie d’engrais selon l’espèce', () => {
  assertEquals(categoryForSpecies('Goeppertia roseopicta'), 'sensitive')
  assertEquals(categoryForSpecies('Aphelandra squarrosa Nees'), 'flowering')
  assertEquals(categoryForSpecies('Dracaena trifasciata'), 'succulent')
  assertEquals(categoryForSpecies('Dracaena marginata'), 'sensitive')
  assertEquals(categoryForSpecies('Monstera deliciosa'), 'foliage')
  assertEquals(categoryForSpecies(null), 'foliage')
})

Deno.test('échéance d’engrais', () => {
  const plant = { species: 'Monstera deliciosa', fertilizer_category: null, sensor_mac: null, conductivity_min: 350, conductivity_max: 2000 }
  const june = new Date(2026, 5, 15)
  assertEquals(fertilizerStatus(plant, undefined, null, june).due, true)
  assertEquals(fertilizerStatus(plant, new Date(2026, 5, 10), null, june).detail, 'Engrais dans 9 j')
  assertEquals(fertilizerStatus(plant, new Date(2026, 5, 1), null, june).due, true)
  assertEquals(fertilizerStatus(plant, undefined, null, new Date(2026, 11, 1)).detail, 'Pause hivernale jusqu’en avril')
  const withSensor = { ...plant, sensor_mac: 'AA' }
  assertEquals(fertilizerStatus(withSensor, undefined, 200, june).due, true)
  assertEquals(fertilizerStatus(withSensor, undefined, 2500, june).excess, true)
  assertEquals(fertilizerStatus(withSensor, undefined, 800, june).due, false)
  assertEquals(fertilizerStatus({ ...plant, fertilizer_category: 'none' }, undefined, null, june).due, false)
})
