import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Connexion sans mot de passe : Supabase envoie un e-mail contenant un lien et un code.
 * Le code permet de se connecter directement dans l'app installée (utile sur iPhone,
 * où le lien s'ouvre dans Safari et non dans l'app).
 */
export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendEmail(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    setBusy(false)
    if (error) setError(traduire(error.message))
    else setStep('code')
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError(traduire(error.message))
  }

  return (
    <main className="login">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={72} height={72} className="login-logo" />
      <h1 className="display">Rootline</h1>
      <p className="muted">Tes plantes, de la racine à la notification.</p>

      {step === 'email' ? (
        <form onSubmit={sendEmail} className="stack">
          <label className="field">
            <span>Ton adresse e-mail</span>
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prenom@exemple.fr"
            />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Envoi…' : 'Recevoir un lien de connexion'}
          </button>
          <p className="hint">Pas de mot de passe : tu reçois un e-mail, et c'est tout.</p>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="stack">
          <p>
            E-mail envoyé à <strong>{email}</strong>. Clique sur le lien qu'il contient, ou saisis le code ici.
          </p>
          <label className="field">
            <span>Code reçu par e-mail</span>
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,10}"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Vérification…' : 'Se connecter'}
          </button>
          <button type="button" className="btn ghost" onClick={() => setStep('email')}>
            Changer d'adresse
          </button>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}

function traduire(message: string) {
  if (/rate limit|security purposes/i.test(message)) return 'Trop de demandes. Patiente une minute avant de réessayer.'
  if (/expired|invalid/i.test(message)) return 'Code invalide ou expiré. Redemande un e-mail.'
  return message
}
