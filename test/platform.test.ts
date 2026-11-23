import { describe, expect, it } from 'vitest'
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { mapEvent as rawMap } from '../src/platform/evenhub'

const mapEvent = (e: object) => rawMap(e as EvenHubEvent)
import { loadAgenda } from '../src/platform/agenda'
import { agendaJson } from '../server/agenda'

const T0 = new Date(2026, 10, 23, 10, 0).getTime()

describe('Even Hub event mapping', () => {
  it('maps touchpad, list, long press and menu events', () => {
    expect(mapEvent({ textEvent: {} })).toEqual({ kind: 'tap' })
    expect(mapEvent({ sysEvent: {} })).toEqual({ kind: 'tap' })
    expect(mapEvent({ textEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } })).toEqual({ kind: 'double' })
    expect(mapEvent({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } })).toEqual({ kind: 'up' })
    expect(mapEvent({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } })).toEqual({ kind: 'down' })
    expect(mapEvent({ listEvent: { currentSelectItemIndex: 3 } })).toEqual({ kind: 'select', index: 3 })
    expect(mapEvent({ listEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } })).toBeNull()
    expect(mapEvent({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT } })).toEqual({ kind: 'long' })
    expect(mapEvent({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } })).toBeNull()
    expect(mapEvent({ menuItemClickEvent: { itemID: 2 } })).toEqual({ kind: 'menu', id: 2 })
  })
})

describe('agenda loading', () => {
  const fake = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch

  it('falls back to the labelled demo day', async () => {
    const a = await loadAgenda('/api/agenda', T0, fake(200, JSON.stringify({ configured: false, error: 'none' })))
    expect(a.source).toBe('demo')
    expect(a.events.length).toBeGreaterThan(0)
    expect((await loadAgenda('/api/agenda', T0, fake(500, ''))).error).toContain('500')
    const failing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect((await loadAgenda('/api/agenda', T0, failing)).error).toContain('offline')
  })

  it('accepts proxy JSON or a raw .ics response', async () => {
    const ev = { id: 'a', title: 'A', start: T0, end: T0 + 1 }
    expect((await loadAgenda('/api/agenda', T0, fake(200, JSON.stringify({ configured: true, events: [ev] })))).events).toEqual([ev])
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261123T150000\r\nDTEND:20261123T160000\r\nSUMMARY:Raw\r\nEND:VEVENT\r\nEND:VCALENDAR'
    const a = await loadAgenda('https://example.com/cal.ics', T0, fake(200, ics))
    expect(a.source).toBe('calendar')
    expect(a.events.map(e => e.title)).toEqual(['Raw'])
  })

  it('proxy serves today from an .ics file and reports missing config', async () => {
    expect((await agendaJson({})).body).toMatchObject({ configured: false })
    const from = new Date(2026, 10, 23).getTime()
    const r = await agendaJson({ icsFile: 'fixtures/sample-calendar.ics' }, from, from + 86_400_000, T0)
    expect(r.status).toBe(200)
    expect((r.body as { events: { title: string }[] }).events.map(e => e.title)).toContain('Design review')
    expect((await agendaJson({ icsFile: 'fixtures/missing.ics', cacheMs: 0 }, from, from + 1, T0 + 1)).status).toBe(502)
  })
})
