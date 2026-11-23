import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { eventsBetween, parseIcs } from '../src/core/ics.ts'

/** Server-side calendar proxy: keeps the secret iCal address off the glasses and adds CORS. */

export interface AgendaConfig {
  /** e.g. a Google Calendar "secret address in iCal format" */
  icsUrl?: string
  icsFile?: string
  cacheMs?: number
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): AgendaConfig {
  return { icsUrl: env.GLANCE_ICS_URL || undefined, icsFile: env.GLANCE_ICS_FILE || undefined }
}

let cache: { key: string; at: number; text: string } | null = null

async function loadIcs(cfg: AgendaConfig, now: number): Promise<string> {
  const key = cfg.icsUrl ?? cfg.icsFile ?? ''
  if (cache && cache.key === key && now - cache.at < (cfg.cacheMs ?? 60_000)) return cache.text
  let text: string
  if (cfg.icsUrl) {
    const res = await fetch(cfg.icsUrl, { headers: { accept: 'text/calendar' } })
    if (!res.ok) throw new Error(`calendar fetch failed: HTTP ${res.status}`)
    text = await res.text()
  } else {
    text = await readFile(cfg.icsFile!, 'utf8')
  }
  cache = { key, at: now, text }
  return text
}

export async function agendaJson(cfg: AgendaConfig, from?: number, to?: number, now = Date.now()) {
  if (!cfg.icsUrl && !cfg.icsFile) {
    return { status: 200, body: { configured: false, error: 'No calendar configured (set GLANCE_ICS_URL or GLANCE_ICS_FILE)' } }
  }
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const f = Number.isFinite(from) ? from! : dayStart.getTime()
  const t = Number.isFinite(to) && to! > f ? Math.min(to!, f + 7 * 86_400_000) : f + 86_400_000
  try {
    const events = eventsBetween(parseIcs(await loadIcs(cfg, now)), f, t)
    return { status: 200, body: { configured: true, source: 'calendar', from: f, to: t, events } }
  } catch (e) {
    return { status: 502, body: { configured: true, error: e instanceof Error ? e.message : String(e) } }
  }
}

export async function handleAgendaRequest(req: IncomingMessage, res: ServerResponse, cfg: AgendaConfig) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const num = (k: string) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined)
  const { status, body } = await agendaJson(cfg, num('from'), num('to'))
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
