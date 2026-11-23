import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanTranscript, handleTranscribeRequest, type SttConfig } from '../server/transcribe'
import { wav } from '../src/core/voice'
import { Glance } from '../src/platform/controller'
import type { Mic, Renderer } from '../src/platform/renderer'
import type { Page } from '../src/core/page'

let server: Server | null = null
afterEach(() => {
  server?.close()
  server = null
  vi.unstubAllGlobals()
})

async function serve(cfg: SttConfig): Promise<string> {
  server = createServer((req, res) => void handleTranscribeRequest(req, res, cfg))
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  return `http://127.0.0.1:${addr.port}/api/transcribe`
}

/** Stand-in for whisper-cli: checks it got a WAV via -f and prints a transcript. */
async function fakeWhisper(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-whisper-'))
  const bin = join(dir, 'whisper-cli')
  await writeFile(bin, `#!/bin/sh\nwhile [ "$1" != "-f" ]; do shift; done\nhead -c 4 "$2" | grep -q RIFF || exit 3\necho ""\necho " [BLANK_AUDIO] Remind me to stretch in 10 minutes."\n`)
  await chmod(bin, 0o755)
  return bin
}

const silence = (ms: number) => new Uint8Array((16_000 * ms * 2) / 1000)

describe('/api/transcribe', () => {
  it('reports when speech-to-text is not configured', async () => {
    const url = await serve({})
    expect(await (await fetch(url)).json()).toEqual({ configured: false, engine: null })
    const res = await fetch(url, { method: 'POST', body: wav(silence(100)) })
    expect(res.status).toBe(501)
  })

  it('runs whisper.cpp on the posted WAV', async () => {
    const url = await serve({ whisperCmd: await fakeWhisper(), whisperModel: 'model.bin' })
    expect(await (await fetch(url)).json()).toEqual({ configured: true, engine: 'whisper.cpp' })
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(silence(500)) })
    expect(await res.json()).toEqual({ text: 'Remind me to stretch in 10 minutes.' })
    expect((await fetch(url, { method: 'POST', body: 'not audio' })).status).toBe(400)
  })

  it('cleans non-speech tags', () => {
    expect(cleanTranscript(' [BLANK_AUDIO]\n (music) buy milk ')).toBe('buy milk')
  })
})

class FakeRenderer implements Renderer {
  readonly kind = 'mock' as const
  pages: Page[] = []
  stopped = 0
  feed: ((pcm: Uint8Array) => void) | null = null
  readonly mic: Mic = {
    start: async cb => void (this.feed = cb),
    stop: async () => void this.stopped++,
  }
  async show(p: Page) {
    this.pages.push(p)
  }
  onInput() {}
  async exit() {}
}

const memKV = () => {
  const m = new Map<string, string>()
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v) }
}

function tone(ms: number, amp: number) {
  const n = (16_000 * ms) / 1000
  const out = new Uint8Array(n * 2)
  const v = new DataView(out.buffer)
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(amp * Math.sin((2 * Math.PI * 220 * i) / 16_000)), true)
  return out
}

describe('Glance voice pipeline', () => {
  it('captures mic PCM, stops after the pause, transcribes and shows the reminder', async () => {
    const url = await serve({ whisperCmd: await fakeWhisper(), whisperModel: 'model.bin' })
    const realFetch = fetch
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(input.startsWith('/api/transcribe') ? url : `${url}/../agenda-missing`, init))
    const r = new FakeRenderer()
    const app = new Glance(r, memKV())
    app.sttUrl = url
    await app.start()
    app.stop()
    await vi.waitFor(() => expect(app.sttReady).toBe(true))
    app.handle({ kind: 'long' })
    await vi.waitFor(() => expect(r.feed).not.toBeNull())
    for (let i = 0; i < 3; i++) r.feed!(tone(100, 20))
    for (let i = 0; i < 10; i++) r.feed!(tone(100, 9000))
    for (let i = 0; i < 14; i++) r.feed!(tone(100, 20))
    await vi.waitFor(() => expect(app.state.voice?.phase).toBe('confirm'), { timeout: 5000 })
    expect(r.stopped).toBe(1)
    const body = r.pages.at(-1)!.texts.find(t => t.name === 'body')!.content
    expect(body).toContain('□ Stretch')
    app.handle({ kind: 'tap' })
    expect(app.state.reminders.at(-1)?.text).toBe('Stretch')
  })

  it('fails gracefully without speech-to-text and accepts typed text', async () => {
    const url = await serve({})
    const r = new FakeRenderer()
    const app = new Glance(r, memKV())
    app.sttUrl = url
    await app.start()
    app.stop()
    await vi.waitFor(() => expect(app.sttReady).toBe(false))
    app.handle({ kind: 'long' })
    expect(app.state.voice).toMatchObject({ phase: 'error' })
    app.voiceText('water the plants at 6 pm')
    expect(app.state.voice).toMatchObject({ phase: 'confirm', text: 'Water the plants' })
  })
})
