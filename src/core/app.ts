import type { Agenda, AgendaEvent, Input, Reminder } from './types'
import type { MenuItem, Page, TextBox } from './page'
import { MIN, bar, clip, dayLabel, hhmm, mmss, relative } from './time'
import * as F from './focus'
import { goSteps } from './go'
import { parseReminder } from './voice'

export const CARDS = ['now', 'agenda', 'focus', 'go', 'remind'] as const
export type Card = (typeof CARDS)[number]

export type Alert =
  | { kind: 'reminder'; id: string; at: number }
  | { kind: 'event'; id: string; at: number }
  | { kind: 'focus'; at: number }

/** Voice reminder flow: hold on NOW (or menu) -> listening -> thinking -> confirm -> saved. */
export type Voice =
  | { phase: 'listening'; at: number; level: number }
  | { phase: 'thinking'; at: number }
  | { phase: 'confirm'; at: number; text: string; due: number; heard: string; defaulted: boolean }
  | { phase: 'error'; at: number; message: string }

export interface State {
  card: Card
  voice: Voice | null
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
  /** microphone control for the voice flow */
  listen?: 'start' | 'finish' | 'cancel'
}

export const ALERT_MS = 20_000
export const SNOOZE_MIN = 10
export const HEADS_UP_MIN = 5
/** a heard reminder saves itself after this long unless cancelled (hands-free) */
export const VOICE_AUTOSAVE_MS = 8_000
export const VOICE_ERROR_MS = 6_000
export const VOICE_LISTEN_MAX_MS = 15_000
export const VOICE_THINK_MAX_MS = 25_000
export const VOICE_NUDGE_MIN = 10

export const MENU: MenuItem[] = [
  { id: 1, name: 'Start/pause focus' },
  { id: 2, name: 'Snooze reminder 10m' },
  { id: 3, name: 'Route to next event' },
  { id: 4, name: 'Refresh agenda' },
  { id: 5, name: 'Reset focus timer' },
  { id: 6, name: 'Voice reminder' },
]

