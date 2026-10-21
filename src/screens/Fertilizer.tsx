import { useState } from 'react'
import {
  categoryForSpecies,
  FERTILIZER,
  FERTILIZER_CATEGORIES,
  type FertilizerCategory,
  type FertilizerStatus,
} from '../lib/fertilizer'
import type { Plant } from '../lib/types'
import type { useGarden } from '../lib/useGarden'

type Garden = ReturnType<typeof useGarden>

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** « d'avril », « de mai ». */
const from = (m: number) => (/^[aeiouo]/.test(MONTHS[m - 1]) ? `d’${MONTHS[m - 1]}` : `de ${MONTHS[m - 1]}`)

function rhythm(days: number) {
  if (days % 7 === 0) return days === 7 ? 'chaque semaine' : `toutes les ${days / 7} semaines`
  if (days >= 28 && days <= 31) return 'une fois par mois'
  return `tous les ${days} jours`
}

/** Conseil d'engrais de la fiche plante, avec la catégorie modifiable. */
export function FertilizerCard({ plant, garden, status }: { plant: Plant; garden: Garden; status: FertilizerStatus }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const auto = categoryForSpecies(plant.species)
  const a = status.advice

  async function change(value: string) {
    setBusy(true)
    setError(null)
    // « Automatique » = colonne vide : la catégorie suivra l'espèce si elle change.
    const category = value === 'auto' ? null : (value as FertilizerCategory)
    const err = await garden.updatePlant(plant.id, { fertilizer_category: category })
    setBusy(false)
    setError(err)
  }

  return (
    <section className="card stack tight pad-card" aria-labelledby="fert-title">
      <div className="section-head">
        <h3 id="fert-title" className="section-title">
          Engrais
        </h3>
        <span className={`small${status.due ? ' tone-today' : status.excess ? ' tone-late' : ' muted'}`}>{status.detail}</span>
      </div>
      <p className="name fert-product">{a.product}</p>
      {a.intervalDays != null && (
        <p className="small">
          {a.dose[0].toUpperCase() + a.dose.slice(1)}, {rhythm(a.intervalDays)}, {from(a.season[0])} à {MONTHS[a.season[1] - 1]}.
        </p>
      )}
      {a.note && <p className="small muted">{a.note}</p>}
      <label className="field">
        <span className="small muted">Type de plante</span>
        <select value={plant.fertilizer_category ?? 'auto'} onChange={(e) => void change(e.target.value)} disabled={busy}>
          <option value="auto">Automatique : {FERTILIZER[auto].label.toLowerCase()}</option>
          {FERTILIZER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {FERTILIZER[c].label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">Règles générales de jardinage, déduites de la famille de la plante : suis aussi l'étiquette de ton engrais.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
