import { useEffect, useRef, useState } from 'react'
import {
  acceptInvite,
  clearInvite,
  inviteUrl,
  pendingInvite,
  previewInvite,
  shareLink,
  useSharing,
  type Invitation,
  type InvitePreview,
  type Person,
} from '../lib/sharing'
import type { useGarden } from '../lib/useGarden'
import { ConfirmDialog } from './ConfirmDialog'

type Garden = ReturnType<typeof useGarden>

type Pending =
  | { kind: 'remove'; person: Person }
  | { kind: 'cancel'; invitation: Invitation }
  | { kind: 'leave' }

/** Carte « Partage » des réglages : les personnes du foyer, les invitations, inviter quelqu'un. */
export function SharingCard({ garden, onToast }: { garden: Garden; onToast: (text: string) => void }) {
  const sharing = useSharing(garden.householdId, garden.plants)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null) // lien qui vient d'être créé
  const isOwner = sharing.me?.role === 'owner'
  const others = sharing.people.filter((p) => !p.is_me)

  async function send(token: string) {
    const url = inviteUrl(token)
    const result = await shareLink(url, sharing.me?.name ?? null)
    if (result === 'copied') onToast('Lien copié : colle-le dans un message')
    if (result === 'failed') setFresh(url)
  }

  async function invite() {
    setBusy(true)
    setError(null)
    const { invitation, error } = await sharing.createInvitation()
    setBusy(false)
    if (error || !invitation) return setError(error ?? "L'invitation n'a pas pu être créée.")
    setFresh(inviteUrl(invitation.token))
    await send(invitation.token)
  }

  async function run() {
    if (!confirm) return
    setBusy(true)
    let err: string | null = null
    if (confirm.kind === 'remove') err = await sharing.removeMember(confirm.person.user_id)
    if (confirm.kind === 'cancel') err = await sharing.cancelInvitation(confirm.invitation.id)
    if (confirm.kind === 'leave') err = await sharing.leave()
    setBusy(false)
    const done = confirm
    setConfirm(null)
    if (err) return setError(err)
    if (done.kind === 'remove') onToast(`${label(done.person)} ne fait plus partie du foyer`)
    if (done.kind === 'cancel') {
      setFresh(null)
      onToast('Invitation annulée')
    }
    if (done.kind === 'leave') {
      onToast('Tu as quitté le foyer')
      await garden.reload()
    }
  }

  return (
    <section className="card stack pad-card">
      <div>
        <h2 className="name">Partage</h2>
        <p className="small muted">
          {others.length === 0
            ? "Invite quelqu'un de la maison : vous verrez les mêmes plantes, le même plan, et recevrez tous les deux les rappels."
            : 'Vous voyez les mêmes plantes et le même plan, et chacun reçoit les rappels sur ses appareils.'}
        </p>
      </div>

      {sharing.people.length > 0 && (
        <ul className="compact-list flush people">
          {sharing.people.map((p) => (
            <li key={p.user_id}>
              <span className="person grow">
                <span className="name">
                  {label(p)}
                  {p.is_me && <span className="muted small"> · toi</span>}
                </span>
                <span className="small muted">
                  {p.role === 'owner' ? 'Propriétaire' : `Membre depuis le ${new Date(p.joined_at).toLocaleDateString('fr-FR')}`}
                  {p.name && p.name !== p.email ? ` · ${p.email}` : ''}
                </span>
              </span>
              {isOwner && !p.is_me && (
                <button type="button" className="btn ghost pill" onClick={() => setConfirm({ kind: 'remove', person: p })} disabled={busy}>
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sharing.invitations.length > 0 && (
        <div className="stack tight">
          <p className="small muted">Invitations en attente</p>
          <ul className="compact-list flush">
            {sharing.invitations.map((i) => (
              <li key={i.id}>
                <span className="person grow">
                  <span>Lien d'invitation</span>
                  <span className="small muted">Valable jusqu'au {new Date(i.expires_at).toLocaleDateString('fr-FR')}</span>
                </span>
                <span className="row">
                  <button type="button" className="btn ghost pill" onClick={() => void send(i.token)} disabled={busy}>
                    Envoyer
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Annuler l'invitation"
                    onClick={() => setConfirm({ kind: 'cancel', invitation: i })}
                    disabled={busy}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fresh && (
        <div className="stack tight">
          <label className="field">
            <span className="small muted">Envoie ce lien à la personne (valable 7 jours, une seule fois) :</span>
            <input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} />
          </label>
        </div>
      )}

      <button type="button" className="btn primary" onClick={invite} disabled={busy}>
        {busy ? '…' : "Inviter quelqu'un"}
      </button>

      {sharing.me && !isOwner && (
        <button type="button" className="btn danger" onClick={() => setConfirm({ kind: 'leave' })} disabled={busy}>
          Quitter ce foyer
        </button>
      )}

      {(error || sharing.error) && (
        <p className="error" role="alert">
          {error ?? sharing.error}
        </p>
      )}

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'remove'
              ? `Retirer ${label(confirm.person)} ?`
              : confirm.kind === 'cancel'
                ? "Annuler l'invitation ?"
                : 'Quitter ce foyer ?'
          }
          message={
            confirm.kind === 'remove'
              ? 'Cette personne ne verra plus vos plantes et ne recevra plus les rappels. Tu pourras la réinviter.'
              : confirm.kind === 'cancel'
                ? 'Le lien ne fonctionnera plus. Tu pourras en créer un autre.'
                : "Tu ne verras plus ces plantes et ne recevras plus leurs rappels. Tu repartiras d'un foyer vide."
          }
          confirmLabel={confirm.kind === 'remove' ? 'Retirer' : confirm.kind === 'cancel' ? 'Annuler le lien' : 'Quitter'}
          busy={busy}
          onConfirm={run}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  )
}

function label(p: Person) {
  return p.name ?? p.email
}

/**
 * Après connexion, propose de rejoindre le foyer d'une invitation reçue par lien.
 * Le jeton est oublié une fois l'invitation acceptée ou refusée.
 */
export function JoinInvite({ garden, onToast }: { garden: Garden; onToast: (text: string) => void }) {
  const [token, setToken] = useState<string | null>(() => pendingInvite())
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toastRef = useRef(onToast)
  useEffect(() => {
    toastRef.current = onToast
  })

  useEffect(() => {
    if (!token) return
    void previewInvite(token).then((p) => {
      // Son propre lien (ou un foyer déjà rejoint) : rien à demander.
      if (p.isMember) {
        clearInvite()
        setToken(null)
        toastRef.current('Tu fais déjà partie de ce foyer')
      } else setPreview(p)
    })
  }, [token])

  if (!token || !preview || garden.loading) return null

  function dismiss() {
    clearInvite()
    setToken(null)
  }

  async function join() {
    if (!token) return
    setBusy(true)
    setError(null)
    const err = await acceptInvite(token)
    setBusy(false)
    if (err) return setError(err)
    dismiss()
    await garden.reload()
    onToast(`Bienvenue dans le foyer de ${preview?.inviter ?? 'ton hôte'}`)
  }

  const usable = preview.status === 'valid'
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="join-title" aria-describedby="join-text">
        <h2 id="join-title" className="display small">
          {usable ? `Rejoindre le foyer de ${preview.inviter ?? 'ton hôte'} ?` : 'Invitation inutilisable'}
        </h2>
        <p id="join-text" className="muted">
          {usable
            ? 'Tu verras ses plantes et son plan, et tu recevras aussi les rappels d’arrosage.'
            : preview.status === 'used'
              ? 'Cette invitation a déjà servi. Demande un nouveau lien.'
              : preview.status === 'expired'
                ? 'Cette invitation a expiré. Demande un nouveau lien.'
                : "Cette invitation n'existe pas ou a été annulée."}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn ghost grow" onClick={dismiss} disabled={busy}>
            {usable ? 'Non merci' : 'Fermer'}
          </button>
          {usable && (
            <button type="button" className="btn primary grow" onClick={join} disabled={busy} autoFocus>
              {busy ? 'Un instant…' : 'Rejoindre'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
