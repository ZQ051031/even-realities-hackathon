import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Speech-to-text for voice reminders. Either a local whisper.cpp binary (offline, no account) or any
 * OpenAI-compatible /audio/transcriptions endpoint you already run or have a key for.
 */
export interface SttConfig {
  whisperCmd?: string
  whisperModel?: string
  sttUrl?: string
  sttKey?: string
  sttModel?: string
}

export function sttFromEnv(env: Record<string, string | undefined> = process.env): SttConfig {
  return {
    whisperCmd: env.GLANCE_WHISPER_CMD || undefined,
    whisperModel: env.GLANCE_WHISPER_MODEL || undefined,
    sttUrl: env.GLANCE_STT_URL || undefined,
    sttKey: env.GLANCE_STT_KEY || undefined,
    sttModel: env.GLANCE_STT_MODEL || undefined,
  }
}

export const sttEngine = (cfg: SttConfig) => (cfg.whisperCmd && cfg.whisperModel ? 'whisper.cpp' : cfg.sttUrl ? 'http' : null)

const MAX_BYTES = 2 * 1024 * 1024

/** Drops whisper's non-speech tags like [BLANK_AUDIO] or (wind blowing). */
export function cleanTranscript(s: string): string {
  return s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`whisper failed: ${String(stderr || err.message).trim().split('\n').pop()}`)) : resolve(stdout),
    ),
  )
}

export async function transcribe(cfg: SttConfig, wav: Uint8Array): Promise<string> {
  if (cfg.whisperCmd && cfg.whisperModel) {
    const dir = await mkdtemp(join(tmpdir(), 'glance-stt-'))
    try {
      const file = join(dir, 'utterance.wav')
      await writeFile(file, wav)
      return cleanTranscript(await run(cfg.whisperCmd, ['-m', cfg.whisperModel, '-f', file, '-l', 'en', '-nt', '-np']))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  if (cfg.sttUrl) {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'utterance.wav')
    form.append('model', cfg.sttModel ?? 'whisper-1')
    const res = await fetch(cfg.sttUrl, {
      method: 'POST',
      body: form,
      headers: cfg.sttKey ? { Authorization: `Bearer ${cfg.sttKey}` } : {},
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`speech service returned HTTP ${res.status}`)
    const body = (await res.json()) as { text?: string }
    return cleanTranscript(body.text ?? '')
  }
  throw new Error('not configured')
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let n = 0
    req.on('data', (c: Buffer) => {
      n += c.length
      if (n > MAX_BYTES) {
        reject(new Error('audio too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** GET: is speech-to-text available? POST audio/wav: {text}. */
export async function handleTranscribeRequest(req: IncomingMessage, res: ServerResponse, cfg: SttConfig) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  const send = (status: number, body: object) => {
    res.statusCode = status
    res.end(JSON.stringify(body))
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }
  const engine = sttEngine(cfg)
  if (req.method === 'GET') return send(200, { configured: !!engine, engine })
  if (req.method !== 'POST') return send(405, { error: 'POST audio/wav' })
  if (!engine) return send(501, { error: 'No speech-to-text configured (see README: GLANCE_WHISPER_CMD)' })
  let wav: Buffer
  try {
    wav = await readBody(req)
  } catch (err) {
    return send(413, { error: String((err as Error).message) })
  }
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    return send(400, { error: 'expected a WAV file' })
  try {
    const started = Date.now()
    const text = await transcribe(cfg, wav)
    console.log(`[glance] transcribed ${wav.length} B in ${Date.now() - started} ms: "${text}"`)
    send(200, { text })
  } catch (err) {
    send(502, { error: String((err as Error).message) })
  }
}
