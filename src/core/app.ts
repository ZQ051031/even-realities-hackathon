import type { Agenda, AgendaEvent, Input, Reminder } from './types'
import type { MenuItem, Page, TextBox } from './page'
import { MIN, bar, clip, dayLabel, hhmm, mmss, relative } from './time'
import * as F from './focus'
import { goSteps } from './go'

export const CARDS = ['now', 'agenda', 'focus', 'go', 'remind'] as const
export type Card = (typeof CARDS)[number]

export type Alert =
  | { kind: 'reminder'; id: string; at: number }
  | { kind: 'event'; id: string; at: number }
  | { kind: 'focus'; at: number }

export interface State {
  card: Card
  mode: 'deck' | 'pick'
  alert: Alert | null
  agenda: Agenda
  reminders: Reminder[]
  focus: F.FocusState
  goEventId: string | null
  goStep: number
  /** ids already announced, so each alert fires once */
  alerted: string[]
}

export interface Effects {
  exit?: boolean
  persist?: boolean
  refresh?: boolean
}

export const ALERT_MS = 20_000
export const SNOOZE_MIN = 10
export const HEADS_UP_MIN = 5

export const MENU: MenuItem[] = [
  { id: 1, name: 'Start/pause focus' },
  { id: 2, name: 'Snooze reminder 10m' },
  { id: 3, name: 'Route to next event' },
  { id: 4, name: 'Refresh agenda' },
  { id: 5, name: 'Reset focus timer' },
]

export function initialState(agenda: Agenda, reminders: Reminder[], focus = F.newFocus()): State {
  return { card: 'now', mode: 'deck', alert: null, agenda, reminders, focus, goEventId: null, goStep: 0, alerted: [] }
}

// ---------- queries ----------

const timed = (s: State) => s.agenda.events.filter(e => !e.allDay)

/** The event in progress, else the next one today. */
export function currentOrNext(s: State, now: number): AgendaEvent | undefined {
  return timed(s).find(e => e.end > now)
}

export function upcoming(s: State, now: number): AgendaEvent[] {
  return timed(s).filter(e => e.end > now)
}

export function pendingReminders(s: State): Reminder[] {
  return s.reminders.filter(r => !r.done).sort((a, b) => a.due - b.due)
}

function goEvent(s: State, now: number): AgendaEvent | undefined {
  return s.agenda.events.find(e => e.id === s.goEventId) ?? currentOrNext(s, now)
}

// ---------- transitions ----------

function cycle(card: Card, delta: number): Card {
  const i = CARDS.indexOf(card)
  return CARDS[(i + delta + CARDS.length) % CARDS.length]
}

function snooze(s: State, id: string | undefined, now: number): State {
  if (!id) return s
  return {
    ...s,
    reminders: s.reminders.map(r => (r.id === id ? { ...r, due: now + SNOOZE_MIN * MIN } : r)),
    alerted: s.alerted.filter(a => a !== `r:${id}`),
  }
}

function markDone(s: State, id: string | undefined): State {
  if (!id) return s
  return { ...s, reminders: s.reminders.map(r => (r.id === id ? { ...r, done: true } : r)) }
}

function openGo(s: State, ev: AgendaEvent | undefined): State {
  return { ...s, mode: 'deck', alert: null, card: 'go', goEventId: ev?.id ?? null, goStep: 0 }
}

export function dispatch(s: State, input: Input, now: number): [State, Effects] {
  if (input.kind === 'menu') return onMenu(s, input.id, now)
  if (s.alert) return onAlert(s, s.alert, input, now)
  if (s.mode === 'pick') return onPick(s, input, now)

  switch (input.kind) {
    case 'up':
      return [{ ...s, card: cycle(s.card, -1) }, {}]
    case 'down':
      return [{ ...s, card: cycle(s.card, 1) }, {}]
    case 'double':
      return s.card === 'now' ? [s, { exit: true }] : [{ ...s, card: 'now' }, {}]
    case 'long':
      return onLong(s, now)
    case 'tap':
      return onTap(s, now)
    default:
      return [s, {}]
  }
}

