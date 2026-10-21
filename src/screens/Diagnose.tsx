import { Fragment, useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { askClaude, claudeMessage, runDiagnosis, useDiagnoses, type Diagnosis, type Disease } from '../lib/diagnose'
import { prepareImage } from '../lib/image'
import type { Plant } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'

/** Section « Santé » de la fiche plante : demander un diagnostic, relire les précédents. */
export function HealthSection({ plant, context }: { plant: Plant; context: () => string }) {
  const diagnoses = useDiagnoses(plant.id)
  const [asking, setAsking] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Diagnosis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!toDelete) return
    setBusy(true)
    const err = await diagnoses.remove(toDelete)
    setBusy(false)
    setToDelete(null)
    setError(err)
  }

  return (
    <section className="stack tight" aria-labelledby="health-title">
      <h3 id="health-title" className="section-title">
        Santé
      </h3>
      <button type="button" className="btn ghost" onClick={() => setAsking(true)}>
        Un souci ? Demander un diagnostic
      </button>

      {diagnoses.list.length > 0 && (
        <ul className="event-list diag-list">
          {diagnoses.list.map((d) => (
            <li key={d.id} className="diag-item">
              <button
                type="button"
                className="diag-head"
                aria-expanded={open === d.id}
                onClick={() => setOpen(open === d.id ? null : d.id)}
              >
                <span className="grow">
                  <span className="diag-q">{d.question ?? 'Bilan de santé à partir de la photo'}</span>
                  <span className="small muted">{new Date(d.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </span>
                <span aria-hidden="true" className="muted">
                  {open === d.id ? '▴' : '▾'}
                </span>
              </button>
              {open === d.id && (
                <div className="stack tight diag-body">
                  {d.photo_path && diagnoses.photos.get(d.photo_path) && (
                    <img src={diagnoses.photos.get(d.photo_path)} alt="Photo jointe au diagnostic" className="diag-photo" />
                  )}
                  <Answer text={d.answer} />
                  <Diseases list={d.diseases} />
                  <button type="button" className="btn danger" onClick={() => setToDelete(d)}>
                    Supprimer ce diagnostic
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {asking && (
        <DiagnoseDialog
          plant={plant}
          context={context}
          onClose={() => setAsking(false)}
          onSaved={(d) => {
            void diagnoses.reload()
            setOpen(d.id)
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer ce diagnostic ?"
          message="La question, la réponse et la photo jointe seront supprimées. Cette action est définitive."
          confirmLabel="Supprimer"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setToDelete(null)}
        />
      )}
    </section>
  )
}

function DiagnoseDialog(props: { plant: Plant; context: () => string; onClose: () => void; onSaved: (d: Diagnosis) => void }) {
  const { plant, context, onClose, onSaved } = props
  const [photo, setPhoto] = useState<{ blob: Blob; base64: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Diagnosis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const p = await prepareImage(file, 1024)
      setPhoto(p)
      setPreview(URL.createObjectURL(p.blob))
    } catch {
      setError('Cette photo ne peut pas être lue.')
    }
  }

  const canAsk = !!photo || question.trim().length > 0

  async function analyse() {
    setBusy(true)
    setError(null)
    const { diagnosis, error } = await runDiagnosis({ plant, context: context(), question: question.trim() || null, photo })
    setBusy(false)
    if (diagnosis) {
      setResult(diagnosis)
      onSaved(diagnosis)
    }
    setError(error)
  }

  async function claude() {
    setHint(null)
    // Pas d'attente avant le partage : le navigateur exige qu'il suive directement le toucher.
    const outcome = await askClaude(claudeMessage(context(), question.trim() || null), photo?.blob ?? null)
    if (outcome === 'opened')
      setHint(
        photo
          ? 'Claude s’ouvre avec ta question ; joins-y la photo depuis ta galerie. Le texte est aussi copié.'
          : 'Claude s’ouvre avec ta question et la fiche de la plante. Le texte est aussi copié.',
      )
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        e.stopPropagation()
        if (!busy) onClose()
      }}
    >
      <div
        className="dialog diag-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diag-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="diag-title" className="display small">
          {result ? 'Diagnostic' : `Que se passe-t-il avec ${plant.name.split(' ')[0]} ?`}
        </h2>

        {result ? (
          <>
            {preview && <img src={preview} alt="" className="diag-photo" />}
            <Answer text={result.answer} />
            <Diseases list={result.diseases} />
            <p className="hint">
              Avis d'une IA, à prendre comme une piste et non comme une certitude. Il est rangé dans la section Santé
              de la fiche.
            </p>
          </>
        ) : (
          <>
            <label className="photo-drop small-drop">
              <input type="file" accept="image/*" capture="environment" className="visually-hidden" onChange={onFile} disabled={busy} />
              {preview ? <img src={preview} alt="Photo jointe" className="diag-photo" /> : <span className="name">Prendre ou choisir une photo</span>}
              <span className="small muted">{preview ? 'Toucher pour changer' : 'De près, sur la partie abîmée, à la lumière du jour'}</span>
            </label>
            <label className="field">
              <span className="small muted">Ta question ou ce que tu remarques (facultatif avec une photo)</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Les feuilles jaunissent et se recroquevillent depuis une semaine…"
                disabled={busy}
              />
            </label>
            <p className="hint">La fiche de la plante (espèce, emplacement, arrosages, engrais, mesures) est jointe automatiquement.</p>
          </>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {hint && (
          <p className="hint" role="status">
            {hint}
          </p>
        )}

        {result ? (
          <div className="row">
            <button type="button" className="btn ghost grow" onClick={claude}>
              En parler à Claude
            </button>
            <button type="button" className="btn primary grow" onClick={onClose}>
              Fermer
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="btn primary" onClick={analyse} disabled={!canAsk || busy}>
              {busy ? 'Analyse en cours… (jusqu’à 30 s)' : 'Analyser'}
            </button>
            <div className="row">
              <button type="button" className="btn ghost grow" onClick={onClose} disabled={busy}>
                Annuler
              </button>
              <button type="button" className="btn ghost grow" onClick={claude} disabled={!canAsk || busy}>
                Demander à Claude
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Maladies proposées par Pl@ntNet, avec leur probabilité. */
function Diseases({ list }: { list: Disease[] }) {
  if (!list.length) return null
  return (
    <div className="stack tight diseases">
      <p className="small muted">Pistes de Pl@ntNet (reconnaissance d'image des maladies)</p>
      <ul>
        {list.map((d) => (
          <li key={d.name} className="small">
            {d.description} <span className="muted">· {Math.round(d.score * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Affiche la réponse : paragraphes, listes à tirets et **gras**, sans interpréter de HTML. */
export function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let items: string[] = []
  const flush = () => {
    if (items.length) {
      blocks.push(
        <ul key={blocks.length}>
          {items.map((t, i) => (
            <li key={i}>{inline(t)}</li>
          ))}
        </ul>,
      )
      items = []
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line)
    if (bullet) items.push(bullet[1])
    else {
      flush()
      blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>)
    }
  }
  flush()
  return <div className="answer">{blocks}</div>
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}
