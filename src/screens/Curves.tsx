import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { bucket, type Sample } from '../lib/history'
import type { Plant, PlantEvent, Reading } from '../lib/types'

const HOUR = 3_600_000
const DAY = 24 * HOUR

type Metric = {
  key: 'moisture' | 'conductivity' | 'light' | 'temperature'
  title: string
  unit: string
  digits: number
  band?: (p: Plant) => [number | null, number | null]
}

const METRICS: Metric[] = [
  { key: 'moisture', title: 'Humidité du sol', unit: '%', digits: 0, band: (p) => [p.moisture_min, p.moisture_max] },
  { key: 'conductivity', title: 'Engrais (conductivité)', unit: 'µS/cm', digits: 0, band: (p) => [p.conductivity_min, p.conductivity_max] },
  { key: 'light', title: 'Lumière', unit: 'lux', digits: 0, band: (p) => [p.light_min, null] },
  { key: 'temperature', title: 'Température', unit: '°C', digits: 1 },
]

type Props = { plant: Plant; readings: Reading[]; events: PlantEvent[] }

/** Courbes des mesures du capteur, sur 7 ou 30 jours, avec les arrosages en repère. */
export function Curves({ plant, readings, events }: Props) {
  const [days, setDays] = useState<7 | 30>(7)
  const now = Date.now()
  const from = now - days * DAY
  const inRange = useMemo(() => readings.filter((r) => new Date(r.measured_at).getTime() >= from), [readings, from])
  const waterings = events
    .filter((e) => e.kind === 'water' && new Date(e.occurred_at).getTime() >= from)
    .map((e) => new Date(e.occurred_at).getTime())
  const battery = readings.length ? readings[readings.length - 1].battery : null

  return (
    <section className="stack tight" aria-labelledby="curves-title">
      <div className="section-head">
        <h3 id="curves-title" className="section-title">
          Mesures
        </h3>
        <div className="segmented" role="group" aria-label="Période">
          {([7, 30] as const).map((d) => (
            <button key={d} type="button" aria-pressed={days === d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
              {d} j
            </button>
          ))}
        </div>
      </div>

      {inRange.length === 0 ? (
        <p className="small muted">
          Aucune mesure sur cette période : le capteur n'a encore rien envoyé par la passerelle.
        </p>
      ) : (
        <>
          {METRICS.map((m) => {
            const samples = bucket(inRange, m.key, days === 7 ? HOUR : 6 * HOUR)
            if (samples.length === 0) return null
            return (
              <LineChart
                key={m.key}
                metric={m}
                samples={samples}
                band={m.band?.(plant)}
                from={from}
                to={now}
                waterings={waterings}
              />
            )
          })}
          <p className="hint legend">
            <span className="legend-item">
              <span className="swatch band" aria-hidden="true" /> plage conseillée
            </span>
            <span className="legend-item">
              <span className="swatch water" aria-hidden="true" /> arrosage
            </span>
            {battery != null && <span>Pile du capteur : {battery} %</span>}
          </p>
        </>
      )}
    </section>
  )
}

function LineChart(props: {
  metric: Metric
  samples: Sample[]
  band?: [number | null, number | null]
  from: number
  to: number
  waterings: number[]
}) {
  const { metric, samples, band, from, to, waterings } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Sample | null>(null)

  const W = 320
  const H = 110
  const L = 4
  const R = 4
  const T = 8
  const B = 18

  // Échelle verticale : les mesures et les seuils, avec une petite marge.
  const vals = samples.map((s) => s.v)
  const lo = band?.[0]
  const hi = band?.[1]
  let min = Math.min(...vals, ...(lo != null ? [lo] : []))
  let max = Math.max(...vals, ...(hi != null ? [hi] : []), ...(lo != null ? [lo] : []))
  if (metric.key === 'moisture') {
    min = Math.max(0, min - 5)
    max = Math.min(100, max + 5)
  } else {
    const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1
    min = metric.key === 'temperature' ? min - pad : Math.max(0, min - pad)
    max += pad
  }
  const x = (t: number) => L + ((t - from) / (to - from)) * (W - L - R)
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B)

  // Coupe la ligne quand il manque des mesures (capteur muet plus de 3 tranches).
  const gap = (samples.length > 1 ? (samples[samples.length - 1].t - samples[0].t) / (samples.length - 1) : HOUR) * 3
  let d = ''
  samples.forEach((s, i) => {
    const cmd = i === 0 || s.t - samples[i - 1].t > gap ? 'M' : 'L'
    d += `${cmd}${x(s.t).toFixed(1)} ${y(s.v).toFixed(1)}`
  })

  const last = samples[samples.length - 1]
  const fmt = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: metric.digits })} ${metric.unit}`

  // Graduations : chaque jour sur 7 jours, chaque semaine sur 30.
  const ticks: number[] = []
  const step = to - from > 8 * DAY ? 7 * DAY : DAY
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  for (let t = start.getTime() + DAY; t < to; t += step) ticks.push(t)

  function onMove(e: ReactPointerEvent) {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return
    const px = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()).x
    let best = samples[0]
    for (const s of samples) if (Math.abs(x(s.t) - px) < Math.abs(x(best.t) - px)) best = s
    setHover(best)
  }

  const shown = hover ?? last
  const bandTop = hi != null ? y(Math.min(hi, max)) : T
  const bandBottom = lo != null ? y(Math.max(lo, min)) : H - B

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="small">{metric.title}</span>
        <span className="small">
          <strong>{fmt(shown.v)}</strong>
          <span className="muted"> · {hover ? when(hover.t) : 'dernière mesure'}</span>
        </span>
      </figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        role="img"
        aria-label={`${metric.title} : dernière valeur ${fmt(last.v)}${lo != null || hi != null ? `, plage conseillée ${lo ?? '?'}–${hi ?? '?'} ${metric.unit}` : ''}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {(lo != null || hi != null) && <rect x={L} width={W - L - R} y={bandTop} height={Math.max(0, bandBottom - bandTop)} className="chart-band" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="chart-grid" />
            <text x={x(t)} y={H - 5} textAnchor="middle" className="axis-label">
              {step === DAY
                ? new Date(t).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '') + ' ' + new Date(t).getDate()
                : new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            </text>
          </g>
        ))}
        {waterings.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="chart-water" />
        ))}
        <text x={L + 2} y={T + 9} className="axis-label">
          {Math.round(max).toLocaleString('fr-FR')}
        </text>
        <text x={L + 2} y={H - B - 3} className="axis-label">
          {Math.round(min).toLocaleString('fr-FR')}
        </text>
        <path d={d} className="chart-line" />
        {hover && (
          <>
            <line x1={x(hover.t)} x2={x(hover.t)} y1={T} y2={H - B} className="chart-cross" />
            <circle cx={x(hover.t)} cy={y(hover.v)} r={4} className="chart-dot" />
          </>
        )}
        {!hover && <circle cx={x(last.t)} cy={y(last.v)} r={3.5} className="chart-dot" />}
      </svg>
    </figure>
  )
}

function when(t: number) {
  const d = new Date(t)
  return `${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })} ${d.getHours()} h`
}
