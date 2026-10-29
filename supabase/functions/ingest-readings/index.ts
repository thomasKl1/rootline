// Rootline — réception des mesures envoyées par la passerelle ESP32.
//
// Appel de la passerelle (en-tête x-ingest-token = secret INGEST_TOKEN) :
//   POST { readings: [{ sensor_mac, moisture, conductivity, light, temperature, battery }, …] }
//   (un objet seul est aussi accepté)
//
// Pour chaque mesure : retrouve la plante liée au capteur (plants.sensor_mac), enregistre la mesure
// dans son foyer, puis note un arrosage automatique si l'humidité vient de bondir (detect.ts).
// Un capteur lié à aucune plante est ignoré : il n'a pas de foyer où ranger ses mesures.
//
// Déployée avec verify_jwt = false : la passerelle n'a pas de compte. Elle s'authentifie avec le
// secret partagé, stocké dans les secrets des fonctions Supabase (jamais dans le dépôt).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { BASELINE_HOURS, cleanMeasure, detectWatering } from './detect.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Comparaison en temps constant, pour ne pas laisser deviner le secret caractère par caractère. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

type PlantRow = { id: string; household_id: string; name: string; sensor_mac: string; archived_at: string | null }

export async function ingest(db: SupabaseClient, payload: unknown, now = new Date()) {
  const list = Array.isArray((payload as { readings?: unknown })?.readings)
    ? ((payload as { readings: unknown[] }).readings)
    : [payload]
  const measures = list.map(cleanMeasure).filter((m) => m != null).slice(0, 50)
  const report = { stored: 0, waterings: [] as string[], ignored: [] as { sensor_mac: string; reason: string }[] }
  if (measures.length === 0) return report

  const macs = [...new Set(measures.map((m) => m.sensor_mac))]
  const { data: plants, error } = await db.from('plants')
    .select('id, household_id, name, sensor_mac, archived_at').in('sensor_mac', macs)
  if (error) throw error
  const byMac = new Map((plants as PlantRow[] ?? []).map((p) => [p.sensor_mac, p]))

  const measured_at = now.toISOString()
  const since = new Date(now.getTime() - BASELINE_HOURS * 3600_000).toISOString()

  for (const m of measures) {
    const plant = byMac.get(m.sensor_mac)
    if (!plant) {
      report.ignored.push({ sensor_mac: m.sensor_mac, reason: 'capteur associé à aucune plante' })
      continue
    }

    // Arrosage ? Comparé aux mesures précédentes, avant d'enregistrer la nouvelle.
    let watered = false
    if (!plant.archived_at && m.moisture != null) {
      const [previous, lastWater] = await Promise.all([
        db.from('readings').select('measured_at, moisture').eq('sensor_mac', m.sensor_mac)
          .gte('measured_at', since).order('measured_at', { ascending: false }).limit(100),
        db.from('events').select('occurred_at').eq('plant_id', plant.id).eq('kind', 'water')
          .order('occurred_at', { ascending: false }).limit(1),
      ])
      const last = (lastWater.data as { occurred_at: string }[] | null)?.[0]
      watered = detectWatering(
        m.moisture,
        (previous.data ?? []) as { measured_at: string; moisture: number | null }[],
        last ? new Date(last.occurred_at) : null,
        now,
      )
    }

    const { error: insertError } = await db.from('readings').insert({ ...m, household_id: plant.household_id, measured_at })
    if (insertError) throw insertError
    report.stored++

    if (watered) {
      const { error: eventError } = await db.from('events').insert({
        household_id: plant.household_id,
        plant_id: plant.id,
        kind: 'water',
        source: 'auto',
        occurred_at: measured_at,
        created_by: null,
      })
      if (eventError) throw eventError
      report.waterings.push(plant.name)
    }
  }
  return report
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)
  const expected = Deno.env.get('INGEST_TOKEN')
  if (!expected) return json({ error: 'Secret INGEST_TOKEN absent des secrets de la fonction.' }, 500)
  const token = req.headers.get('x-ingest-token') ?? ''
  if (!sameSecret(token, expected)) return json({ error: 'Non autorisé.' }, 401)

  const body = await req.json().catch(() => null)
  if (body == null) return json({ error: 'Corps JSON attendu.' }, 400)
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    return json(await ingest(db, body))
  } catch (e) {
    console.error(e)
    return json({ error: 'Erreur inattendue.' }, 500)
  }
})
