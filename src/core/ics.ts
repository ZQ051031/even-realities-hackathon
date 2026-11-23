import type { AgendaEvent } from './types'

/** Minimal RFC 5545 reader: VEVENTs with TZID/UTC/floating/all-day times, DAILY/WEEKLY RRULEs, EXDATE and RECURRENCE-ID overrides. */

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

export interface RawEvent {
  uid: string
  title: string
  start: number
  end: number
  allDay: boolean
  location?: string
  notes?: string
  rrule?: Record<string, string>
  exdates: number[]
  recurrenceId?: number
  cancelled: boolean
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function parseLine(line: string): Prop | null {
  let inQuote = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const [name, ...rawParams] = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

export function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function tzOffset(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const p of fmt.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): number {
  const guess = Date.UTC(y, mo, d, h, mi, s)
  const first = guess - tzOffset(guess, timeZone)
  return guess - tzOffset(first, timeZone)
}

export function parseIcsDate(value: string, params: Record<string, string> = {}): { ms: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, ys, mos, ds, hs, mis, ss, z] = m
  const y = +ys, mo = +mos - 1, d = +ds
  if (hs === undefined || params.VALUE === 'DATE') return { ms: new Date(y, mo, d).getTime(), allDay: true }
  const h = +hs, mi = +mis, s = ss ? +ss : 0
  if (z) return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false }
  if (params.TZID) {
    try {
      return { ms: zonedToUtc(y, mo, d, h, mi, s, params.TZID), allDay: false }
    } catch {
      /* unknown zone name: fall through to floating time */
    }
  }
  return { ms: new Date(y, mo, d, h, mi, s).getTime(), allDay: false }
}

export function parseIcs(text: string): RawEvent[] {
  const events: RawEvent[] = []
  let cur: Prop[] | null = null
  let depth = 0
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      cur = []
      depth = 0
      continue
    }
    if (!cur) continue
    if (/^BEGIN:/i.test(line)) depth++
    else if (/^END:VEVENT$/i.test(line)) {
      const ev = toRaw(cur)
      if (ev) events.push(ev)
      cur = null
    } else if (/^END:/i.test(line)) depth--
    else if (depth === 0) {
      const p = parseLine(line)
      if (p) cur.push(p)
    }
  }
  return events
}

function toRaw(props: Prop[]): RawEvent | null {
  const get = (n: string) => props.find(p => p.name === n)
  const ds = get('DTSTART')
  if (!ds) return null
  const start = parseIcsDate(ds.value, ds.params)
  if (!start) return null
  const de = get('DTEND')
  const endParsed = de ? parseIcsDate(de.value, de.params) : null
  let end = endParsed?.ms ?? start.ms + (start.allDay ? 86_400_000 : 0)
  const dur = get('DURATION')
  if (!endParsed && dur) end = start.ms + parseDuration(dur.value)
  const rr = get('RRULE')
  const rid = get('RECURRENCE-ID')
  const exdates: number[] = []
  for (const p of props.filter(p => p.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = parseIcsDate(v, p.params)
      if (d) exdates.push(d.ms)
    }
  }
  const loc = get('LOCATION')?.value
  const desc = get('DESCRIPTION')?.value
  return {
    uid: get('UID')?.value ?? `${start.ms}-${get('SUMMARY')?.value ?? ''}`,
    title: unescapeText(get('SUMMARY')?.value ?? '(no title)'),
    start: start.ms,
    end,
    allDay: start.allDay,
    location: loc ? unescapeText(loc) : undefined,
    notes: desc ? unescapeText(desc) : undefined,
    rrule: rr ? Object.fromEntries(rr.value.split(';').map(kv => kv.split('=') as [string, string])) : undefined,
    exdates,
    recurrenceId: rid ? parseIcsDate(rid.value, rid.params)?.ms : undefined,
    cancelled: get('STATUS')?.value.toUpperCase() === 'CANCELLED',
  }
}

export function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return 0
  const [, sign, w, d, h, mi, s] = m
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86_400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000
  return sign === '-' ? -ms : ms
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Occurrence start times of a recurring event that fall in [from, to). Local wall-clock time is preserved across DST. */
export function occurrences(ev: RawEvent, from: number, to: number, maxIter = 4000): number[] {
  if (!ev.rrule) return ev.start < to && ev.end > from ? [ev.start] : []
  const r = ev.rrule
  const freq = r.FREQ
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return ev.start < to && ev.end > from ? [ev.start] : []
  const interval = Math.max(1, Number(r.INTERVAL ?? 1))
  const count = r.COUNT ? Number(r.COUNT) : Infinity
  const until = r.UNTIL ? parseIcsDate(r.UNTIL)?.ms ?? Infinity : Infinity
  const days = r.BYDAY ? r.BYDAY.split(',').map(d => BYDAY.indexOf(d.slice(-2))).filter(i => i >= 0) : null
  const duration = ev.end - ev.start
  const base = new Date(ev.start)
  const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()
  const out: number[] = []
  let n = 0
  for (let i = 0; i < maxIter; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const t = d.getTime()
    if (t >= to || t > until || n >= count) break
    const dayIndex = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - baseDay) / 86_400_000)
    let match: boolean
    if (freq === 'DAILY') match = dayIndex % interval === 0
    else {
      const week = Math.floor((dayIndex + base.getDay()) / 7)
      const wanted = days ?? [base.getDay()]
      match = week % interval === 0 && wanted.includes(d.getDay())
    }
    if (!match) continue
    n++
    if (ev.exdates.includes(t)) continue
    if (t + duration > from) out.push(t)
  }
  return out
}

function stepsFrom(notes?: string): string[] | undefined {
  if (!notes) return undefined
  const steps = notes
    .split('\n')
    .map(l => /^\s*GO:\s*(.+)$/i.exec(l)?.[1]?.trim())
    .filter((s): s is string => !!s)
  return steps.length ? steps : undefined
}

/** All event instances overlapping [from, to), sorted by start. */
export function eventsBetween(raw: RawEvent[], from: number, to: number): AgendaEvent[] {
  const overrides = new Set(raw.filter(e => e.recurrenceId !== undefined).map(e => `${e.uid}@${e.recurrenceId}`))
  const out: AgendaEvent[] = []
  for (const ev of raw) {
    if (ev.cancelled) continue
    const isOverride = ev.recurrenceId !== undefined
    const starts = isOverride ? (ev.start < to && ev.end > from ? [ev.start] : []) : occurrences(ev, from, to)
    for (const s of starts) {
      if (!isOverride && ev.rrule && overrides.has(`${ev.uid}@${s}`)) continue
      out.push({
        id: `${ev.uid}@${s}`,
        title: ev.title,
        start: s,
        end: s + (ev.end - ev.start),
        allDay: ev.allDay || undefined,
        location: ev.location,
        notes: ev.notes,
        steps: stepsFrom(ev.notes),
      })
    }
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title))
}