export function initialState(agenda: Agenda, reminders: Reminder[], focus = F.newFocus()): State {
  return { card: 'now', voice: null, mode: 'deck', alert: null, agenda, reminders, focus, goEventId: null, goStep: 0, alerted: [] }
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
  if (s.voice) return onVoice(s, s.voice, input, now)
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
    case 'now':
      return startVoice(s, now)
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

// ---------- voice reminders ----------

export function startVoice(s: State, now: number): [State, Effects] {
  return [{ ...s, alert: null, mode: 'deck', voice: { phase: 'listening', at: now, level: 0 } }, { listen: 'start' }]
}

/** Microphone level 0..1 while listening (drives the meter). */
export function voiceLevel(s: State, level: number): State {
  if (s.voice?.phase !== 'listening') return s
  const q = Math.round(level * 8) / 8
  return q === s.voice.level ? s : { ...s, voice: { ...s.voice, level: q } }
}

/** The utterance ended and audio went off to speech-to-text. */
export function voiceThinking(s: State, now: number): State {
  return s.voice?.phase === 'listening' ? { ...s, voice: { phase: 'thinking', at: now } } : s
}

export function voiceHeard(s: State, transcript: string, now: number): State {
  if (s.voice?.phase !== 'thinking' && s.voice?.phase !== 'listening') return s
  const heard = transcript.trim()
  if (!heard) return voiceFailed(s, "Didn't hear anything", now)
  const r = parseReminder(heard, now)
  if (!r) return voiceFailed(s, `Couldn't find a reminder in "${heard}"`, now)
  return { ...s, voice: { phase: 'confirm', at: now, text: r.text, due: r.due, heard, defaulted: r.defaulted } }
}

export function voiceFailed(s: State, message: string, now: number): State {
  return s.voice ? { ...s, voice: { phase: 'error', at: now, message } } : s
}

function saveVoice(s: State, v: Extract<Voice, { phase: 'confirm' }>, now: number): [State, Effects] {
  const r: Reminder = { id: `v${now.toString(36)}`, text: v.text, due: v.due }
  return [{ ...s, voice: null, card: 'remind', reminders: [...s.reminders, r] }, { persist: true }]
}

function onVoice(s: State, v: Voice, input: Input, now: number): [State, Effects] {
  const close: State = { ...s, voice: null }
  switch (v.phase) {
    case 'listening':
      if (input.kind === 'tap') return [voiceThinking(s, now), { listen: 'finish' }]
      if (input.kind === 'double') return [close, { listen: 'cancel' }]
      return [s, {}]
    case 'thinking':
      return input.kind === 'double' ? [close, { listen: 'cancel' }] : [s, {}]
    case 'confirm': {
      if (input.kind === 'tap') return saveVoice(s, v, now)
      if (input.kind === 'double') return [close, {}]
      if (input.kind === 'long') return startVoice(s, now)
      const delta = input.kind === 'down' ? VOICE_NUDGE_MIN : input.kind === 'up' ? -VOICE_NUDGE_MIN : 0
      if (!delta) return [s, {}]
      const due = Math.max(now + MIN, v.due + delta * MIN)
      return [{ ...s, voice: { ...v, due, at: now, defaulted: false } }, {}]
    }
    case 'error':
      if (input.kind === 'tap' || input.kind === 'long') return startVoice(s, now)
      if (input.kind === 'double') return [close, {}]
      return [s, {}]
  }
}

function tickVoice(s: State, v: Voice, now: number): [State, Effects] {
  const age = now - v.at
  if (v.phase === 'confirm' && age >= VOICE_AUTOSAVE_MS) return saveVoice(s, v, now)
  if (v.phase === 'error' && age >= VOICE_ERROR_MS) return [{ ...s, voice: null }, {}]
  if (v.phase === 'listening' && age >= VOICE_LISTEN_MAX_MS) return [voiceFailed(s, 'Listening timed out', now), { listen: 'cancel' }]
  if (v.phase === 'thinking' && age >= VOICE_THINK_MAX_MS) return [voiceFailed(s, 'Speech-to-text timed out', now), {}]
  return [s, {}]
}

function onMenu(s: State, id: number, now: number): [State, Effects] {
  if (id === 6) return startVoice(s, now)
  const base = { ...s, alert: null, voice: null, mode: 'deck' as const }
  const stop: Effects = s.voice?.phase === 'listening' ? { listen: 'cancel' } : {}
  const [ns, fx] = menuAction(s, base, id, now)
  return [ns, { ...stop, ...fx }]
}

function menuAction(s: State, base: State, id: number, now: number): [State, Effects] {
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
  if (next.voice) {
    const [vs, vfx] = tickVoice(next, next.voice, now)
    return [vs, { ...fx, ...vfx, persist: fx.persist || vfx.persist }]
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
// Layout: 576x288. Header row (title + card dots | clock + timer), a framed 6-line body, a dim hint row.

const TITLES: Record<Card, string> = { now: 'NOW', agenda: 'AGENDA', focus: 'FOCUS', go: 'GO', remind: 'REMIND' }
export const BODY_LINES = 6

function headerLeft(s: State): string {
  const title = s.voice ? 'VOICE' : s.alert ? 'HEADS UP' : s.mode === 'pick' ? 'AGENDA' : TITLES[s.card]
  const dots = CARDS.map(c => (c === s.card ? '●' : '○')).join('')
  return [`${title}  ${dots}`, s.agenda.source === 'demo' ? 'DEMO' : ''].filter(Boolean).join('   ')
}

function headerRight(s: State, now: number): string {
  const timer = F.isRunning(s.focus) ? `${s.focus.phase === 'focus' ? '▶' : '☆'} ${mmss(F.remaining(s.focus, now))}   ` : ''
  return `${timer}${hhmm(now)}`
}

const until = (e: AgendaEvent, now: number) => (e.start <= now ? `${relative(e.end, now).replace('in ', '')} left` : relative(e.start, now))

function nowBody(s: State, now: number): string {
  const [first, second] = upcoming(s, now)
  const lines: string[] = []
  if (!first) lines.push('★ No more events today', '', '')
  else {
    const live = first.start <= now
    const progress = live ? `   ${bar((now - first.start) / (first.end - first.start), 12)}` : ''
    lines.push(`${live ? 'NOW' : 'NEXT'} · ${until(first, now)}${progress}`)
    lines.push(`${hhmm(first.start)}  ${clip(first.title, 34)}`)
    lines.push(first.location ? `       ${clip(first.location, 36)}` : '')
  }
  lines.push(second ? `then   ${hhmm(second.start)}  ${clip(second.title, 30)}` : '')
  lines.push('')
  const r = pendingReminders(s)[0]
  lines.push(r ? `${r.due <= now ? '■' : '□'} ${clip(r.text, 30)} · ${r.due <= now ? 'due' : relative(r.due, now)}` : '■ No reminders pending')
  return lines.join('\n')
}

function agendaBody(s: State, now: number): string {
  const evs = s.agenda.events
  if (!evs.length) return `${dayLabel(now)}\n\nNothing on your calendar today.`
  const allDay = evs.filter(e => e.allDay)
  const list = timed(s)
  const curIdx = list.findIndex(e => e.end > now)
  const rows = allDay.length ? 3 : 4
  const from = Math.max(0, Math.min(curIdx < 0 ? list.length - rows : curIdx - 1, list.length - rows))
  const left = list.filter(e => e.end > now).length
  const lines = [`${dayLabel(now)} · ${list.length} events · ${left} to go`]
  for (const [i, e] of list.slice(from, from + rows).entries()) {
    const idx = from + i
    const mark = idx === curIdx ? '▶' : idx < curIdx || curIdx < 0 ? '·' : ' '
    const tail = idx === curIdx ? `  ${until(e, now)}` : ''
    lines.push(`${mark} ${hhmm(e.start)}  ${clip(e.title, idx === curIdx ? 22 : 34)}${tail}`)
  }
  const more = list.length - from - rows
  if (allDay.length) lines.push(`★ ${clip(allDay.map(e => e.title).join(', '), 40)}`)
  lines.push(more > 0 ? `  +${more} later` : '')
  return lines.join('\n')
}

function focusBody(s: State, now: number): string {
  const f = s.focus
  const left = F.remaining(f, now)
  const state = F.isRunning(f) ? 'running' : left === f.length ? 'ready' : 'paused'
  const label = f.phase === 'focus' ? `FOCUS #${f.completed + 1}` : 'BREAK'
  const after = f.phase === 'focus' ? `then ${f.breakMinutes} min break` : `then ${f.focusMinutes} min focus`
  return [
    `${label} · ${state}`,
    '',
    `              ${mmss(left)}`,
    bar(1 - left / f.length, 20),
    '',
    `${after} · ${f.completed} done today`,
  ].join('\n')
}

function goBody(s: State, now: number): string {
  const ev = goEvent(s, now)
  if (!ev) return 'No upcoming event to route to.\n\nSwipe for other cards.'
  const steps = goSteps(ev)
  const head = `${clip(ev.title, 22)} · ${hhmm(ev.start)} · ${until(ev, now)}`
  if (s.goStep >= steps.length) {
    return [head, '', '★ You have arrived', ev.location ? `   ${clip(ev.location, 36)}` : '', '', ''].join('\n')
  }
  const step = steps[s.goStep]
  const dots = steps.map((_, i) => (i <= s.goStep ? '●' : '○')).join(' ')
  return [head, `STEP ${s.goStep + 1} of ${steps.length}   ${dots}`, '', `▶ ${clip(step.text, 40)}`, step.detail ? `   ${clip(step.detail, 40)}` : '', ''].join('\n')
}

function remindBody(s: State, now: number): string {
  const pending = pendingReminders(s)
  const done = s.reminders.length - pending.length
  if (!pending.length) return `■ All done${done ? ` · ${done} today` : ''}\n\nHold on NOW to add one by voice,\nor add it in the phone app.`
  const lines = pending.slice(0, 4).map((r, i) => {
    const when = r.due <= now ? 'DUE' : i === 0 ? relative(r.due, now) : ''
    return `${i === 0 ? '▶' : '□'} ${hhmm(r.due)}  ${clip(r.text, i === 0 ? 24 : 34)}${when ? `  ${when}` : ''}`
  })
  const more = pending.length - 4
  lines.push(more > 0 ? `  +${more} more` : '')
  lines.push(done ? `■ ${done} done` : '')
  return lines.join('\n')
}

function alertBody(s: State, a: Alert, now: number): [string, string] {
  if (a.kind === 'reminder') {
    const r = s.reminders.find(x => x.id === a.id)
    return [`● REMINDER\n\n${clip(r?.text ?? '', 40)}\n\ndue ${r ? hhmm(r.due) : ''}`, 'tap: done   swipe: snooze 10 min   2x: dismiss']
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

function meter(level: number): string {
  const blocks = '▁▂▃▄▅▆▇█'
  const n = Math.round(level * 16)
  return Array.from({ length: 16 }, (_, i) => (i < n ? blocks[Math.min(7, Math.floor((i / 16) * 8))] : '·')).join('')
}

function voiceBody(v: Voice, now: number): [string, string] {
  switch (v.phase) {
    case 'listening':
      return [
        `● LISTENING   ${meter(v.level)}\n\nSay a reminder, for example\n"call mum in 20 minutes"\n"water the plants at 6 pm"`,
        'tap: done talking   2x tap: cancel',
      ]
    case 'thinking':
      return ['○ TRANSCRIBING ..\n\nTurning your words into a reminder.', '2x tap: cancel']
    case 'confirm': {
      const secs = Math.max(0, Math.ceil((VOICE_AUTOSAVE_MS - (now - v.at)) / 1000))
      return [
        [
          'NEW REMINDER',
          '',
          `□ ${clip(v.text, 40)}`,
          `   ${hhmm(v.due)} · ${relative(v.due, now)}${v.defaulted ? ' (default)' : ''}`,
          '',
          `saves in ${secs} s · heard: "${clip(v.heard, 22)}"`,
        ].join('\n'),
        'tap: save   swipe: -/+10 min   hold: redo   2x: drop',
      ]
    }
    case 'error':
      return [`○ ${clip(v.message, 44)}\n\nTry: "remind me to stretch in 10 minutes"`, 'tap: try again   2x tap: close']
  }
}

const HINTS: Record<Card, string> = {
  now: 'tap: route   hold: voice   swipe: cards   2x: exit',
  agenda: 'tap: pick event   swipe: cards   2x: home',
  focus: 'tap: start/pause   hold: reset   2x: home',
  go: 'tap: next step   hold: restart   2x: home',
  remind: 'tap: done   hold: snooze 10m   2x: home',
}

/** The clock box hugs the right edge (no text alignment on the glasses), sized from its character count. */
function headerBoxes(s: State, now: number): TextBox[] {
  const right = headerRight(s, now)
  const w = Math.min(240, 16 + right.length * 12)
  return [
    { id: 1, name: 'hdr', x: 0, y: 0, w: 576 - w, h: 40, padding: 6, content: headerLeft(s) },
    { id: 5, name: 'clock', x: 576 - w, y: 0, w, h: 40, padding: 6, content: right },
  ]
}

const footBox = (content: string): TextBox => ({ id: 3, name: 'foot', x: 0, y: 252, w: 576, h: 36, padding: 4, color: 2, content })

function deckPage(s: State, now: number, body: string, foot: string): Page {
  const texts: TextBox[] = [
    ...headerBoxes(s, now),
    { id: 2, name: 'body', x: 0, y: 40, w: 576, h: 208, border: 1, radius: 8, padding: 10, content: body, capture: true },
    footBox(foot),
  ]
  return { layout: `deck:${texts[1].w}`, texts, menu: MENU }
}

/** Events offered in the agenda picker (list container, max 20). */
export function pickable(s: State, now: number): AgendaEvent[] {
  const list = timed(s)
  const next = list.findIndex(e => e.end > now)
  const start = next >= 0 ? next : Math.max(0, list.length - 20)
  return list.slice(start, start + 20)
}

export function view(s: State, now: number): Page {
  if (s.voice) {
    const [body, foot] = voiceBody(s.voice, now)
    return deckPage(s, now, body, foot)
  }
  if (s.alert) {
    const [body, foot] = alertBody(s, s.alert, now)
    return deckPage(s, now, body, foot)
  }
  if (s.mode === 'pick') {
    const items = pickable(s, now).map(e => clip(`${hhmm(e.start)}  ${e.title}`, 60))
    const texts = [...headerBoxes(s, now), footBox('swipe: move   tap: route   2x tap: back')]
    return {
      layout: `pick:${texts[1].w}:${items.join('|')}`,
      texts,
      list: { id: 4, name: 'pick', x: 0, y: 40, w: 576, h: 208, border: 1, padding: 6, items, capture: true },
      menu: MENU,
    }
  }
  const body = { now: nowBody, agenda: agendaBody, focus: focusBody, go: goBody, remind: remindBody }[s.card](s, now)
  return deckPage(s, now, body, HINTS[s.card])
}
