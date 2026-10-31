import { useState } from 'react'
import { copyHandoffKey } from '../lib/handoff'

/**
 * Affiché dans Safari quand le lien de l'e-mail vient de connecter l'utilisateur
 * sur iPhone : la connexion doit être passée à l'app de l'écran d'accueil.
 */
export function Handoff({ onStay, onCopied }: { onStay: () => void; onCopied: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function copy() {
    setBusy(true)
    setError(null)
    const err = await copyHandoffKey(onCopied)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <main className="login">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} className="login-logo" />
      <h1 className="display">Presque connecté</h1>
      <p className="muted">Le lien s'est ouvert dans Safari. Passe la connexion à l'app Rootline de ton écran d'accueil :</p>
      <ol className="handoff-steps">
        <li>Copie la clé de connexion.</li>
        <li>Ouvre l'app Rootline.</li>
        <li>Touche « Coller la clé de Safari ».</li>
      </ol>
      <div className="stack">
        <button className="btn primary" onClick={copy} disabled={busy}>
          {busy ? 'Copie…' : 'Copier la clé de connexion'}
        </button>
        <button className="btn ghost" onClick={onStay} disabled={busy}>
          Rester dans Safari
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}

/** Après la copie : Safari est déconnecté, la clé attend dans le presse-papiers. */
export function HandoffDone() {
  return (
    <main className="login">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} className="login-logo" />
      <h1 className="display">Clé copiée</h1>
      <p className="muted">
        Ouvre maintenant l'app Rootline depuis ton écran d'accueil et touche « Coller la clé de Safari ». Tu peux fermer
        cet onglet.
      </p>
    </main>
  )
}
