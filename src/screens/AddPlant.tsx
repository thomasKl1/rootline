import { useState, type FormEvent } from 'react'
import { ROOMS } from '../lib/types'
import type { NewPlant } from '../lib/useGarden'

type Props = {
  onCancel: () => void
  onSave: (p: NewPlant) => Promise<string | null>
}

/**
 * Ajout d'une plante, version manuelle.
 * La photo, l'identification Pl@ntNet et les seuils Open Plantbook arrivent à l'étape suivante.
 */
export function AddPlant({ onCancel, onSave }: Props) {
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  const [summer, setSummer] = useState(7)
  const [winter, setWinter] = useState(14)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const err = await onSave({
      name: name.trim(),
      room: room || null,
      interval_summer_days: summer,
      interval_winter_days: winter,
    })
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet stack"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
      >
        <div className="grabber" aria-hidden="true" />
        <h2 id="add-title" className="display small">
          Nouvelle plante
        </h2>

        <label className="field">
          <span>Nom</span>
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Monstera" autoFocus />
        </label>

        <label className="field">
          <span>Pièce</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">Non précisée</option>
            {ROOMS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>

        <fieldset className="field">
          <legend>Arrosage sans capteur, tous les…</legend>
          <div className="row">
            <label className="field grow">
              <span className="small muted">Été (avr.–sept.)</span>
              <input type="number" min={1} max={90} value={summer} onChange={(e) => setSummer(Number(e.target.value))} />
            </label>
            <label className="field grow">
              <span className="small muted">Hiver (oct.–mars)</span>
              <input type="number" min={1} max={90} value={winter} onChange={(e) => setWinter(Number(e.target.value))} />
            </label>
          </div>
          <span className="hint">En jours. Bientôt proposé automatiquement selon l'espèce.</span>
        </fieldset>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          <button type="button" className="btn ghost grow" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn primary grow" disabled={busy || !name.trim()}>
            {busy ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>
      </form>
    </div>
  )
}
