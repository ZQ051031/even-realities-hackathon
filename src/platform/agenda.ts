import type { Agenda, AgendaEvent } from '../core/types'
import { demoEvents } from '../core/demo'
import { eventsBetween, parseIcs } from '../core/ics'
import { addDays, startOfDay } from '../core/time'

export const DEFAULT_AGENDA_URL = '/api/agenda'

/**
 * Loads today's events from the Glance agenda proxy (JSON) or any CORS-enabled .ics URL.
 * Falls back to the labelled demo day when nothing is configured or the request fails.
 */
export async function loadAgenda(url: string, now: number, fetcher: typeof fetch = fetch): Promise<Agenda> {
  const from = startOfDay(now)
  const to = addDays(from, 1)
  const demo = (error: string): Agenda => ({ source: 'demo', events: demoEvents(now), fetchedAt: now, error })
  if (!url.trim()) return demo('No agenda URL set')
  try {
    const sep = url.includes('?') ? '&' : '?'
    const res = await fetcher(`${url}${sep}from=${from}&to=${to}`, { cache: 'no-store' })
    if (!res.ok) return demo(`Agenda request failed: HTTP ${res.status}`)
    const text = await res.text()
    if (text.trimStart().startsWith('BEGIN:VCALENDAR')) {
      return { source: 'calendar', events: eventsBetween(parseIcs(text), from, to), fetchedAt: now }
    }
    const data = JSON.parse(text) as { configured?: boolean; events?: AgendaEvent[]; error?: string }
    if (!data.configured) return demo(data.error ?? 'No calendar configured on the agenda server')
    return { source: 'calendar', events: data.events ?? [], fetchedAt: now }
  } catch (e) {
    return demo(`Agenda unavailable: ${e instanceof Error ? e.message : String(e)}`)
  }
}
