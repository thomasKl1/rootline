import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { identifyPhoto, searchSpecies, type Candidate } from '../lib/identify'
import { prepareImage } from '../lib/image'
import { ROOMS } from '../lib/types'
import type { NewPlant } from '../lib/useGarden'

type Props = {
  onCancel: () => void
  onSave: (p: NewPlant, photo: Blob | null) => Promise<string | null>
}

type Step = 'photo' | 'identifying' | 'pick' | 'details'

/**
 * Ajout d'une plante en trois temps :
 * 1. photo (ou saisie manuelle),
 * 2. choix de l'espèce parmi les propositions de Pl@ntNet (ou recherche par nom),
 * 3. fiche pré-remplie avec les seuils Open Plantbook, modifiable avant d'enregistrer.
 */
export function AddPlant({ onCancel, onSave }: Props) {
  const [step, setStep] = useState<Step>('photo')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [chosen, setChosen] = useState<Candidate | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Libère l'URL d'aperçu quand la photo change ou que la feuille se ferme.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setStep('identifying')
    try {
      const { blob, base64 } = await prepareImage(file)
      setPhoto(blob)
      setPreview(URL.createObjectURL(blob))
      const result = await identifyPhoto(base64)
      setCandidates(result.candidates)
      if (result.error) setError(result.error)
      setStep('pick')
    } catch {
      setError("Impossible de lire cette photo. Essaie avec une autre image.")
      setStep('photo')
    }
  }

  function choose(c: Candidate | null) {
    setChosen(c)
    setStep('details')
  }

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div
        className="sheet stack"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
      >
        <div className="grabber" aria-hidden="true" />
        <h2 id="add-title" className="display small">
          Nouvelle plante
        </h2>

        {step === 'photo' && (
          <>
            <label className="photo-drop">
              <input type="file" accept="image/*" capture="environment" onChange={onFile} className="visually-hidden" />
              <CameraIcon />
              <span className="name">Prendre une photo</span>
              <span className="small muted">Une feuille bien visible, en pleine lumière</span>
            </label>
            <div className="row">
              <label className="btn ghost grow center">
                <input type="file" accept="image/*" onChange={onFile} className="visually-hidden" />
                Choisir dans la galerie
              </label>
              <button type="button" className="btn ghost grow" onClick={() => choose(null)}>
                Sans photo
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
        )}

        {step === 'identifying' && (
          <div className="identifying" role="status">
            {preview && <img src={preview} alt="" className="preview" />}
            <p className="muted">Identification de l'espèce…</p>
          </div>
        )}

        {step === 'pick' && (
          <Pick
            preview={preview}
            candidates={candidates}
            error={error}
            onChoose={choose}
            onRetry={() => setStep('photo')}
          />
        )}

        {step === 'details' && (
          <Details
            preview={preview}
            candidate={chosen}
            onBack={() => setStep(photo ? 'pick' : 'photo')}
            onSave={(p) => onSave(p, photo)}
          />
        )}
      </div>
    </div>
  )
}

// --- Choix de l'espèce ------------------------------------------------------------

