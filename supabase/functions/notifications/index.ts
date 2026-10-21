// Rootline — notifications push et récapitulatif quotidien d'arrosage.
//
// Appels depuis l'app (utilisateur connecté, jeton dans Authorization) :
//   POST { action: "key" }   → clé publique VAPID, pour abonner l'appareil
//   POST { action: "test" }  → notification de test sur les appareils de l'utilisateur
// Appel de la tâche planifiée (en-tête x-cron-secret) :
//   POST {}                  → récapitulatif des foyers dont c'est l'heure de rappel
//
// Déployée avec verify_jwt = false : la tâche planifiée n'a pas de jeton utilisateur.
// L'authentification est donc faite ici : jeton vérifié auprès de Supabase Auth,
// ou secret partagé stocké dans app_config (illisible depuis l'API publique).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { digestMessage, localClock, toWallClock } from './digest.ts'
import { fertilizerStatus, type FertilizerPlant } from './fertilizer.ts'
import { computeStatus, type StatusPlant } from './status.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key, { auth: { persistSession: false } })
}

// --- Configuration serveur ---------------------------------------------------------

type Vapid = { publicKey: string; privateKey: string }

async function getConfig(db: SupabaseClient, key: string): Promise<unknown> {
  const { data } = await db.from('app_config').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

/** Clés VAPID du projet : créées au premier appel, puis réutilisées. */
async function getVapid(db: SupabaseClient): Promise<Vapid> {
  const existing = (await getConfig(db, 'vapid')) as Vapid | null
  if (existing) return existing
  const keys = webpush.generateVAPIDKeys()
  // En cas d'appels simultanés, seule la première insertion compte.
  await db.from('app_config').upsert({ key: 'vapid', value: keys }, { onConflict: 'key', ignoreDuplicates: true })
  return ((await getConfig(db, 'vapid')) as Vapid) ?? keys
}

// --- Envoi --------------------------------------------------------------------------

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string }
type Payload = { title: string; body: string; tag?: string }

/** Envoie à chaque appareil ; supprime les abonnements expirés (404 / 410). Renvoie le nombre d'envois réussis. */
async function sendAll(db: SupabaseClient, subs: Subscription[], payload: Payload): Promise<number> {
  const vapid = await getVapid(db)
  const subject = Deno.env.get('SUPABASE_URL') ?? 'https://supabase.com'
  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { vapidDetails: { subject, ...vapid }, TTL: 12 * 3600, urgency: 'normal' },
        )
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id)
        else console.error('Envoi push', status, (e as Error).message)
      }
    }),
  )
  return sent
}

// --- Récapitulatif quotidien ------------------------------------------------------

type Household = { id: string; timezone: string; reminder_hour: number }

/** Plantes à arroser d'un foyer, calculées comme dans l'app, à l'heure murale du foyer. */
async function thirstyPlants(db: SupabaseClient, h: Household, now: Date) {
  const [plants, events, readings] = await Promise.all([
    db.from('plants')
      .select('id, name, species, sensor_mac, moisture_min, interval_summer_days, interval_winter_days, fertilizer_category, conductivity_min, conductivity_max')
      .eq('household_id', h.id).is('archived_at', null),
    db.from('events').select('plant_id, kind, occurred_at').eq('household_id', h.id).in('kind', ['water', 'fertilize'])
      .order('occurred_at', { ascending: false }).limit(1000),
    db.from('readings').select('sensor_mac, moisture, conductivity').eq('household_id', h.id)
      .order('measured_at', { ascending: false }).limit(500),
  ])
  const lastWatered = new Map<string, Date>()
  const lastFertilized = new Map<string, Date>()
  for (const e of events.data ?? []) {
    const map = e.kind === 'fertilize' ? lastFertilized : lastWatered
    if (!map.has(e.plant_id)) map.set(e.plant_id, toWallClock(new Date(e.occurred_at), h.timezone))
  }
  const latest = new Map<string, { moisture: number | null; conductivity: number | null }>()
  for (const r of readings.data ?? []) if (!latest.has(r.sensor_mac)) latest.set(r.sensor_mac, r)

  const wallNow = toWallClock(now, h.timezone)
  const late: string[] = []
  const today: string[] = []
  const fertilize: string[] = []
  for (const p of (plants.data ?? []) as (StatusPlant & FertilizerPlant & { id: string; name: string })[]) {
    const reading = p.sensor_mac ? latest.get(p.sensor_mac) : undefined
    const s = computeStatus(p, reading, lastWatered.get(p.id), wallNow)
    if (s.urgency === 'late') late.push(p.name)
    else if (s.urgency === 'today') today.push(p.name)
    if (fertilizerStatus(p, lastFertilized.get(p.id), reading?.conductivity, wallNow).due) fertilize.push(p.name)
  }
  return { late, today, fertilize }
}

