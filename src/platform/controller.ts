import type { Input, Reminder } from '../core/types'
import {
  dispatch,
  initialState,
  startVoice,
  tick,
  view,
  voiceFailed,
  voiceHeard,
  voiceLevel,
  voiceThinking,
  type Effects,
  type State,
} from '../core/app'
import { demoReminders } from '../core/demo'
import { newFocus, reset, type FocusState } from '../core/focus'
import { MIN } from '../core/time'
import { endpointer, wav } from '../core/voice'
import { DEFAULT_AGENDA_URL, loadAgenda } from './agenda'
import type { KV } from './storage'
import type { Renderer } from './renderer'

const K_STATE = 'glance.state.v1'
const K_URL = 'glance.agendaUrl'
const REFRESH_MS = 10 * MIN
export const DEFAULT_STT_URL = '/api/transcribe'
const LEVEL_RENDER_MS = 300

interface Persisted {
  reminders: Reminder[]
  focus: FocusState
}

/** Owns app state: feeds inputs and the clock into the pure core and pushes pages to the renderer. */
export class Glance {
  state!: State
  agendaUrl = DEFAULT_AGENDA_URL
  private timer: ReturnType<typeof setInterval> | null = null
  private refreshing = false
  private closed = false
  private listeners = new Set<() => void>()
  sttUrl = DEFAULT_STT_URL
  /** null = unknown, checked when the app starts */
  sttReady: boolean | null = null
  private voice: { finish(): void; cancel(): void } | null = null

  constructor(
    readonly renderer: Renderer,
    private kv: KV,
    private clock: () => number = Date.now,
  ) {}

  async start(opts: { reset?: boolean } = {}) {
    const now = this.clock()
    if (opts.reset) await this.kv.set(K_STATE, '')
    this.agendaUrl = (await this.kv.get(K_URL)) ?? DEFAULT_AGENDA_URL
    const saved = parse<Persisted>(await this.kv.get(K_STATE))
    const agenda = await loadAgenda(this.agendaUrl, now)
    this.state = initialState(agenda, saved?.reminders ?? demoReminders(now), saved?.focus ?? newFocus())
    this.renderer.onInput(i => this.handle(i))
    await this.render()
    this.timer = setInterval(() => this.onTick(), 1000)
    void this.checkStt()
  }

  handle(input: Input) {
    const [s, fx] = dispatch(this.state, input, this.clock())
    this.apply(s, fx)
  }

  private onTick() {
    const now = this.clock()
    const [s, fx] = tick(this.state, now)
    if (now - s.agenda.fetchedAt > REFRESH_MS) fx.refresh = true
    this.apply(s, fx)
  }

  private apply(s: State, fx: Effects) {
    this.state = s
    if (fx.persist) void this.save()
    if (fx.refresh) void this.refresh()
    if (fx.listen === 'start') this.listen()
    else if (fx.listen === 'finish') this.voice?.finish()
    else if (fx.listen === 'cancel') this.voice?.cancel()
    if (fx.exit) {
      this.voice?.cancel()
      this.closed = true
      this.stop()
      void this.renderer.exit()
      return
    }
    void this.render()
  }

  private render() {
    if (this.closed) return Promise.resolve()
    this.listeners.forEach(l => l())
    return this.renderer.show(view(this.state, this.clock())).catch(err => console.error('[glance]', err))
  }

  // ---- voice reminders: mic PCM -> endpointing -> WAV -> /api/transcribe -> parsed reminder ----

  async checkStt() {
    try {
      const res = await fetch(this.sttUrl)
      this.sttReady = !!((await res.json()) as { configured?: boolean }).configured
    } catch {
      this.sttReady = false
    }
    this.listeners.forEach(l => l())
  }

  private fail(message: string) {
    this.state = voiceFailed(this.state, message, this.clock())
    void this.render()
  }

