// Logique pure du récapitulatif quotidien : heure locale du foyer et texte de la notification.

/** Heure et date « murales » dans un fuseau donné (ex. 8 h le 2026-10-20 à Paris). */
export function localClock(now: Date, timeZone: string): { hour: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` }
}

/**
 * Convertit un instant en « heure murale » du fuseau, exprimée comme une date locale du
 * serveur. Le calcul d'urgence compte les jours calendaires : il doit voir les dates
 * telles que le foyer les vit, pas en UTC.
 */
export function toWallClock(date: Date, timeZone: string): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  )
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
}

/** « A », « A et B », « A, B et C ». */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`
}

/** Texte du récapitulatif ; les plantes en retard sont listées en premier. */
export function digestMessage(late: string[], today: string[]): { title: string; body: string } | null {
  const names = [...late, ...today]
  if (names.length === 0) return null
  const title = names.length === 1 ? `${names[0]} a soif` : `${names.length} plantes ont soif`
  const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} autres`] : names
  const body =
    names.length === 1
      ? late.length
        ? "Son arrosage est en retard. Un petit verre d'eau ?"
        : "C'est le jour de l'arroser."
      : `À arroser aujourd'hui : ${joinNames(shown)}.`
  return { title, body }
}