function onTap(s: State, now: number): [State, Effects] {
  switch (s.card) {
    case 'now':
      return [openGo(s, currentOrNext(s, now)), {}]
    case 'agenda':
      return pickable(s, now).length ? [{ ...s, mode: 'pick' }, {}] : [s, {}]
    case 'focus':
      return [{ ...s, focus: F.toggle(s.focus, now) }, { persist: true }]
    case 'go': {
      const ev = goEvent(s, now)
      const total = ev ? goSteps(ev).length : 0
      return [{ ...s, goStep: total ? (s.goStep + 1) % (total + 1) : 0 }, {}]
    }
    case 'remind':
      return [markDone(s, pendingReminders(s)[0]?.id), { persist: true }]
  }
}

function onLong(s: State, now: number): [State, Effects] {
  switch (s.card) {
    case 'focus':
      return [{ ...s, focus: F.reset(s.focus) }, { persist: true }]
    case 'remind':
      return [snooze(s, pendingReminders(s)[0]?.id, now), { persist: true }]
    case 'go':
      return [{ ...s, goStep: 0 }, {}]
    default:
      return [s, {}]
  }
}

function onPick(s: State, input: Input, now: number): [State, Effects] {
  if (input.kind === 'double') return [{ ...s, mode: 'deck' }, {}]
  if (input.kind === 'select') return [openGo(s, pickable(s, now)[input.index]), {}]
  return [s, {}]
}

function onAlert(s: State, alert: Alert, input: Input, now: number): [State, Effects] {
  const cleared = { ...s, alert: null }
  if (input.kind === 'double') return [cleared, {}]
  if (alert.kind === 'reminder') {
    if (input.kind === 'tap') return [markDone(cleared, alert.id), { persist: true }]
    if (input.kind === 'up' || input.kind === 'down' || input.kind === 'long')
      return [snooze(cleared, alert.id, now), { persist: true }]
  }
  if (alert.kind === 'event' && input.kind === 'tap') {
    return [openGo(cleared, s.agenda.events.find(e => e.id === alert.id)), {}]
  }
  if (alert.kind === 'focus' && input.kind === 'tap') return [{ ...cleared, card: 'focus' }, {}]
  return [s, {}]
}

function onMenu(s: State, id: number, now: number): [State, Effects] {
  const base = { ...s, alert: null, mode: 'deck' as const }
  switch (id) {
    case 1:
      return [{ ...base, card: 'focus', focus: F.toggle(s.focus, now) }, { persist: true }]
    case 2: {
      const target = s.alert?.kind === 'reminder' ? s.alert.id : pendingReminders(s)[0]?.id
      return [snooze(base, target, now), { persist: true }]
    }
    case 3:
      return [openGo(base, currentOrNext(s, now)), {}]
    case 4:
      return [base, { refresh: true }]
    case 5:
      return [{ ...base, card: 'focus', focus: F.reset(s.focus) }, { persist: true }]
    default:
      return [s, {}]
  }
}

/** Time-driven changes: finished focus phases, due reminders, events about to start. */
export function tick(s: State, now: number): [State, Effects] {
  let next = s
  let fx: Effects = {}
  if (next.alert && now - next.alert.at >= ALERT_MS) next = { ...next, alert: null }

  if (F.isFinished(next.focus, now)) {
    const wasFocus = next.focus.phase === 'focus'
    next = { ...next, focus: F.nextPhase(next.focus, now) }
    fx = { persist: true }
    if (wasFocus && !next.alert) next = { ...next, alert: { kind: 'focus', at: now } }
  }
  if (next.alert) return [next, fx]

  const due = pendingReminders(next).find(r => r.due <= now && !next.alerted.includes(`r:${r.id}`))
  if (due) return [{ ...next, alert: { kind: 'reminder', id: due.id, at: now }, alerted: [...next.alerted, `r:${due.id}`] }, fx]

  const soon = timed(next).find(
    e => e.start > now && e.start - now <= HEADS_UP_MIN * MIN && !next.alerted.includes(`e:${e.id}`),
  )
  if (soon) return [{ ...next, alert: { kind: 'event', id: soon.id, at: now }, alerted: [...next.alerted, `e:${soon.id}`] }, fx]
  return [next, fx]
}