  private listen() {
    this.voice?.cancel()
    const mic = this.renderer.mic
    if (!mic) return this.fail('No microphone on this device')
    if (this.sttReady === false) return this.fail('Voice needs speech-to-text (README)')
    const ep = endpointer()
    let ended = false
    let lastDraw = 0
    const session = {
      finish: () => void end(true),
      cancel: () => void end(false),
    }
    const end = async (send: boolean) => {
      if (ended) return
      ended = true
      await mic.stop().catch(err => console.error('[glance] mic stop', err))
      if (!send || this.voice !== session) return
      this.voice = null
      const now = this.clock()
      if (!ep.heardSpeech && ep.audio().length < 16_000) {
        this.state = voiceHeard(this.state, '', now)
        return void this.render()
      }
      this.state = voiceThinking(this.state, now)
      void this.render()
      try {
        const text = await this.transcribe(wav(ep.audio()))
        if (this.state.voice?.phase === 'thinking') this.state = voiceHeard(this.state, text, this.clock())
      } catch (err) {
        if (this.state.voice?.phase === 'thinking') this.state = voiceFailed(this.state, String((err as Error).message), this.clock())
      }
      void this.render()
    }
    this.voice = session
    mic
      .start(pcm => {
        if (ended) return
        const r = ep.push(pcm)
        const next = voiceLevel(this.state, ep.level)
        if (r === 'done') return void end(ep.heardSpeech)
        if (next !== this.state && this.clock() - lastDraw > LEVEL_RENDER_MS) {
          lastDraw = this.clock()
          this.state = next
          void this.render()
        }
      })
      .catch(err => {
        ended = true
        if (this.voice === session) this.voice = null
        this.fail(String((err as Error).message ?? err))
      })
  }

  private async transcribe(audio: Uint8Array): Promise<string> {
    const res = await fetch(this.sttUrl, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: new Uint8Array(audio) })
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
    if (!res.ok) throw new Error(body.error ?? `Speech-to-text HTTP ${res.status}`)
    return body.text ?? ''
  }

  /** Same flow as speaking, for typed text (companion) or a browser without a microphone. */
  voiceText(text: string) {
    this.voice?.cancel()
    const now = this.clock()
    this.state = voiceHeard(startVoice(this.state, now)[0], text, now)
    void this.render()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async refresh() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const agenda = await loadAgenda(this.agendaUrl, this.clock())
      this.state = { ...this.state, agenda }
      void this.render()
    } finally {
      this.refreshing = false
    }
  }

  private save() {
    const data: Persisted = { reminders: this.state.reminders, focus: this.state.focus }
    return this.kv.set(K_STATE, JSON.stringify(data))
  }

  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    void this.save()
    void this.render()
  }

  // ---- companion (phone / browser) controls ----

  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  addReminder(text: string, inMinutes: number) {
    const t = text.trim()
    if (!t) return
    const r: Reminder = { id: `r${this.clock().toString(36)}`, text: t.slice(0, 60), due: this.clock() + Math.max(0, inMinutes) * MIN }
    this.update({ reminders: [...this.state.reminders, r] })
  }

  removeReminder(id: string) {
    this.update({ reminders: this.state.reminders.filter(r => r.id !== id) })
  }

  setFocusLengths(focusMinutes: number, breakMinutes: number) {
    const f = { ...this.state.focus, focusMinutes: clampMin(focusMinutes, 25), breakMinutes: clampMin(breakMinutes, 5) }
    this.update({ focus: reset(f) })
  }

  resetDemo() {
    this.update({ reminders: demoReminders(this.clock()), focus: newFocus(), alerted: [], alert: null, card: 'now', mode: 'deck' })
  }

  async setAgendaUrl(url: string) {
    this.agendaUrl = url.trim()
    await this.kv.set(K_URL, this.agendaUrl)
    await this.refresh()
  }
}

const clampMin = (v: number, fallback: number) => (Number.isFinite(v) && v >= 1 ? Math.min(120, Math.round(v)) : fallback)

function parse<T>(s: string | null): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}
