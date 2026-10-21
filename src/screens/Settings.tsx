import { useEffect, useState } from 'react'
import { disablePush, enablePush, getPushState, sendTestPush, type PushState } from '../lib/push'
import { supabase } from '../lib/supabase'
import type { useGarden } from '../lib/useGarden'
import { buildExport, deliverFile, formatSize } from '../lib/export'
import { PlanImport } from './PlanImport'
import { SharingCard } from './Sharing'

type Garden = ReturnType<typeof useGarden>

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6) // 6 h → 22 h

type SettingsProps = { email: string | undefined; garden: Garden; onToast: (text: string) => void }

export function Settings({ email, garden, onToast }: SettingsProps) {
  return (
    <main className="screen">
      <header className="home-header">
        <h1 className="display">Réglages</h1>
      </header>

      <Reminders garden={garden} />

      <SharingCard garden={garden} onToast={onToast} />

      <section className="card stack pad-card">
        <div>
          <h2 className="name">Plan de l'appartement</h2>
          <p className="small muted">
            {garden.plan
              ? `${garden.plan.rooms.length} pièces, ${garden.plan.windows.length} fenêtres.`
              : "Aucun plan : importe un fichier JSON décrivant tes pièces et tes fenêtres (voir le guide d'installation)."}
          </p>
        </div>
        <PlanImport garden={garden} />
      </section>

      <ExportCard garden={garden} />

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

function Reminders({ garden }: { garden: Garden }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const hour = garden.household?.reminder_hour ?? 8

  useEffect(() => {
    void getPushState().then(setState)
  }, [])

  async function run(action: () => Promise<string | null>, success: string) {
    setBusy(true)
    setMessage(null)
    const error = await action()
    setBusy(false)
    setState(await getPushState())
    setMessage(error ? { text: error, error: true } : { text: success, error: false })
  }

  async function changeHour(h: number) {
    // On enregistre aussi le fuseau du téléphone, pour que 8 h soit bien 8 h chez toi.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const err = await garden.updateHousehold({ reminder_hour: h, timezone })
    setMessage(err ? { text: err, error: true } : null)
  }

  return (
    <section className="card stack pad-card">
      <div>
        <h2 className="name">Rappels d'arrosage</h2>
        <p className="small muted">
          Chaque jour à {hour} h, un récapitulatif des plantes qui ont soif. Si tout va bien, rien ne
          t'est envoyé.
        </p>
      </div>

      <label className="field">
        <span className="small muted">Heure du récapitulatif</span>
        <select value={hour} onChange={(e) => void changeHour(Number(e.target.value))}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h} h
            </option>
          ))}
        </select>
      </label>

      {state === 'needs-install' && (
        <p className="hint">
          Sur iPhone, ajoute d'abord Rootline à l'écran d'accueil (bouton Partager, puis « Sur l'écran
          d'accueil »), puis ouvre l'app depuis son icône pour activer les rappels.
        </p>
      )}
      {state === 'unsupported' && <p className="hint">Ce navigateur ne permet pas les notifications.</p>}
      {state === 'denied' && (
        <p className="hint">
          Les notifications sont bloquées pour Rootline. Autorise-les dans les réglages du navigateur (ou
          de l'app installée), puis reviens ici.
        </p>
      )}

      {state === 'off' && (
        <button className="btn primary" disabled={busy} onClick={() => run(enablePush, 'Rappels activés sur cet appareil.')}>
          {busy ? 'Activation…' : 'Activer les rappels sur cet appareil'}
        </button>
      )}

      {state === 'on' && (
        <>
          <p className="small tone-ok">Rappels activés sur cet appareil.</p>
          <div className="row">
            <button
              className="btn ghost grow"
              disabled={busy}
              onClick={() => run(sendTestPush, 'Notification envoyée : elle devrait arriver dans quelques secondes.')}
            >
              Tester
            </button>
            <button
              className="btn ghost grow"
              disabled={busy}
              onClick={() => run(async () => (await disablePush(), null), 'Rappels désactivés sur cet appareil.')}
            >
              Désactiver
            </button>
          </div>
        </>
      )}

      {message && (
        <p className={message.error ? 'error' : 'hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  )
}

/** Sauvegarde : l'offre gratuite de Supabase n'en fait pas, alors on en garde une copie chez soi. */
function ExportCard({ garden }: { garden: Garden }) {
  const [step, setStep] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  async function prepare() {
    if (!garden.householdId) return
    setMessage(null)
    setFile(null)
    try {
      setFile(await buildExport(garden.householdId, setStep))
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true })
    }
    setStep(null)
  }

  async function save() {
    if (!file) return
    // Deuxième geste de l'utilisateur : le navigateur autorise alors le téléchargement ou le partage.
    const result = await deliverFile(file)
    if (result !== 'cancelled') {
      setFile(null)
      setMessage({ text: result === 'shared' ? 'Fichier transmis.' : `Fichier enregistré : ${file.name}`, error: false })
    }
  }

  return (
    <section className="card stack pad-card">
      <div>
        <h2 className="name">Exporter mes données</h2>
        <p className="small muted">
          Un fichier avec tout le suivi : plantes et photos, arrosages, engrais, notes, mesures des capteurs et
          plan. L'offre gratuite de Supabase ne fait pas de sauvegarde : garde-en une copie de temps en temps.
        </p>
      </div>
      {file ? (
        <button type="button" className="btn primary" onClick={save}>
          Enregistrer le fichier ({formatSize(file.size)})
        </button>
      ) : (
        <button type="button" className="btn ghost" onClick={prepare} disabled={step !== null || !garden.householdId}>
          {step ?? 'Préparer l’export'}
        </button>
      )}
      {message && (
        <p className={message.error ? 'error' : 'hint'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  )
}