function Pick(props: {
  preview: string | null
  candidates: Candidate[]
  error: string | null
  onChoose: (c: Candidate | null) => void
  onRetry: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  async function search(e: FormEvent) {
    e.preventDefault()
    setSearching(true)
    setSearchError(null)
    const r = await searchSpecies(query)
    setSearching(false)
    setResults(r.candidates)
    if (r.error) setSearchError(r.error)
    else if (r.candidates.length === 0) setSearchError('Aucune espèce trouvée sous ce nom.')
  }

  const list = results ?? props.candidates
  return (
    <>
      <div className="pick-head">
        {props.preview && <img src={props.preview} alt="" className="thumb-img" />}
        <p className="lead">
          {props.candidates.length > 0
            ? "C'est laquelle ?"
            : (props.error ?? "Pas d'espèce reconnue. Essaie une autre photo, ou cherche par nom.")}
        </p>
      </div>

      {list.length > 0 && (
        <ul className="choices">
          {list.map((c) => (
            <li key={c.scientificName}>
              <button type="button" className="choice" onClick={() => props.onChoose(c)}>
                <span className="choice-text">
                  <span className="name">{displayName(c)}</span>
                  <span className="small muted">
                    <em>{c.scientificName}</em>
                    {c.family ? ` · ${c.family}` : ''}
                  </span>
                </span>
                {c.score != null && <span className="score">{Math.round(c.score * 100)} %</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={search} className="row">
        <label className="field grow">
          <span className="visually-hidden">Chercher une espèce par nom</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher par nom (ex. ficus lyrata)"
            minLength={3}
          />
        </label>
        <button className="btn ghost" disabled={searching || query.trim().length < 3}>
          {searching ? '…' : 'Chercher'}
        </button>
      </form>
      {searchError && <p className="hint">{searchError}</p>}

      <div className="row">
        <button type="button" className="btn ghost grow" onClick={props.onRetry}>
          Autre photo
        </button>
        <button type="button" className="btn ghost grow" onClick={() => props.onChoose(null)}>
          Continuer sans espèce
        </button>
      </div>
    </>
  )
}

// --- Fiche de la plante -----------------------------------------------------------

function Details(props: {
  preview: string | null
  candidate: Candidate | null
  onBack: () => void
  onSave: (p: NewPlant) => Promise<string | null>
}) {
  const c = props.candidate
  const care = c?.care
  const [name, setName] = useState(c ? displayName(c) : '')
  const [room, setRoom] = useState('')
  const [summer, setSummer] = useState(care?.interval_summer_days ?? 7)
  const [winter, setWinter] = useState(care?.interval_winter_days ?? 14)
  const [moistMin, setMoistMin] = useState<number | ''>(care?.moisture_min ?? '')
  const [moistMax, setMoistMax] = useState<number | ''>(care?.moisture_max ?? '')
  const [ecMin, setEcMin] = useState<number | ''>(care?.conductivity_min ?? '')
  const [ecMax, setEcMax] = useState<number | ''>(care?.conductivity_max ?? '')
  const [lightMin, setLightMin] = useState<number | ''>(care?.light_min ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orNull = (v: number | '') => (v === '' ? null : v)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const err = await props.onSave({
      name: name.trim(),
      room: room || null,
      species: c?.scientificName ?? null,
      species_common: c?.commonName ?? null,
      moisture_min: orNull(moistMin),
      moisture_max: orNull(moistMax),
      conductivity_min: orNull(ecMin),
      conductivity_max: orNull(ecMax),
      light_min: orNull(lightMin),
      interval_summer_days: summer,
      interval_winter_days: winter,
    })
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <form onSubmit={submit} className="stack">
      {(props.preview || c) && (
        <div className="pick-head">
          {props.preview && <img src={props.preview} alt="" className="thumb-img" />}
          {c && (
            <p className="small muted">
              <em>{c.scientificName}</em>
              <br />
              {care?.source === 'openplantbook' ? 'Besoins issus d’Open Plantbook' : 'Besoins par défaut, à ajuster'}
            </p>
          )}
        </div>
      )}

      <label className="field">
        <span>Nom</span>
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Monstera du salon" />
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
          <NumberField label="Été (avr.–sept.)" value={summer} min={1} max={90} onChange={(v) => setSummer(v === '' ? 1 : v)} unit="j" />
          <NumberField label="Hiver (oct.–mars)" value={winter} min={1} max={90} onChange={(v) => setWinter(v === '' ? 1 : v)} unit="j" />
        </div>
      </fieldset>

      <details className="card pad-card thresholds">
        <summary>
          <span className="name">Seuils pour le capteur</span>
          <span className="small muted">{summarizeThresholds(moistMin, moistMax, ecMin, ecMax, lightMin)}</span>
        </summary>
        <div className="stack">
          <div className="row">
            <NumberField label="Humidité min." value={moistMin} min={0} max={100} onChange={setMoistMin} unit="%" />
            <NumberField label="Humidité max." value={moistMax} min={0} max={100} onChange={setMoistMax} unit="%" />
          </div>
          <div className="row">
            <NumberField label="Engrais min." value={ecMin} min={0} max={10000} onChange={setEcMin} unit="µS/cm" />
            <NumberField label="Engrais max." value={ecMax} min={0} max={10000} onChange={setEcMax} unit="µS/cm" />
          </div>
          <NumberField label="Lumière min." value={lightMin} min={0} max={200000} onChange={setLightMin} unit="lux" />
          <span className="hint">Ils serviront dès qu'un capteur sera associé à cette plante.</span>
        </div>
      </details>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        <button type="button" className="btn ghost grow" onClick={props.onBack}>
          Retour
        </button>
        <button className="btn primary grow" disabled={busy || !name.trim()}>
          {busy ? 'Ajout…' : 'Ajouter'}
        </button>
      </div>
    </form>
  )
}

function NumberField(props: {
  label: string
  value: number | ''
  min: number
  max: number
  unit: string
  onChange: (v: number | '') => void
}) {
  return (
    <label className="field grow">
      <span className="small muted">{props.label}</span>
      <span className="with-unit">
        <input
          type="number"
          inputMode="numeric"
          min={props.min}
          max={props.max}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <span className="unit">{props.unit}</span>
      </span>
    </label>
  )
}

function summarizeThresholds(mMin: number | '', mMax: number | '', eMin: number | '', eMax: number | '', lux: number | '') {
  const parts: string[] = []
  if (mMin !== '' || mMax !== '') parts.push(`humidité ${mMin === '' ? '?' : mMin}–${mMax === '' ? '?' : mMax} %`)
  if (eMin !== '' || eMax !== '') parts.push(`engrais ${eMin === '' ? '?' : eMin}–${eMax === '' ? '?' : eMax}`)
  if (lux !== '') parts.push(`≥ ${lux} lux`)
  return parts.length ? parts.join(' · ') : 'non renseignés'
}

/** Nom affiché : le nom courant s'il existe (avec majuscule), sinon le nom scientifique. */
function displayName(c: Candidate) {
  const n = c.commonName ?? c.scientificName
  return n.charAt(0).toUpperCase() + n.slice(1)
}

function CameraIcon() {
  return (
    <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
