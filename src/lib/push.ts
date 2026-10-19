import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * État des notifications sur cet appareil :
 * - needs-install : iPhone/iPad, l'app doit d'abord être ajoutée à l'écran d'accueil ;
 * - unsupported   : navigateur sans notifications push ;
 * - denied        : l'utilisateur les a bloquées (à réautoriser dans les réglages du navigateur) ;
 * - off / on      : prêtes à activer / activées.
 */
export type PushState = 'needs-install' | 'unsupported' | 'denied' | 'off' | 'on'

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return (await currentSubscription()) ? 'on' : 'off'
}

async function callNotifications(body: { action: 'key' | 'test' }) {
  const { data, error } = await supabase.functions.invoke('notifications', { body })
  if (error) {
    let message = 'Le serveur de notifications ne répond pas.'
    if (error instanceof FunctionsHttpError) {
      try {
        message = (await error.context.json()).error ?? message
      } catch {
        /* réponse non JSON */
      }
    }
    throw new Error(message)
  }
  return data
}

/** Clé publique VAPID (base64url) → format attendu par le navigateur. */
function keyToBytes(base64url: string) {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

/** Demande l'autorisation, abonne l'appareil et l'enregistre. Renvoie un message d'erreur ou null. */
export async function enablePush(): Promise<string | null> {
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return 'Notifications refusées. Tu peux les autoriser dans les réglages du navigateur.'
    const { publicKey } = await callNotifications({ action: 'key' })
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }))
    const json = sub.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert(
      { endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      { onConflict: 'endpoint' },
    )
    return error ? error.message : null
  } catch (e) {
    return (e as Error).message
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

/** Envoie une notification de test à tous les appareils abonnés de l'utilisateur. */
export async function sendTestPush(): Promise<string | null> {
  try {
    await callNotifications({ action: 'test' })
    return null
  } catch (e) {
    return (e as Error).message
  }
}
