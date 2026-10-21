// Plan de l'appartement : format, validation et calculs géométriques.

export type Point = [number, number]

export const ORIENTATIONS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const
export type Orientation = (typeof ORIENTATIONS)[number]

export type PlanRoom = {
  name: string
  points: Point[]
  /** Position du nom de la pièce ; par défaut, le centre de la pièce. */
  label?: Point
}

export type PlanWindow = {
  room: string
  from: Point
  to: Point
  /** Orientation de la façade : la direction vers laquelle regarde la fenêtre. */
  orientation: Orientation
}

export type FloorPlan = {
  /** Taille du dessin, dans l'unité de son choix (pixels de la carte du robot, centimètres…). */
  width: number
  height: number
  /** Direction du nord sur le dessin, en degrés dans le sens horaire depuis le haut. */
  north?: number
  rooms: PlanRoom[]
  windows: PlanWindow[]
}

const isPoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n))

/** Vérifie un plan importé ; renvoie un message d'erreur en français, ou null s'il est valide. */
export function validatePlan(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'Le fichier ne contient pas un objet JSON.'
  const p = raw as Partial<FloorPlan>
  if (!(typeof p.width === 'number' && p.width > 0 && typeof p.height === 'number' && p.height > 0))
    return 'Il manque la largeur (width) et la hauteur (height) du plan.'
  if (!Array.isArray(p.rooms) || p.rooms.length === 0) return 'Le plan doit contenir au moins une pièce (rooms).'
  for (const r of p.rooms) {
    if (typeof r?.name !== 'string' || !r.name.trim()) return 'Chaque pièce doit avoir un nom.'
    if (!Array.isArray(r.points) || r.points.length < 3 || !r.points.every(isPoint))
      return `La pièce « ${r.name} » doit avoir au moins 3 points [x, y].`
  }
  if (p.windows !== undefined && !Array.isArray(p.windows)) return 'windows doit être une liste.'
  for (const w of p.windows ?? []) {
    if (!isPoint(w?.from) || !isPoint(w?.to)) return 'Chaque fenêtre doit avoir deux points from et to.'
    if (!ORIENTATIONS.includes(w.orientation)) return `Orientation inconnue : ${String(w.orientation)} (N, NE, E, SE, S, SO, O ou NO).`
    if (!p.rooms.some((r) => r.name === w.room)) return `La fenêtre ${w.orientation} indique une pièce inconnue : ${String(w.room)}.`
  }
  return null
}

/** Test du point dans le polygone (lancer de rayon). */
export function inPolygon([x, y]: Point, poly: Point[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function roomAt(plan: FloorPlan, p: Point): PlanRoom | null {
  return plan.rooms.find((r) => inPolygon(p, r.points)) ?? null
}

/** Centre de gravité d'un polygone (repli sur la moyenne des points s'il est dégénéré). */
export function centroid(points: Point[]): Point {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [x0, y0] = points[j]
    const [x1, y1] = points[i]
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

export function labelPoint(room: PlanRoom): Point {
  return room.label ?? centroid(room.points)
}

function distToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Orientation de la fenêtre la plus proche du point, dans la pièce donnée. */
export function nearestWindow(plan: FloorPlan, room: string, p: Point): Orientation | null {
  let best: { o: Orientation; d: number } | null = null
  for (const w of plan.windows) {
    if (w.room !== room) continue
    const d = distToSegment(p, w.from, w.to)
    if (!best || d < best.d) best = { o: w.orientation, d }
  }
  return best?.o ?? null
}

/** Orientations des fenêtres d'une pièce, sans doublon (ex. ['SE', 'NE'] pour la chambre). */
export function roomOrientations(plan: FloorPlan | null, room: string | null): Orientation[] {
  if (!plan || !room) return []
  return [...new Set(plan.windows.filter((w) => w.room === room).map((w) => w.orientation))]
}

export const ORIENTATION_LABEL: Record<Orientation, string> = {
  N: 'nord',
  NE: 'nord-est',
  E: 'est',
  SE: 'sud-est',
  S: 'sud',
  SO: 'sud-ouest',
  O: 'ouest',
  NO: 'nord-ouest',
}
