import { supabase } from '../lib/supabase'

export function Settings({ email }: { email: string | undefined }) {
  return (
    <main className="screen">
      <header className="home-header">
        <h1 className="display">Réglages</h1>
      </header>
      <section className="card stack pad-card">
        <div>
          <p className="small muted">Connecté en tant que</p>
          <p className="name">{email ?? '—'}</p>
        </div>
        <button className="btn ghost" onClick={() => void supabase.auth.signOut()}>
          Se déconnecter
        </button>
      </section>
      <p className="hint pad">Rootline · version de développement</p>
    </main>
  )
}

export function Soon({ title, text }: { title: string; text: string }) {
  return (
    <main className="screen">
      <header className="home-header">
        <h1 className="display">{title}</h1>
      </header>
      <section className="empty">
        <p className="muted">{text}</p>
      </section>
    </main>
  )
}
