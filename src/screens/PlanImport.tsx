import { useState, type ChangeEvent } from 'react'
import { validatePlan, type FloorPlan } from '../lib/plan'
import type { useGarden } from '../lib/useGarden'
import { ConfirmDialog } from './ConfirmDialog'

type Garden = ReturnType<typeof useGarden>

/** Importer, remplacer ou retirer le plan de l'appartement (fichier JSON). */
export function PlanImport({ garden, onDone }: { garden: Garden; onDone?: (message: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const hasPlan = garden.plan != null

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      return setError("Ce fichier n'est pas un JSON valide.")
    }
    const invalid = validatePlan(raw)
    if (invalid) return setError(invalid)
    setBusy(true)
    const err = await garden.updateHousehold({ floor_plan: raw as FloorPlan })
    setBusy(false)
    if (err) setError(err)
    else onDone?.(hasPlan ? 'Plan remplacé' : 'Plan importé')
  }

  async function remove() {
    setBusy(true)
    const err = await garden.updateHousehold({ floor_plan: null })
    setBusy(false)
    setConfirmRemove(false)
    if (err) setError(err)
    else onDone?.('Plan retiré')
  }

  return (
    <div className="stack tight">
      <div className="row">
        <label className={`btn ${hasPlan ? 'ghost' : 'primary'} grow center${busy ? ' disabled' : ''}`}>
          <input type="file" accept="application/json,.json" className="visually-hidden" onChange={onFile} disabled={busy} />
          {busy ? 'Enregistrement…' : hasPlan ? 'Remplacer le plan' : 'Importer un plan'}
        </label>
        {hasPlan && (
          <button type="button" className="btn danger grow" onClick={() => setConfirmRemove(true)} disabled={busy}>
            Retirer
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Retirer le plan ?"
          message="L'onglet Plan sera vide et les pièces reviendront à la liste par défaut. Les plantes gardent leur pièce et leur position : elles réapparaîtront si tu réimportes le même plan."
          confirmLabel="Retirer"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  )
}
