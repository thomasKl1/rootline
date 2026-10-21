import { useState, type FormEvent } from 'react'
import { usePlantHistory } from '../lib/history'
import { careForSpecies, type Care } from '../lib/identify'
import { ORIENTATION_LABEL, roomOrientations } from '../lib/plan'
import { computeStatus } from '../lib/status'
import type { EventKind, Plant } from '../lib/types'
import type { PlantUpdate, useGarden } from '../lib/useGarden'
import { ConfirmDialog } from './ConfirmDialog'
import { Curves } from './Curves'
import { History } from './History'
import { applyCare, careOrigin, PlantFields, toPlantFields, valuesFromPlant, type PlantFormValues } from './PlantForm'

type Garden = ReturnType<typeof useGarden>

type Props = {
  plant: Plant
  garden: Garden
  onClose: () => void
  onDone: (message: string) => void
  /** Message court après une action (arrosage, engrais, note), avec annulation possible. */
  onToast: (text: string, eventId: string | null) => void
}

/** Fiche d'une plante : actions rapides, mesures, historique, informations modifiables, suppression. */
export function PlantSheet({ plant: initialPlant, garden, onClose, onDone, onToast }: Props) {
  // La fiche suit la version rechargée de la plante (après un déplacement sur le plan, par exemple).
  const plant = garden.plants.find((p) => p.id === initialPlant.id) ?? initialPlant
  const history = usePlantHistory(plant, garden.plants)

  const [values, setValues] = useState<PlantFormValues>(() => valuesFromPlant(plant))
  const [refreshed, setRefreshed] = useState<Care | null>(null)
  const [busy, setBusy] = useState<'save' | 'care' | 'delete' | EventKind | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const photo = garden.photoUrls.get(plant.id)
  const lastWatered = garden.lastWatered.get(plant.id)
  const status = computeStatus(
    plant,
    plant.sensor_mac ? garden.latestReading.get(plant.sensor_mac) : undefined,
    lastWatered,
  )
  const place = [plant.room, plant.window_orientation && `fenêtre ${ORIENTATION_LABEL[plant.window_orientation]}`]
    .filter(Boolean)
    .join(' · ')

  async function log(kind: EventKind, text: string | null = null) {
    setBusy(kind)
    setError(null)
    const { id, error } = await garden.addEvent(plant, kind, text)
    setBusy(null)
    if (error) return setError(error)
    if (kind === 'note') {
      setNote('')
      setNoteOpen(false)
    }
    onToast(kind === 'water' ? `${plant.name} : arrosage noté` : kind === 'fertilize' ? `${plant.name} : engrais noté` : 'Note ajoutée', id)
  }

  async function refreshCare() {
    if (!plant.species) return
    setBusy('care')
    setError(null)
    const { care, error } = await careForSpecies(plant.species, plant.species_common)
    setBusy(null)
    if (error || !care) return setError(error ?? 'Aucune donnée trouvée.')
    setValues((v) => applyCare(v, care))
    setRefreshed(care)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy('save')
    const fields: PlantUpdate = toPlantFields(values)
    if ((fields.room ?? null) !== plant.room) {
      // Nouvelle pièce : l'ancienne position sur le plan n'a plus de sens. L'orientation est celle
      // de la fenêtre de la pièce si elle n'en a qu'une ; sinon, on la précisera en plaçant la plante.
      const orientations = roomOrientations(garden.plan, fields.room ?? null)
      fields.window_orientation = orientations.length === 1 ? orientations[0] : null
      fields.map_x = null
      fields.map_y = null
    }
    const err = await garden.updatePlant(plant.id, fields)
    setBusy(null)
    if (err) setError(err)
    else onDone(`${values.name.trim()} : modifications enregistrées`)
  }

  async function remove() {
    setBusy('delete')
    const err = await garden.deletePlant(plant)
    setBusy(null)
    if (err) {
      setConfirmDelete(false)
      setError(err)
    } else onDone(`${plant.name} supprimée`)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet stack"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plant-title"
      >
        <div className="grabber" aria-hidden="true" />
        {photo && <img src={photo} alt="" className="sheet-photo" />}

        <div>
          <h2 id="plant-title" className="display small">
            {plant.name}
          </h2>
          {plant.species && (
            <p className="small muted">
              <em>{plant.species}</em>
            </p>
          )}
          {place && <p className="small muted">{place}</p>}
          <p className={`small tone-${status.urgency}`}>
            {status.detail}
            {lastWatered && !status.detail.includes('arrosée') ? ` · arrosée le ${lastWatered.toLocaleDateString('fr-FR')}` : ''}
          </p>
        </div>

        <div className="row">
          <button type="button" className="btn primary grow" onClick={() => log('water')} disabled={busy !== null}>
            {busy === 'water' ? '…' : 'Arrosée'}
          </button>
          <button type="button" className="btn ghost grow" onClick={() => log('fertilize')} disabled={busy !== null}>
            {busy === 'fertilize' ? '…' : 'Engrais'}
          </button>
          <button
            type="button"
            className="btn ghost grow"
            aria-expanded={noteOpen}
            onClick={() => setNoteOpen(!noteOpen)}
            disabled={busy !== null}
          >
            Note
          </button>
        </div>

        {noteOpen && (
          <form
            className="stack tight"
            onSubmit={(e) => {
              e.preventDefault()
              if (note.trim()) void log('note', note.trim())
            }}
          >
            <label className="field">
              <span className="small muted">Rempotage, nouvelle feuille, taille…</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} autoFocus />
            </label>
            <button className="btn primary" disabled={busy !== null || !note.trim()}>
              {busy === 'note' ? 'Ajout…' : 'Ajouter la note'}
            </button>
          </form>
        )}

        {plant.sensor_mac && !history.loading && (
          <Curves plant={plant} readings={history.readings} events={history.events} />
        )}

        {history.loading ? (
          <p className="small muted">Chargement de l'historique…</p>
        ) : (
          <History events={history.events} onDelete={garden.undoEvent} />
        )}
        {history.error && (
          <p className="error" role="alert">
            {history.error}
          </p>
        )}

        <details className="card pad-card thresholds">
          <summary>
            <span className="name">Informations et besoins</span>
            <span className="small muted">Nom, pièce, fréquences d'arrosage, seuils du capteur</span>
          </summary>
          <form className="stack" onSubmit={save}>
            {plant.species && (
              <div className="care-refresh">
                <button type="button" className="btn ghost" onClick={refreshCare} disabled={busy !== null}>
                  {busy === 'care' ? 'Recherche…' : "Recalculer les besoins de l'espèce"}
                </button>
                {refreshed && (
                  <p className="hint" role="status">
                    {careOrigin(refreshed)}. Vérifie les valeurs puis enregistre.
                  </p>
                )}
              </div>
            )}
            <PlantFields values={values} onChange={setValues} />
            <button className="btn primary" disabled={busy !== null || !values.name.trim()}>
              {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </form>
        </details>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          <button type="button" className="btn ghost grow" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="btn danger grow" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
            Supprimer
          </button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Supprimer ${plant.name} ?`}
          message="Son historique d'arrosage et sa photo seront aussi supprimés. Cette action est définitive."
          confirmLabel="Supprimer"
          busy={busy === 'delete'}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
