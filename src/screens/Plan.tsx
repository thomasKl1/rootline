import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  labelPoint,
  nearestWindow,
  ORIENTATION_LABEL,
  roomAt,
  roomOrientations,
  type FloorPlan,
  type Point,
} from '../lib/plan'
import { computeStatus, type PlantStatus } from '../lib/status'
import type { Plant } from '../lib/types'
import type { useGarden } from '../lib/useGarden'
import { PlanImport } from './PlanImport'

type Garden = ReturnType<typeof useGarden>

type Props = {
  garden: Garden
  onOpen: (plant: Plant) => void
  onToast: (text: string) => void
}

/** Rayon d'une pastille et tailles de texte, en pixels d'écran. */
const PIN_PX = 17
const ROOM_FONT_PX = 13
const WINDOW_FONT_PX = 11
/** Marge autour du dessin, pour les étiquettes des fenêtres posées sur les murs extérieurs. */
const MARGIN_PX = 24

export function PlanScreen({ garden, onOpen, onToast }: Props) {
  const plan = garden.plan
  return (
    <main className="screen">
      <header className="home-header">
        <h1 className="display">Plan</h1>
        {plan && <p className="lead">Touche une pièce pour voir ses plantes et ses fenêtres.</p>}
      </header>
      {garden.loading && <p className="muted pad">Chargement…</p>}
      {!garden.loading && !plan && (
        <section className="empty">
          <h2 className="display small">Pas encore de plan</h2>
          <p className="muted">
            Importe le plan de ton appartement (un fichier JSON, voir le guide d'installation) pour y placer
            tes plantes. Les pièces du plan remplaceront alors la liste des pièces.
          </p>
          <PlanImport garden={garden} onDone={onToast} />
        </section>
      )}
      {plan && <PlanView plan={plan} garden={garden} onOpen={onOpen} onToast={onToast} />}
    </main>
  )
}

function PlanView({ plan, garden, onOpen, onToast }: Props & { plan: FloorPlan }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [scale, setScale] = useState(1) // pixels d'écran par unité du plan
  const [editing, setEditing] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null) // plante à poser (choisie dans la liste)
  const [drag, setDrag] = useState<{ id: string; at: Point; moved: boolean } | null>(null)
  // Positions déjà déplacées mais pas encore rechargées depuis la base.
  const [pending, setPending] = useState<Map<string, Point>>(new Map())

  const W = plan.width
  const H = plan.height
  // Un plan en largeur est tourné d'un quart de tour pour remplir l'écran du téléphone.
  const rotated = W > H * 1.15
  const DW = rotated ? H : W
  const DH = rotated ? W : H
  const toD = ([x, y]: Point): Point => (rotated ? [H - y, x] : [x, y])
  const fromD = ([u, v]: Point): Point => (rotated ? [v, H - u] : [u, v])
  const north = ((plan.north ?? 0) + (rotated ? 90 : 0)) % 360

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // La marge (MARGIN_PX de chaque côté) est en pixels d'écran : on en tient compte dans l'échelle.
    const measure = () => setScale(Math.max(0.05, (svg.clientWidth - 2 * MARGIN_PX) / DW) || 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [DW])

  // Quand la base a été rechargée, les positions en attente ne servent plus.
  useEffect(() => setPending(new Map()), [garden.plants])

  const statuses = useMemo(() => {
    const m = new Map<string, PlantStatus>()
    for (const p of garden.plants)
      m.set(p.id, computeStatus(p, p.sensor_mac ? garden.latestReading.get(p.sensor_mac) : undefined, garden.lastWatered.get(p.id)))
    return m
  }, [garden.plants, garden.latestReading, garden.lastWatered])

  const positionOf = (p: Plant): Point | null => {
    if (drag?.id === p.id) return drag.at
    const pend = pending.get(p.id)
    if (pend) return toD(pend)
    if (p.map_x == null || p.map_y == null) return null
    return toD([p.map_x * W, p.map_y * H])
  }

  const placed = garden.plants.filter((p) => positionOf(p))
  const unplaced = garden.plants.filter((p) => !positionOf(p))

  /** Point du plan (unités d'affichage) sous le doigt. */
  function pointer(e: { clientX: number; clientY: number }): Point | null {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return [Math.max(0, Math.min(DW, pt.x)), Math.max(0, Math.min(DH, pt.y))]
  }

  async function place(plant: Plant, display: Point) {
    const p = fromD(display)
    const room = roomAt(plan, p)
    if (!room) {
      onToast('Pose la plante dans une pièce du plan')
      return
    }
    const orientation = nearestWindow(plan, room.name, p)
    setPending((m) => new Map(m).set(plant.id, p))
    const err = await garden.updatePlant(plant.id, {
      map_x: p[0] / W,
      map_y: p[1] / H,
      room: room.name,
      window_orientation: orientation,
    })
    if (err) {
      setPending((m) => {
        const n = new Map(m)
        n.delete(plant.id)
        return n
      })
      onToast(err)
    } else if (plant.room !== room.name || plant.window_orientation !== orientation) {
      onToast(`${plant.name} : ${room.name}${orientation ? `, fenêtre ${ORIENTATION_LABEL[orientation]}` : ''}`)
    }
  }

  function onPinDown(e: ReactPointerEvent, plant: Plant) {
    if (!editing) return
    e.stopPropagation()
    const at = pointer(e)
    if (!at) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setArmed(null)
    setDrag({ id: plant.id, at: positionOf(plant) ?? at, moved: false })
  }

  function onPinMove(e: ReactPointerEvent) {
    if (!drag) return
    const at = pointer(e)
    if (at) setDrag({ ...drag, at, moved: true })
  }

  function onPinUp(plant: Plant) {
    if (!drag) return
    const { at, moved } = drag
    setDrag(null)
    if (moved) void place(plant, at)
  }

  function onPlanClick(e: React.MouseEvent) {
    const at = pointer(e)
    if (!at) return
    if (editing) {
      const plant = garden.plants.find((p) => p.id === armed)
      if (plant) {
        setArmed(null)
        void place(plant, at)
      }
      return
    }
    const room = roomAt(plan, fromD(at))
    setSelectedRoom(room && room.name !== selectedRoom ? room.name : null)
  }

  const r = PIN_PX / scale
  const roomPlants = selectedRoom ? garden.plants.filter((p) => p.room === selectedRoom) : []
  const orientations = roomOrientations(plan, selectedRoom)

  return (
    <>
      <div className={`plan-wrap card${editing ? ' editing' : ''}`}>
        <svg
          ref={svgRef}
          className="plan"
          viewBox={`${-MARGIN_PX / scale} ${-MARGIN_PX / scale} ${DW + (2 * MARGIN_PX) / scale} ${DH + (2 * MARGIN_PX) / scale}`}
          onClick={onPlanClick}
          role="img"
          aria-label={`Plan de l'appartement : ${plan.rooms.map((x) => x.name).join(', ')}`}
        >
          <defs>
            {placed.map((p) => {
              const at = positionOf(p)!
              return (
                <clipPath key={p.id} id={`pin-${p.id}`}>
                  <circle cx={at[0]} cy={at[1]} r={r - 2.5 / scale} />
                </clipPath>
              )
            })}
          </defs>

          {plan.rooms.map((room) => (
            <polygon
              key={room.name}
              className={`plan-room${room.name === selectedRoom ? ' selected' : ''}`}
              points={room.points.map((pt) => toD(pt).join(',')).join(' ')}
              strokeWidth={1.5 / scale}
            />
          ))}

          {plan.windows.map((w, i) => {
            const a = toD(w.from)
            const b = toD(w.to)
            const room = plan.rooms.find((x) => x.name === w.room)
            const c = room ? toD(labelPoint(room)) : [DW / 2, DH / 2]
            // Étiquette poussée vers l'extérieur de la pièce, perpendiculairement à la fenêtre.
            const mx = (a[0] + b[0]) / 2
            const my = (a[1] + b[1]) / 2
            let nx = -(b[1] - a[1])
            let ny = b[0] - a[0]
            const len = Math.hypot(nx, ny) || 1
            nx /= len
            ny /= len
            if (nx * (mx - c[0]) + ny * (my - c[1]) < 0) {
              nx = -nx
              ny = -ny
            }
            const off = 14 / scale
            return (
              <g key={i}>
                <line className="plan-window" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={5 / scale} />
                <text
                  className="plan-window-label"
                  x={mx + nx * off}
                  y={my + ny * off}
                  fontSize={WINDOW_FONT_PX / scale}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {w.orientation}
                </text>
              </g>
            )
          })}

          {plan.rooms.map((room) => {
            const [x, y] = toD(labelPoint(room))
            return (
              <text
                key={room.name}
                className="plan-room-label"
                x={x}
                y={y}
                fontSize={ROOM_FONT_PX / scale}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {room.name}
              </text>
            )
          })}

          <Compass x={DW - 6 / scale} y={6 / scale} size={16 / scale} north={north} />

          {placed.map((p) => {
            const at = positionOf(p)!
            const status = statuses.get(p.id)!
            const photo = garden.photoUrls.get(p.id)
            return (
              <g
                key={p.id}
                className={`pin${drag?.id === p.id ? ' dragging' : ''}`}
                onPointerDown={(e) => onPinDown(e, p)}
                onPointerMove={onPinMove}
                onPointerUp={() => onPinUp(p)}
                onPointerCancel={() => setDrag(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!editing) onOpen(p)
                }}
                role="button"
                tabIndex={0}
                aria-label={`${p.name} : ${status.detail}`}
                onKeyDown={(e) => e.key === 'Enter' && !editing && onOpen(p)}
              >
                <circle cx={at[0]} cy={at[1]} r={r + 6 / scale} fill="transparent" />
                <circle className={`pin-disc tone-stroke-${status.urgency}`} cx={at[0]} cy={at[1]} r={r} strokeWidth={3 / scale} />
                {photo ? (
                  <image
                    href={photo}
                    x={at[0] - r}
                    y={at[1] - r}
                    width={2 * r}
                    height={2 * r}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#pin-${p.id})`}
                  />
                ) : (
                  <text className="pin-letter" x={at[0]} y={at[1]} fontSize={15 / scale} textAnchor="middle" dominantBaseline="central">
                    {p.name.slice(0, 1).toUpperCase()}
                  </text>
                )}
                {(status.urgency === 'late' || status.urgency === 'today') && (
                  <g>
                    <circle className={`tone-fill-${status.urgency}`} cx={at[0] + r * 0.75} cy={at[1] - r * 0.75} r={7 / scale} stroke="#fff" strokeWidth={1.5 / scale} />
                    <text className="pin-badge" x={at[0] + r * 0.75} y={at[1] - r * 0.75} fontSize={10 / scale} textAnchor="middle" dominantBaseline="central">
                      !
                    </text>
                  </g>
                )}
                <text className="pin-name" x={at[0]} y={at[1] + r + 10 / scale} fontSize={11 / scale} textAnchor="middle" dominantBaseline="central">
                  {p.name.split(' ')[0]}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {editing ? (
        <section className="card stack pad-card">
          <div>
            <h2 className="name">Placer les plantes</h2>
            <p className="small muted">
              Fais glisser une pastille pour la déplacer. La pièce et l'orientation de la fenêtre la plus proche
              sont mises à jour toutes seules.
            </p>
          </div>
          {unplaced.length > 0 && (
            <div className="stack tight">
              <p className="small muted">
                {armed ? "Touche le plan à l'endroit de la plante." : 'Pas encore sur le plan : choisis-en une, puis touche le plan.'}
              </p>
              <div className="chips">
                {unplaced.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`chip${armed === p.id ? ' active' : ''}`}
                    aria-pressed={armed === p.id}
                    onClick={() => setArmed(armed === p.id ? null : p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            className="btn primary"
            onClick={() => {
              setEditing(false)
              setArmed(null)
            }}
          >
            Terminé
          </button>
        </section>
      ) : (
        <>
          {selectedRoom && (
            <section className="card stack pad-card" aria-live="polite">
              <div>
                <h2 className="display small">{selectedRoom}</h2>
                <p className="small muted">
                  {orientations.length === 0
                    ? 'Pas de fenêtre'
                    : `${orientations.length > 1 ? 'Fenêtres' : 'Fenêtre'} ${joinFr(orientations.map((o) => ORIENTATION_LABEL[o]))}`}
                </p>
              </div>
              {roomPlants.length === 0 ? (
                <p className="small muted">Aucune plante dans cette pièce.</p>
              ) : (
                <ul className="compact-list flush">
                  {roomPlants.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="list-row" onClick={() => onOpen(p)}>
                        <span className="name">{p.name}</span>
                        <span className={`small tone-${statuses.get(p.id)!.urgency}`}>{statuses.get(p.id)!.short}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {garden.plants.length > 0 && (
            <section className="card stack pad-card">
              {unplaced.length > 0 && (
                <p className="small muted">
                  {unplaced.length === 1
                    ? `${unplaced[0].name} n'est pas encore sur le plan.`
                    : `${unplaced.length} plantes ne sont pas encore sur le plan.`}
                </p>
              )}
              <button className="btn ghost" onClick={() => setEditing(true)}>
                {unplaced.length > 0 ? 'Placer les plantes' : 'Déplacer les plantes'}
              </button>
            </section>
          )}
        </>
      )}
    </>
  )
}

function Compass({ x, y, size, north }: { x: number; y: number; size: number; north: number }) {
  return (
    <g className="compass" transform={`translate(${x} ${y}) rotate(${north})`} aria-hidden="true">
      <circle r={size} strokeWidth={size / 14} />
      <path d={`M0 ${-size * 0.78} L${size * 0.3} ${size * 0.1} L0 0 L${-size * 0.3} ${size * 0.1} Z`} className="compass-n" />
      <path d={`M0 ${size * 0.78} L${size * 0.3} ${-size * 0.1} L0 0 L${-size * 0.3} ${-size * 0.1} Z`} className="compass-s" />
      <text y={-size * 1.35} fontSize={size * 0.7} textAnchor="middle" dominantBaseline="central" transform={`rotate(${-north} 0 ${-size * 1.35})`}>
        N
      </text>
    </g>
  )
}

function joinFr(items: string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`
}
