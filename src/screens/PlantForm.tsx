import { createContext, useContext } from 'react'
import type { Care } from '../lib/identify'
import { ROOMS, type Plant } from '../lib/types'
import type { NewPlant } from '../lib/useGarden'

type Num = number | ''

/** Pièces proposées dans les formulaires : celles du plan s'il y en a un, sinon la liste par défaut. */
export const RoomsContext = createContext<readonly string[]>(ROOMS)

/** Valeurs du formulaire ; '' = champ vide (seuil inconnu). */
export type PlantFormValues = {
  name: string
  room: string
  summer: number
  winter: number
  moistMin: Num
  moistMax: Num
  ecMin: Num
  ecMax: Num
  lightMin: Num
  /** Adresse du capteur, telle que saisie ('' = pas de capteur). */
  sensor: string
}

const orEmpty = (v: number | null | undefined): Num => (v == null ? '' : v)
const orNull = (v: Num) => (v === '' ? null : v)

/** Adresse de capteur au format AA:BB:CC:DD:EE:FF (minuscules et tirets acceptés à la saisie). */
export function normalizeMac(v: string): string | null {
  const mac = v.trim().toUpperCase().replaceAll('-', ':')
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) ? mac : null
}

export function valuesFromCare(name: string, care: Care | null | undefined): PlantFormValues {
  return {
    name,
    room: '',
    summer: care?.interval_summer_days ?? 7,
    winter: care?.interval_winter_days ?? 14,
    moistMin: orEmpty(care?.moisture_min),
    moistMax: orEmpty(care?.moisture_max),
    ecMin: orEmpty(care?.conductivity_min),
    ecMax: orEmpty(care?.conductivity_max),
    lightMin: orEmpty(care?.light_min),
    sensor: '',
  }
}

export function valuesFromPlant(p: Plant): PlantFormValues {
  return {
    name: p.name,
    room: p.room ?? '',
    summer: p.interval_summer_days ?? 7,
    winter: p.interval_winter_days ?? 14,
    moistMin: orEmpty(p.moisture_min),
    moistMax: orEmpty(p.moisture_max),
    ecMin: orEmpty(p.conductivity_min),
    ecMax: orEmpty(p.conductivity_max),
    lightMin: orEmpty(p.light_min),
    sensor: p.sensor_mac ?? '',
  }
}

/** Remplace les besoins (fréquences et seuils) par ceux d'Open Plantbook, sans toucher au nom ni à la pièce. */
export function applyCare(v: PlantFormValues, care: Care): PlantFormValues {
  const fresh = valuesFromCare(v.name, care)
  return { ...fresh, name: v.name, room: v.room, sensor: v.sensor }
}

export function toPlantFields(v: PlantFormValues): Omit<NewPlant, 'species' | 'species_common'> {
  return {
    name: v.name.trim(),
    room: v.room || null,
    interval_summer_days: v.summer,
    interval_winter_days: v.winter,
    moisture_min: orNull(v.moistMin),
    moisture_max: orNull(v.moistMax),
    conductivity_min: orNull(v.ecMin),
    conductivity_max: orNull(v.ecMax),
    light_min: orNull(v.lightMin),
    sensor_mac: normalizeMac(v.sensor),
  }
}

/** Phrase courte sur l'origine des besoins, affichée sous le nom de l'espèce. */
export function careOrigin(care: Care | null | undefined): string {
  if (!care || care.source === 'default') return 'Besoins par défaut, à ajuster'
  switch (care.match) {
    case 'synonym':
      return 'Besoins Open Plantbook, trouvés sous un ancien nom'
    case 'common':
      return 'Besoins Open Plantbook, trouvés par le nom courant'
    case 'genus':
      return `Besoins approximatifs : ceux de ${care.plantbook_pid ?? 'la même famille'}`
    default:
      return 'Besoins issus d’Open Plantbook'
  }
}

/** Champs communs à l'ajout et à la fiche d'une plante (contrôlés par le parent). */
export function PlantFields({ values, onChange }: { values: PlantFormValues; onChange: (v: PlantFormValues) => void }) {
  const set = <K extends keyof PlantFormValues>(key: K, value: PlantFormValues[K]) => onChange({ ...values, [key]: value })
  const rooms = useContext(RoomsContext)
  // Une pièce qui n'existe plus dans le plan reste affichée, pour ne pas la perdre en silence.
  const options = values.room && !rooms.includes(values.room) ? [...rooms, values.room] : rooms
  return (
    <>
      <label className="field">
        <span>Nom</span>
        <input required maxLength={80} value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="Monstera du salon" />
      </label>

      <label className="field">
        <span>Pièce</span>
        <select value={values.room} onChange={(e) => set('room', e.target.value)}>
          <option value="">Non précisée</option>
          {options.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend>Arrosage sans capteur, tous les…</legend>
        <div className="row">
          <NumberField label="Été (avr.–sept.)" value={values.summer} min={1} max={90} unit="j" onChange={(v) => set('summer', v === '' ? 1 : v)} />
          <NumberField label="Hiver (oct.–mars)" value={values.winter} min={1} max={90} unit="j" onChange={(v) => set('winter', v === '' ? 1 : v)} />
        </div>
      </fieldset>

      <label className="field">
        <span>Capteur Flower Care</span>
        <input
          value={values.sensor}
          onChange={(e) => set('sensor', e.target.value)}
          placeholder="Aucun (ex. 5C:85:7E:14:9C:6D)"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          pattern="[0-9A-Fa-f]{2}([:\-][0-9A-Fa-f]{2}){5}"
          title="Adresse du capteur, au format 5C:85:7E:14:9C:6D"
        />
        <span className="hint">L'adresse relevée au scan de la passerelle. Laisse vide si la plante n'a pas de capteur.</span>
      </label>

      <details className="card pad-card thresholds">
        <summary>
          <span className="name">Seuils pour le capteur</span>
          <span className="small muted">{summarize(values)}</span>
        </summary>
        <div className="stack">
          <div className="row">
            <NumberField label="Humidité min." value={values.moistMin} min={0} max={100} unit="%" onChange={(v) => set('moistMin', v)} />
            <NumberField label="Humidité max." value={values.moistMax} min={0} max={100} unit="%" onChange={(v) => set('moistMax', v)} />
          </div>
          <div className="row">
            <NumberField label="Engrais min." value={values.ecMin} min={0} max={10000} unit="µS/cm" onChange={(v) => set('ecMin', v)} />
            <NumberField label="Engrais max." value={values.ecMax} min={0} max={10000} unit="µS/cm" onChange={(v) => set('ecMax', v)} />
          </div>
          <NumberField label="Lumière min." value={values.lightMin} min={0} max={200000} unit="lux" onChange={(v) => set('lightMin', v)} />
          <span className="hint">Ils serviront dès qu'un capteur sera associé à cette plante.</span>
        </div>
      </details>
    </>
  )
}

function NumberField(props: { label: string; value: Num; min: number; max: number; unit: string; onChange: (v: Num) => void }) {
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

function summarize(v: PlantFormValues) {
  const parts: string[] = []
  const r = (a: Num, b: Num) => `${a === '' ? '?' : a}–${b === '' ? '?' : b}`
  if (v.moistMin !== '' || v.moistMax !== '') parts.push(`humidité ${r(v.moistMin, v.moistMax)} %`)
  if (v.ecMin !== '' || v.ecMax !== '') parts.push(`engrais ${r(v.ecMin, v.ecMax)}`)
  if (v.lightMin !== '') parts.push(`≥ ${v.lightMin} lux`)
  return parts.length ? parts.join(' · ') : 'non renseignés'
}