// ---------- views ----------

const TITLES: Record<Card, string> = { now: 'NOW', agenda: 'AGENDA', focus: 'FOCUS', go: 'GO', remind: 'REMIND' }

function header(s: State, now: number): string {
  const title = s.alert ? 'HEADS UP' : s.mode === 'pick' ? 'AGENDA' : TITLES[s.card]
  const dots = CARDS.map(c => (c === s.card ? '●' : '○')).join('')
  const parts = [`${title}  ${dots}`, hhmm(now)]
  if (F.isRunning(s.focus)) parts.push(`${s.focus.phase === 'focus' ? '▶' : '☆'} ${mmss(F.remaining(s.focus, now))}`)
  if (s.agenda.source === 'demo') parts.push('DEMO')
  return parts.join('   ')
}

function eventLine(e: AgendaEvent): string {
  return `${hhmm(e.start)}  ${clip(e.title, 30)}`
}

function nowBody(s: State, now: number): string {
  const [first, second] = upcoming(s, now)
  const lines: string[] = []
  if (!first) lines.push('No more events today  ★', '')
  else {
    const live = first.start <= now
    lines.push(`${live ? 'NOW ' : 'NEXT'}  ${eventLine(first)}`)
    const when = live ? `ends ${relative(first.end, now)}` : relative(first.start, now)
    lines.push(`         ${[when, first.location && clip(first.location, 26)].filter(Boolean).join(' · ')}`)
  }
  lines.push(second ? `THEN  ${eventLine(second)}` : '')
  lines.push('')
  const r = pendingReminders(s)[0]
  lines.push(r ? `□ ${clip(r.text, 28)} · ${relative(r.due, now)}` : '■ No reminders pending')
  return lines.join('\n')
}

function agendaBody(s: State, now: number): string {
  const evs = s.agenda.events
  if (!evs.length) return `${dayLabel(now)}\n\nNothing on your calendar today.`
  const allDay = evs.filter(e => e.allDay)
  const list = timed(s)
  const curIdx = list.findIndex(e => e.end > now)
  const from = Math.max(0, Math.min(curIdx < 0 ? list.length - 4 : curIdx - 1, list.length - 4))
  const lines = [`${dayLabel(now)} · ${list.length} events${allDay.length ? ` · ${allDay.map(e => clip(e.title, 14)).join(', ')}` : ''}`]
  for (const [i, e] of list.slice(from, from + 4).entries()) {
    const idx = from + i
    const mark = idx === curIdx ? '▶' : idx < curIdx || curIdx < 0 ? '·' : ' '
    lines.push(`${mark} ${eventLine(e)}`)
  }
  if (from + 4 < list.length) lines.push(`   +${list.length - from - 4} more`)
  return lines.join('\n')
}

function focusBody(s: State, now: number): string {
  const f = s.focus
  const left = F.remaining(f, now)
  const state = F.isRunning(f) ? 'running' : left === f.length ? 'ready' : 'paused'
  const label = f.phase === 'focus' ? 'FOCUS' : 'BREAK'
  return [
    `${label} · ${state}`,
    '',
    `          ${mmss(left)}`,
    `${bar(1 - left / f.length, 24)}`,
    '',
    `Sessions done: ${f.completed}   (${f.focusMinutes}/${f.breakMinutes} min)`,
  ].join('\n')
}

function goBody(s: State, now: number): string {
  const ev = goEvent(s, now)
  if (!ev) return 'No upcoming event to route to.\n\nSwipe for other cards.'
  const steps = goSteps(ev)
  const head = `${clip(ev.title, 24)} · ${hhmm(ev.start)} · ${relative(ev.start, now)}`
  if (s.goStep >= steps.length) {
    return [head, '', '★ You have arrived', ev.location ? `   ${clip(ev.location, 36)}` : '', '', 'tap to start over'].join('\n')
  }
  const step = steps[s.goStep]
  const dots = steps.map((_, i) => (i === s.goStep ? '●' : '○')).join('')
  return [head, `STEP ${s.goStep + 1}/${steps.length}   ${dots}`, '', `▶ ${clip(step.text, 40)}`, step.detail ? `    ${clip(step.detail, 30)}` : ''].join('\n')
}

