export const MIN = 60_000
export const HOUR = 60 * MIN

const pad = (n: number) => String(n).padStart(2, '0')

export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayLabel(ms: number): string {
  const d = new Date(ms)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "in 18 min", "in 1 h 05", "now", "5 min ago" */
export function relative(target: number, now: number): string {
  const diff = target - now
  const mins = Math.round(Math.abs(diff) / MIN)
  if (mins === 0) return 'now'
  const span = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${pad(mins % 60)}`
  return diff > 0 ? `in ${span}` : `${span} ago`
}

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** ━━━━━─────  (n cells) */
export function bar(fraction: number, cells = 20): string {
  const f = Math.min(1, Math.max(0, fraction))
  const on = Math.round(f * cells)
  return '━'.repeat(on) + '─'.repeat(cells - on)
}

/** Trim to max chars with an ellipsis-like "..". The glasses font has no "…" guarantee. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 2)).trimEnd() + '..'
}
