import { describe, expect, it } from 'vitest'
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk'
import { CARDS, dispatch, initialState, pickable, tick, view, type State } from '../src/core/app'
import { demoEvents, demoReminders } from '../src/core/demo'
import { unsafeGlyphs, validatePage } from '../src/core/page'
import { toContainers } from '../src/platform/containers'
import type { Agenda, Input } from '../src/core/types'

const MIN = 60_000
const T0 = new Date(2026, 10, 23, 10, 0).getTime()
const agenda = (now = T0): Agenda => ({ source: 'demo', events: demoEvents(now), fetchedAt: now })
const fresh = (): State => initialState(agenda(), demoReminders(T0))
const run = (s: State, inputs: Input['kind'][], now = T0) =>
  inputs.reduce((acc, k) => dispatch(acc, { kind: k } as Input, now)[0], s)

const box = (page: ReturnType<typeof view>, name: string) => page.texts.find(t => t.name === name)!.content

function expectValid(s: State, now: number) {
  const page = view(s, now)
  expect(validatePage(page)).toEqual([])
  expect(unsafeGlyphs(page)).toEqual([])
  expect(validateEvenHubPageContainer(toContainers(page))).toEqual({ valid: true })
  for (const t of page.texts) {
    for (const line of t.content.split('\n')) expect(line.length).toBeLessThanOrEqual(56)
    expect(t.content.split('\n').length).toBeLessThanOrEqual(t.h > 100 ? 6 : 1)
  }
}

describe('Glance state machine', () => {
  it('starts on the NOW card with the next event and reminder', () => {
    const body = box(view(fresh(), T0), 'body')
    expect(body).toContain('NEXT · in 20 min')
    expect(body).toContain('10:20  Design review')
    expect(body).toContain('in 20 min')
    expect(body).toContain('then   12:15  Lunch with Sam')
    expect(body).toContain('Stretch & drink water')
    expect(box(view(fresh(), T0), 'hdr')).toContain('DEMO')
  })

  it('cycles cards with swipes and goes home / exits on double tap', () => {
    let s = run(fresh(), ['down'])
    expect(s.card).toBe('agenda')
    s = run(s, ['up', 'up'])
    expect(s.card).toBe('remind')
    s = run(s, ['double'])
    expect(s.card).toBe('now')
    expect(dispatch(s, { kind: 'double' }, T0)[1].exit).toBe(true)
  })

  it('runs the focus timer from the card and auto-starts the break', () => {
    let s = run(fresh(), ['down', 'down', 'tap'])
    expect(s.card).toBe('focus')
    expect(s.focus.startedAt).toBe(T0)
    expect(box(view(s, T0 + 60_000), 'clock')).toContain('▶ 24:00')
    ;[s] = tick({ ...s, reminders: [] , agenda: { ...s.agenda, events: [] } }, T0 + 25 * MIN)
    expect(s.focus.phase).toBe('break')
    expect(s.alert?.kind).toBe('focus')
    expect(box(view(s, T0 + 25 * MIN), 'body')).toContain('FOCUS SESSION DONE')
  })

  it('steps through route cards for the next event', () => {
    let s = run(fresh(), ['tap'])
    expect(s.card).toBe('go')
    expect(box(view(s, T0), 'body')).toContain('STEP 1 of 4')
    s = run(s, ['tap', 'tap', 'tap', 'tap'])
    expect(box(view(s, T0), 'body')).toContain('You have arrived')
    s = run(s, ['tap'])
    expect(s.goStep).toBe(0)
  })

  it('picks an agenda event from the list and routes to it', () => {
    let s = run(fresh(), ['down', 'tap'])
    expect(s.mode).toBe('pick')
    const page = view(s, T0)
    expect(page.list?.items[0]).toContain('Design review')
    ;[s] = dispatch(s, { kind: 'select', index: 1 }, T0)
    expect(s.card).toBe('go')
    expect(box(view(s, T0), 'body')).toContain('Lunch with Sam')
    expect(pickable(s, T0).length).toBe(4)
    expect(pickable(s, T0 + 12 * 60 * MIN).length).toBe(5)
  })

  it('pops due reminders hands-free, with done, snooze and auto-hide', () => {
    let [s] = tick(fresh(), T0 + 1 * MIN)
    expect(s.alert).toMatchObject({ kind: 'reminder', id: 'demo-r1' })
    const [snoozed] = dispatch(s, { kind: 'down' }, T0 + MIN)
    expect(snoozed.alert).toBeNull()
    expect(snoozed.reminders.find(r => r.id === 'demo-r1')!.due).toBe(T0 + 11 * MIN)
    const [done] = dispatch(s, { kind: 'tap' }, T0 + MIN)
    expect(done.reminders.find(r => r.id === 'demo-r1')!.done).toBe(true)
    ;[s] = tick(s, T0 + MIN + 21_000)
    expect(s.alert?.kind).not.toBe('reminder')
  })

  it('warns 5 minutes before an event and opens its route on tap', () => {
    let s: State = { ...fresh(), reminders: [] }
    ;[s] = tick(s, T0 + 15 * MIN)
    expect(s.alert).toMatchObject({ kind: 'event', id: 'demo-review' })
    ;[s] = dispatch(s, { kind: 'tap' }, T0 + 15 * MIN)
    expect(s.card).toBe('go')
    expect(s.goEventId).toBe('demo-review')
    ;[s] = tick(s, T0 + 16 * MIN)
    expect(s.alert).toBeNull()
  })

  it('handles contextual menu actions', () => {
    let [s, fx] = dispatch(fresh(), { kind: 'menu', id: 1 }, T0)
    expect(s.card).toBe('focus')
    expect(s.focus.startedAt).toBe(T0)
    ;[s, fx] = dispatch(s, { kind: 'menu', id: 4 }, T0)
    expect(fx.refresh).toBe(true)
    ;[s] = dispatch(s, { kind: 'menu', id: 2 }, T0)
    expect(s.reminders.find(r => r.id === 'demo-r1')!.due).toBe(T0 + 10 * MIN)
  })

  it('produces valid, glanceable Even Hub pages in every state', () => {
    const times = [T0, T0 + 30 * MIN, T0 + 9 * 60 * MIN, T0 - 3 * 60 * MIN]
    const variants: State[] = []
    for (const now of times) {
      const base = initialState(agenda(T0), demoReminders(T0))
      for (const card of CARDS) variants.push({ ...base, card })
      variants.push(run(base, ['down', 'tap'], now))
      variants.push(tick(base, T0 + MIN)[0])
      variants.push({ ...base, agenda: { source: 'calendar', events: [], fetchedAt: now }, reminders: [] })
      variants.push(...CARDS.map(card => ({ ...base, card, agenda: { source: 'calendar' as const, events: [], fetchedAt: now }, reminders: [] })))
      for (const s of variants) expectValid(s, now)
    }
  })

  it('caps the agenda picker at 20 list items', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, title: `Meeting number ${i} with a fairly long title that goes on`, start: T0 + i * 10 * MIN, end: T0 + (i * 10 + 5) * MIN }))
    const s = run(initialState({ source: 'calendar', events: many, fetchedAt: T0 }, []), ['down', 'tap'])
    expectValid(s, T0)
    expect(view(s, T0).list!.items).toHaveLength(20)
  })
})
