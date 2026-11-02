import { useEffect, useRef, useState } from 'react'
import { averageInterval } from '../lib/history'
import type { PlantEvent } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'

const DAY = 86_400_000
const SPAN_DAYS = 90
const LIST_SHORT = 6

type Props = {
  events: PlantEvent[]
  /** URL signée de chaque photo de l'historique, par chemin de fichier. */
  photoUrls: Map<string, string>
  onDelete: (id: string) => Promise<string | null>
}

const KIND_LABEL = { water: 'Arrosée', fertilize: 'Engrais', note: 'Note', photo: 'Photo' } as const

/** Historique d'une plante : évolution en photos, frise des 90 derniers jours, puis liste des événements. */
export function History({ events, photoUrls, onDelete }: Props) {
  const [showAll, setShowAll] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<PlantEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const since = Date.now() - SPAN_DAYS * DAY
  const recent = events.filter((e) => new Date(e.occurred_at).getTime() >= since)
  const waterDates = recent.filter((e) => e.kind === 'water').map((e) => new Date(e.occurred_at))
  const avg = averageInterval(waterDates)
  const lastFertilize = events.find((e) => e.kind === 'fertilize')

  const list = showAll ? events : events.slice(0, LIST_SHORT)
  // Photos de la plus ancienne à la plus récente, pour lire l'évolution de gauche à droite.
  const photos = events.filter((e) => e.kind === 'photo' && e.photo_path && photoUrls.has(e.photo_path)).reverse()

  async function confirmDelete() {
    if (!toDelete) return
    setBusy(true)
    const err = await onDelete(toDelete.id)
    setBusy(false)
    setToDelete(null)
    setError(err)
  }

  return (
    <section className="stack tight" aria-labelledby="history-title">
      <h3 id="history-title" className="section-title">
        Historique
      </h3>

      {events.length === 0 ? (
        <p className="small muted">Rien pour l'instant : les arrosages, apports d'engrais, notes et photos apparaîtront ici.</p>
      ) : (
        <>
          <p className="small">
            {waterDates.length === 0
              ? 'Pas arrosée depuis 3 mois.'
              : `${waterDates.length} arrosage${waterDates.length > 1 ? 's' : ''} en 3 mois`}
            {avg != null && ` · tous les ${formatDays(avg)} en moyenne`}
            {lastFertilize && ` · engrais le ${shortDate(new Date(lastFertilize.occurred_at))}`}
          </p>
          {photos.length > 0 && <Evolution photos={photos} urls={photoUrls} onOpen={setViewing} />}
          <Timeline events={recent} since={since} />
          <ul className="event-list">
            {list.map((e) => (
              <li key={e.id}>
                {e.kind === 'photo' && e.photo_path && photoUrls.get(e.photo_path) ? (
                  <button type="button" className="event-thumb" onClick={() => setViewing(e.id)} aria-label={`Voir la photo du ${longDate(new Date(e.occurred_at))}`}>
                    <img src={photoUrls.get(e.photo_path)} alt="" loading="lazy" />
                  </button>
                ) : (
                  <span className={`event-mark kind-${e.kind}`} aria-hidden="true" />
                )}
                <span className="grow event-text">
                  <span>
                    {KIND_LABEL[e.kind]}
                    {e.kind === 'water' && e.source === 'auto' && <span className="muted"> · détecté par le capteur</span>}
                  </span>
                  {e.note && <span className="small muted note-text">{e.note}</span>}
                </span>
                <time className="small muted" dateTime={e.occurred_at}>
                  {longDate(new Date(e.occurred_at))}
                </time>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Supprimer : ${KIND_LABEL[e.kind]} du ${longDate(new Date(e.occurred_at))}`}
                  onClick={() => setToDelete(e)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {events.length > LIST_SHORT && (
            <button type="button" className="btn ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Voir moins' : `Tout voir (${events.length})`}
            </button>
          )}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {viewing && photos.length > 0 && (
        <PhotoViewer photos={photos} urls={photoUrls} startId={viewing} onClose={() => setViewing(null)} />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer cet événement ?"
          message={`${KIND_LABEL[toDelete.kind]} du ${longDate(new Date(toDelete.occurred_at))}. Cette action est définitive.`}
          confirmLabel="Supprimer"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </section>
  )
}

/** Bande de vignettes, de la plus ancienne à la plus récente, qui défile jusqu'à la dernière photo. */
function Evolution({ photos, urls, onOpen }: { photos: PlantEvent[]; urls: Map<string, string>; onOpen: (id: string) => void }) {
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (strip.current) strip.current.scrollLeft = strip.current.scrollWidth
  }, [photos.length])
  return (
    <div className="stack tight">
      <p className="small muted">
        Évolution · {photos.length} photo{photos.length > 1 ? 's' : ''}
        {photos.length > 1 && ` depuis le ${shortDate(new Date(photos[0].occurred_at))}`}
      </p>
      <div className="evolution" ref={strip}>
        {photos.map((p) => (
          <button key={p.id} type="button" className="evolution-item" onClick={() => onOpen(p.id)}>
            <img src={urls.get(p.photo_path!)} alt={p.note ?? ''} loading="lazy" />
            <span className="small muted">{shortDate(new Date(p.occurred_at))}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Photo en grand, avec sa date et sa légende ; flèches (ou glissement) pour passer à la voisine. */
function PhotoViewer({
  photos,
  urls,
  startId,
  onClose,
}: {
  photos: PlantEvent[]
  urls: Map<string, string>
  startId: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(() => Math.max(0, photos.findIndex((p) => p.id === startId)))
  const [touchX, setTouchX] = useState<number | null>(null)
  const p = photos[Math.min(index, photos.length - 1)]
  const go = (d: number) => setIndex((i) => Math.min(photos.length - 1, Math.max(0, i + d)))
  const first = new Date(photos[0].occurred_at).getTime()
  const age = Math.round((new Date(p.occurred_at).getTime() - first) / DAY)

  return (
    <div
      className="dialog-backdrop viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Photo de l'historique"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'ArrowLeft') go(-1)
        if (e.key === 'ArrowRight') go(1)
      }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <figure
        className="viewer"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX == null) return
          const dx = e.changedTouches[0].clientX - touchX
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
          setTouchX(null)
        }}
      >
        <img src={urls.get(p.photo_path!)} alt={p.note ?? 'Photo de la plante'} />
        <figcaption className="stack tight">
          <span>
            {longDate(new Date(p.occurred_at))}
            {index > 0 && age > 0 && <span className="muted"> · {age} j après la première</span>}
          </span>
          {p.note && <span className="small note-text">{p.note}</span>}
          <span className="row viewer-nav">
            <button type="button" className="btn ghost grow" onClick={() => go(-1)} disabled={index === 0}>
              ← Avant
            </button>
            <span className="small muted">
              {index + 1} / {photos.length}
            </span>
            <button type="button" className="btn ghost grow" onClick={() => go(1)} disabled={index === photos.length - 1}>
              Après →
            </button>
          </span>
          <button type="button" className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </figcaption>
      </figure>
    </div>
  )
}

/** Frise des 90 derniers jours : un rond par arrosage, un losange par engrais, un trait par note, un carré par photo. */
function Timeline({ events, since }: { events: PlantEvent[]; since: number }) {
  const [picked, setPicked] = useState<PlantEvent | null>(null)
  const W = 320
  const H = 46
  const PAD = 8
  const now = Date.now()
  const x = (t: number) => PAD + ((t - since) / (now - since)) * (W - 2 * PAD)
  const Y = 18

  // Graduations au premier de chaque mois.
  const months: { t: number; label: string }[] = []
  const d = new Date(since)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  for (d.setMonth(d.getMonth() + 1); d.getTime() <= now; d.setMonth(d.getMonth() + 1))
    months.push({ t: d.getTime(), label: d.toLocaleDateString('fr-FR', { month: 'short' }) })

  const hasFertilize = events.some((e) => e.kind === 'fertilize')
  const hasPhoto = events.some((e) => e.kind === 'photo')

  return (
    <figure className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Frise des arrosages, apports d'engrais, notes et photos sur trois mois">
        <line x1={PAD} x2={W - PAD} y1={Y} y2={Y} className="axis" />
        {months.map((m) => (
          <g key={m.t}>
            <line x1={x(m.t)} x2={x(m.t)} y1={Y - 6} y2={Y + 6} className="axis" />
            <text x={x(m.t) + 3} y={H - 4} className="axis-label">
              {m.label}
            </text>
          </g>
        ))}
        <text x={W - PAD} y={H - 4} className="axis-label" textAnchor="end">
          auj.
        </text>
        {events.map((e) => {
          const cx = x(new Date(e.occurred_at).getTime())
          const active = picked?.id === e.id
          return (
            <g key={e.id} onClick={() => setPicked(active ? null : e)} className="tl-hit">
              <title>{`${KIND_LABEL[e.kind]} · ${longDate(new Date(e.occurred_at))}`}</title>
              <rect x={cx - 7} y={Y - 12} width={14} height={24} fill="transparent" />
              {e.kind === 'water' && <circle cx={cx} cy={Y} r={active ? 6 : 4.5} className="kind-water-fill" />}
              {e.kind === 'fertilize' && (
                <rect x={cx - 4} y={Y - 4} width={8} height={8} transform={`rotate(45 ${cx} ${Y})`} className="kind-fertilize-fill" />
              )}
              {e.kind === 'note' && <line x1={cx} x2={cx} y1={Y - 8} y2={Y + 8} className="kind-note-line" />}
              {e.kind === 'photo' && <rect x={cx - 4} y={Y - 4} width={8} height={8} rx={2} className="kind-photo-fill" />}
            </g>
          )
        })}
      </svg>
      <figcaption className="legend small muted">
        {picked ? (
          <span>
            {KIND_LABEL[picked.kind]} · {longDate(new Date(picked.occurred_at))}
          </span>
        ) : (
          <>
            <span className="legend-item">
              <span className="event-mark kind-water" aria-hidden="true" /> Arrosage
            </span>
            {hasFertilize && (
              <span className="legend-item">
                <span className="event-mark kind-fertilize" aria-hidden="true" /> Engrais
              </span>
            )}
            {hasPhoto && (
              <span className="legend-item">
                <span className="event-mark kind-photo" aria-hidden="true" /> Photo
              </span>
            )}
          </>
        )}
      </figcaption>
    </figure>
  )
}

function formatDays(d: number) {
  const n = Math.max(1, Math.round(d))
  return n === 1 ? 'jours' : `${n} j`
}

export function shortDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function longDate(d: Date) {
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time}`
}