function remindBody(s: State, now: number): string {
  const pending = pendingReminders(s)
  const done = s.reminders.length - pending.length
  if (!pending.length) return `■ All done${done ? ` (${done})` : ''}\n\nAdd reminders from the phone app.`
  const lines = pending.slice(0, 4).map((r, i) => `${i === 0 ? '▶' : '□'} ${hhmm(r.due)}  ${clip(r.text, 26)}  ${r.due <= now ? 'DUE' : ''}`.trimEnd())
  if (pending.length > 4) lines.push(`   +${pending.length - 4} more`)
  lines.push(`■ ${done} done`)
  return lines.join('\n')
}

function alertBody(s: State, a: Alert, now: number): [string, string] {
  if (a.kind === 'reminder') {
    const r = s.reminders.find(x => x.id === a.id)
    return [`● REMINDER\n\n${clip(r?.text ?? '', 40)}\n\ndue ${r ? hhmm(r.due) : ''}`, 'tap: done   swipe: snooze 10 min']
  }
  if (a.kind === 'event') {
    const e = s.agenda.events.find(x => x.id === a.id)
    if (!e) return ['', '']
    return [
      `● STARTING ${relative(e.start, now).toUpperCase()}\n\n${clip(e.title, 36)} · ${hhmm(e.start)}\n${e.location ? clip(e.location, 40) : ''}`,
      'tap: route   2x tap: dismiss',
    ]
  }
  return [`★ FOCUS SESSION DONE\n\nBreak ${mmss(F.remaining(s.focus, now))} started.\nLook away from the screen.`, 'tap: open timer   2x tap: dismiss']
}

const HINTS: Record<Card, string> = {
  now: 'tap: route   swipe: cards   2x tap: exit',
  agenda: 'tap: pick event   swipe: cards   2x: home',
  focus: 'tap: start/pause   hold: reset   2x: home',
  go: 'tap: next step   hold: restart   2x: home',
  remind: 'tap: done   hold: snooze 10m   2x: home',
}

function deckPage(head: string, body: string, foot: string): Page {
  const texts: TextBox[] = [
    { id: 1, name: 'hdr', x: 0, y: 0, w: 576, h: 40, padding: 6, content: head },
    { id: 2, name: 'body', x: 0, y: 40, w: 576, h: 208, border: 1, radius: 8, padding: 10, content: body, capture: true },
    { id: 3, name: 'foot', x: 0, y: 252, w: 576, h: 36, padding: 6, color: 2, content: foot },
  ]
  return { layout: 'deck', texts, menu: MENU }
}

/** Events offered in the agenda picker (list container, max 20). */
export function pickable(s: State, now: number): AgendaEvent[] {
  const list = timed(s)
  const next = list.findIndex(e => e.end > now)
  const start = next >= 0 ? next : Math.max(0, list.length - 20)
  return list.slice(start, start + 20)
}

export function view(s: State, now: number): Page {
  const head = header(s, now)
  if (s.alert) {
    const [body, foot] = alertBody(s, s.alert, now)
    return deckPage(head, body, foot)
  }
  if (s.mode === 'pick') {
    const items = pickable(s, now).map(e => clip(`${hhmm(e.start)}  ${e.title}`, 60))
    return {
      layout: `pick:${items.join('|')}`,
      texts: [
        { id: 1, name: 'hdr', x: 0, y: 0, w: 576, h: 40, padding: 6, content: head },
        { id: 3, name: 'foot', x: 0, y: 252, w: 576, h: 36, padding: 6, color: 2, content: 'swipe: move   tap: route   2x tap: back' },
      ],
      list: { id: 4, name: 'pick', x: 0, y: 40, w: 576, h: 208, border: 1, padding: 6, items, capture: true },
      menu: MENU,
    }
  }
  const body = { now: nowBody, agenda: agendaBody, focus: focusBody, go: goBody, remind: remindBody }[s.card](s, now)
  return deckPage(head, body, HINTS[s.card])
}
