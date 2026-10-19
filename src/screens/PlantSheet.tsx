import { useState, type FormEvent } from 'react'
import { careForSpecies, type Care } from '../lib/identify'
import { computeStatus } from '../lib/status'
import type { Plant } from '../lib/types'
import type { useGarden } from '../lib/useGarden'
import { ConfirmDialog } from './ConfirmDialog'
import { applyCare, careOrigin, PlantFields, toPlantFields, valuesFromPlant, type PlantFormValues } from './PlantForm'

type Garden = ReturnType<typeof useGarden>

type Props = {
  plant: Plant
  garden: Garden
  onClose: () => void
  onDone: (message: string) => void
}

/** Fiche d'une plante : modifier ses informations, recalculer ses besoins, la supprimer. */
export function PlantSheet({ plant, garden, onClose, onDone }: Props) {
  const [values, setValues] = useState<PlantFormValues>(() => valuesFromPlant(plant))
  const [refreshed, setRefreshed] = useState<Care | null>(null)
  const [busy, setBusy] = useState<'save' | 'care' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const photo = garden.photoUrls.get(plant.id)
  const lastWatered = garden.lastWatered.get(plant.id)
  const status = computeStatus(
    plant,
    plant.sensor_mac ? garden.latestReading.get(plant.sensor_mac) : undefined,
    lastWatered,
  )

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
    const err = await garden.updatePlant(plant.id, toPlantFields(values))
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
      <form
        className="sheet stack"
        onSubmit={save}
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
          <p className={`small tone-${status.urgency}`}>
            {status.detail}
            {lastWatered && !status.detail.includes('arrosée') ? ` · arrosée le ${lastWatered.toLocaleDateString('fr-FR')}` : ''}
          </p>
        </div>

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

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="row">
          <button type="button" className="btn ghost grow" onClick={onClose}>
            Fermer
          </button>
          <button className="btn primary grow" disabled={busy !== null || !values.name.trim()}>
            {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>

        <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
          Supprimer la plante
        </button>
      </form>

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
