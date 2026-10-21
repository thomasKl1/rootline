import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Invitation en attente : le jeton du lien ?invite=… est gardé dans le navigateur
// le temps de se connecter (le lien de connexion peut rouvrir l'app dans un autre onglet).
// ---------------------------------------------------------------------------

const KEY = 'rootline-invite'

/** Lit ?invite=… dans l'adresse, le range, puis nettoie l'adresse. À appeler au démarrage. */
export function captureInviteFromUrl() {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('invite')
  if (!token) return
  try {
    localStorage.setItem(KEY, token)
  } catch {
    // Navigation privée : l'invitation sera perdue si la page se recharge, rien de grave.
    memoryToken = token
  }
  url.searchParams.delete('invite')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

let memoryToken: string | null = null

export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function clearInvite() {
  memoryToken = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    // rien à nettoyer
  }
}

export function inviteUrl(token: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}?invite=${token}`
}

export type InvitePreview = {
  inviter: string | null
  status: 'valid' | 'used' | 'expired' | 'unknown'
  /** La personne connectée fait déjà partie de ce foyer. */
  isMember: boolean
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const { data, error } = await supabase.rpc('invitation_preview', { p_token: token })
  const row = !error && Array.isArray(data) ? data[0] : null
  if (!row) return { inviter: null, status: 'unknown', isMember: false }
  return { inviter: row.inviter ?? null, status: row.status, isMember: row.is_member === true }
}

const ACCEPT_ERRORS: Record<string, string> = {
  invitation_not_found: "Cette invitation n'existe pas ou a été annulée.",
  invitation_used: 'Cette invitation a déjà servi. Demande un nouveau lien.',
  invitation_expired: 'Cette invitation a expiré. Demande un nouveau lien.',
  has_plants:
    'Ton compte suit déjà ses propres plantes. Supprime-les d’abord, ou connecte-toi avec une autre adresse pour rejoindre ce foyer.',
  has_members: 'Tu partages déjà ton foyer avec quelqu’un : retire ses membres avant de rejoindre un autre foyer.',
  not_allowed: "Tu n'as pas le droit de faire cela.",
  owner_cannot_leave: 'Tu es le propriétaire de ce foyer : tu ne peux pas le quitter.',
}

/** Message en français pour une erreur levée par une fonction de partage. */
export function sharingError(message: string) {
  const code = Object.keys(ACCEPT_ERRORS).find((k) => message.includes(k))
  return code ? ACCEPT_ERRORS[code] : message
}

export async function acceptInvite(token: string): Promise<string | null> {
  const { error } = await supabase.rpc('accept_invitation', { p_token: token })
  return error ? sharingError(error.message) : null
}

// ---------------------------------------------------------------------------
// Membres et invitations du foyer
// ---------------------------------------------------------------------------

export type Person = {
  user_id: string
  name: string | null
  email: string
  role: 'owner' | 'member'
  joined_at: string
  is_me: boolean
}

export type Invitation = { id: string; token: string; created_at: string; expires_at: string }

/** Personnes du foyer et invitations encore valables. `version` change à chaque rechargement du jardin. */
export function useSharing(householdId: string | null, version: unknown) {
  const [people, setPeople] = useState<Person[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!householdId) return
    const [p, i] = await Promise.all([
      supabase.rpc('household_people'),
      supabase
        .from('invitations')
        .select('id, token, created_at, expires_at')
        .eq('household_id', householdId)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    ])
    setError(p.error?.message ?? i.error?.message ?? null)
    setPeople((p.data ?? []) as Person[])
    setInvitations((i.data ?? []) as Invitation[])
  }, [householdId])

  useEffect(() => {
    void load()
  }, [load, version])

  const createInvitation = useCallback(async () => {
    if (!householdId) return { invitation: null, error: 'Foyer introuvable.' }
    const { data, error } = await supabase
      .from('invitations')
      .insert({ household_id: householdId })
      .select('id, token, created_at, expires_at')
      .single()
    await load()
    return { invitation: (data as Invitation | null) ?? null, error: error?.message ?? null }
  }, [householdId, load])

  const cancelInvitation = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('invitations').delete().eq('id', id)
      await load()
      return error?.message ?? null
    },
    [load],
  )

  const removeMember = useCallback(
    async (userId: string) => {
      const { error } = await supabase.rpc('remove_member', { p_user: userId })
      await load()
      return error ? sharingError(error.message) : null
    },
    [load],
  )

  const leave = useCallback(async () => {
    const { error } = await supabase.rpc('leave_household')
    return error ? sharingError(error.message) : null
  }, [])

  const me = people.find((p) => p.is_me) ?? null
  return { people, invitations, error, me, reload: load, createInvitation, cancelInvitation, removeMember, leave }
}

/** Ouvre la feuille de partage du téléphone ; à défaut, copie le lien. Renvoie ce qui s'est passé. */
export async function shareLink(url: string, inviter: string | null): Promise<'shared' | 'copied' | 'failed'> {
  const text = `${inviter ? `${inviter} t'invite` : 'Je t’invite'} à suivre nos plantes sur Rootline :`
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Rootline', text, url })
      return 'shared'
    } catch (e) {
      // Partage fermé par l'utilisateur : ce n'est pas une erreur, on ne copie pas non plus.
      if (e instanceof DOMException && e.name === 'AbortError') return 'failed'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