async function membersSubscriptions(db: SupabaseClient, householdId: string): Promise<Subscription[]> {
  const { data: members } = await db.from('household_members').select('user_id').eq('household_id', householdId)
  const ids = (members ?? []).map((m) => m.user_id)
  if (ids.length === 0) return []
  const { data } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids)
  return (data ?? []) as Subscription[]
}

export async function runReminders(db: SupabaseClient, now = new Date()) {
  const { data: households, error } = await db.from('households').select('id, timezone, reminder_hour')
  if (error) throw error
  const report: { household: string; status: string }[] = []

  for (const h of (households ?? []) as Household[]) {
    const { hour, date } = localClock(now, h.timezone)
    if (hour !== h.reminder_hour) continue

    // Un seul récapitulatif par jour : la ligne est réservée avant l'envoi.
    const { error: dup } = await db.from('reminders_sent').insert({ household_id: h.id, local_date: date })
    if (dup) {
      report.push({ household: h.id, status: 'déjà envoyé' })
      continue
    }

    const { late, today, fertilize } = await thirstyPlants(db, h, now)
    const message = digestMessage(late, today, fertilize)
    if (!message) {
      report.push({ household: h.id, status: 'rien à arroser' })
      continue
    }
    const sent = await sendAll(db, await membersSubscriptions(db, h.id), { ...message, tag: `digest-${date}` })
    await db.from('reminders_sent').update({ plant_names: [...new Set([...late, ...today, ...fertilize])] })
      .eq('household_id', h.id).eq('local_date', date)
    report.push({ household: h.id, status: `${sent} envoi(s)` })
  }
  return report
}

// --- Point d'entrée --------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)
  const db = adminClient()

  try {
    // 1. Tâche planifiée : secret partagé.
    const cronSecret = req.headers.get('x-cron-secret')
    if (cronSecret) {
      const expected = await getConfig(db, 'cron_secret')
      if (typeof expected !== 'string' || cronSecret !== expected) return json({ error: 'Non autorisé.' }, 401)
      return json({ report: await runReminders(db) })
    }

    // 2. Utilisateur connecté : jeton vérifié auprès de Supabase Auth.
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } }
    const user = auth.user
    if (!user) return json({ error: 'Connexion requise.' }, 401)

    const body = await req.json().catch(() => ({}))
    if (body.action === 'key') return json({ publicKey: (await getVapid(db)).publicKey })
    if (body.action === 'test') {
      const { data } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', user.id)
      const subs = (data ?? []) as Subscription[]
      if (subs.length === 0) return json({ error: "Aucun appareil abonné : active d'abord les rappels." }, 400)
      const sent = await sendAll(db, subs, {
        title: 'Rootline est prêt',
        body: 'Les rappels arriveront ici quand une plante aura soif.',
        tag: 'test',
      })
      return json({ sent })
    }
    return json({ error: 'Action inconnue.' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Erreur inattendue.' }, 500)
  }
})
