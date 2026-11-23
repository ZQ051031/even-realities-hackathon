import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { eventsBetween, parseDuration, parseIcs, parseIcsDate, unescapeText } from '../src/core/ics'

const sample = readFileSync(new URL('../fixtures/sample-calendar.ics', import.meta.url), 'utf8')
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime()
const DAY = 86_400_000

describe('ics', () => {
  it('runs in the pinned test timezone', () => {
    expect(new Date(Date.UTC(2026, 10, 23, 0, 0)).getHours()).toBe(8)
  })

  it('parses UTC, TZID, floating and all-day dates', () => {
    expect(parseIcsDate('20261123T100000Z')?.ms).toBe(Date.UTC(2026, 10, 23, 10))
    expect(parseIcsDate('20261123T100000', { TZID: 'America/New_York' })?.ms).toBe(Date.UTC(2026, 10, 23, 15))
    expect(parseIcsDate('20260715T100000', { TZID: 'America/New_York' })?.ms).toBe(Date.UTC(2026, 6, 15, 14))
    expect(parseIcsDate('20261123T100000')?.ms).toBe(new Date(2026, 10, 23, 10).getTime())
    expect(parseIcsDate('20261123', { VALUE: 'DATE' })).toEqual({ ms: day(2026, 11, 23), allDay: true })
    expect(parseIcsDate('20261123T100000', { TZID: 'Not/AZone' })?.ms).toBe(new Date(2026, 10, 23, 10).getTime())
  })

  it('unescapes text and durations', () => {
    expect(unescapeText('a\\, b\\; c\\nd\\\\e')).toBe('a, b; c\nd\\e')
    expect(parseDuration('PT1H30M')).toBe(90 * 60_000)
    expect(parseDuration('P1DT2H')).toBe(26 * 3_600_000)
  })

  it('expands the sample calendar for a weekday', () => {
    const from = day(2026, 11, 23)
    const evs = eventsBetween(parseIcs(sample), from, from + DAY)
    expect(evs.map(e => e.title)).toEqual(['Even Realities hackathon', 'Team standup', 'Design review', 'Lunch with Sam', 'Gym'])
    const review = evs.find(e => e.title === 'Design review')!
    expect(new Date(review.start).getHours()).toBe(11)
    expect(review.location).toBe('Room 4B, Level 3')
    expect(review.steps).toEqual(['Take the lift to Level 3 | 1 min', 'Exit lift, turn right | 20 m', 'Room 4B, 2nd door on left | arrive'])
    expect(evs.find(e => e.title === 'Gym')!.end - evs.find(e => e.title === 'Gym')!.start).toBe(3_600_000)
    expect(evs[0].allDay).toBe(true)
  })

  it('honours BYDAY, EXDATE and cancelled events', () => {
    const titles = (d: number) => eventsBetween(parseIcs(sample), d, d + DAY).map(e => e.title)
    expect(titles(day(2026, 11, 28))).not.toContain('Lunch with Sam') // Saturday
    expect(titles(day(2026, 11, 27))).not.toContain('Lunch with Sam') // EXDATE
    expect(titles(day(2026, 11, 26))).toContain('Lunch with Sam')
    expect(titles(day(2026, 11, 26))).not.toContain('Cancelled sync')
    expect(titles(day(2026, 10, 31))).toEqual([]) // before series start
  })

  it('applies RECURRENCE-ID overrides and COUNT/UNTIL', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:x', 'DTSTART:20261123T090000', 'DTEND:20261123T100000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Daily', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:x', 'RECURRENCE-ID:20261124T090000', 'DTSTART:20261124T140000', 'DTEND:20261124T150000', 'SUMMARY:Moved', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:y', 'DTSTART:20261123T080000Z', 'DTEND:20261123T083000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20261201T000000Z', 'SUMMARY:Weekly', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const raw = parseIcs(ics)
    const on = (d: number) => eventsBetween(raw, d, d + DAY).map(e => e.title)
    expect(on(day(2026, 11, 23))).toEqual(['Daily', 'Weekly'])
    expect(on(day(2026, 11, 24))).toEqual(['Moved'])
    expect(on(day(2026, 11, 25))).toEqual(['Daily'])
    expect(on(day(2026, 11, 26))).toEqual([])
    expect(on(day(2026, 11, 30))).toEqual(['Weekly'])
    expect(on(day(2026, 12, 7))).toEqual([])
  })
})
