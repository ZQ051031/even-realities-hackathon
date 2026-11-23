import { describe, expect, it } from 'vitest'
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk'
import { dispatch, initialState, tick, view, voiceFailed, voiceHeard, voiceLevel, voiceThinking, VOICE_AUTOSAVE_MS, type State } from '../src/core/app'
import { demoEvents, demoReminders } from '../src/core/demo'
import { unsafeGlyphs, validatePage } from '../src/core/page'
import { endpointer, parseReminder, rms, wav } from '../src/core/voice'
import { toContainers } from '../src/platform/containers'

const MIN = 60_000
const T0 = new Date(2026, 10, 23, 10, 0).getTime()
const fresh = (): State => initialState({ source: 'demo', events: demoEvents(T0), fetchedAt: T0 }, demoReminders(T0))
const at = (h: number, m: number, day = 23) => new Date(2026, 10, day, h, m).getTime()
const body = (s: State, now = T0) => view(s, now).texts.find(t => t.name === 'body')!.content

describe('parseReminder', () => {
  const cases: [string, string, number][] = [
    ['Remind me to call mum in twenty minutes.', 'Call mum', T0 + 20 * MIN],
    ['remind me to call mum in 20 minutes', 'Call mum', T0 + 20 * MIN],
    ['reminds me to call my mum in 20 minutes.', 'Call my mum', T0 + 20 * MIN],
    ['Water the plants at 6 p.m.', 'Water the plants', at(18, 0)],
    ['send the report tomorrow at 9:30', 'Send the report', at(9, 30, 24)],
    ['In half an hour, stretch.', 'Stretch', T0 + 30 * MIN],
    ["Don't forget to take the bins out in 2 hours", 'Take the bins out', T0 + 120 * MIN],
    ['Hey Glance, remind me about the parcel at 3', 'The parcel', at(15, 0)],
    ['buy milk at 9', 'Buy milk', at(21, 0)],
    ['pick up keys at 11:45 am', 'Pick up keys', at(11, 45)],
    ['check the oven in forty-five minutes', 'Check the oven', T0 + 45 * MIN],
    ['book flights tomorrow', 'Book flights', at(9, 0, 24)],
  ]
  for (const [said, text, due] of cases) {
    it(`"${said}"`, () => {
      const r = parseReminder(said, T0)!
      expect(r.text).toBe(text)
      expect(new Date(r.due).toString()).toBe(new Date(due).toString())
    })
  }

  it('defaults to 30 minutes without a time and rejects empty speech', () => {
    expect(parseReminder('remind me to buy flowers', T0)).toEqual({ text: 'Buy flowers', due: T0 + 30 * MIN, defaulted: true })
    expect(parseReminder('remind me to', T0)).toBeNull()
    expect(parseReminder('   ', T0)).toBeNull()
  })
})

function tone(ms: number, amp: number): Uint8Array {
  const n = (16_000 * ms) / 1000
  const out = new Uint8Array(n * 2)
  const v = new DataView(out.buffer)
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(amp * Math.sin((2 * Math.PI * 220 * i) / 16_000)), true)
  return out
}

describe('audio helpers', () => {
  it('measures level and wraps PCM as 16 kHz mono WAV', () => {
    expect(rms(tone(100, 0))).toBe(0)
    expect(rms(tone(100, 10_000))).toBeGreaterThan(6_000)
    const w = wav(tone(100, 1000))
    const v = new DataView(w.buffer)
    expect(new TextDecoder().decode(w.slice(0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(16_000)
    expect(v.getUint32(40, true)).toBe(3200)
    expect(w.length).toBe(44 + 3200)
  })

  it('ends an utterance after a pause, or gives up when nobody speaks', () => {
    const ep = endpointer({ silenceMs: 1000 })
    const seq = [...Array(3).fill(30), ...Array(8).fill(8000), ...Array(10).fill(30)]
    const states = seq.map(a => ep.push(tone(100, a)))
    expect(states[0]).toBe('listening')
    expect(states[5]).toBe('speaking')
    expect(states.indexOf('done')).toBeGreaterThanOrEqual(3 + 8 + 8)
    expect(states.indexOf('done')).toBeLessThanOrEqual(3 + 8 + 10)
    expect(ep.heardSpeech).toBe(true)
    expect(ep.audio().length).toBe(seq.length * 3200)

    const quiet = endpointer({ noSpeechMs: 2000 })
    const q = Array.from({ length: 25 }, () => quiet.push(tone(100, 30)))
    expect(q.indexOf('done')).toBe(19)
    expect(quiet.heardSpeech).toBe(false)
  })
})

describe('voice flow', () => {
  it('hold on NOW listens, tap finishes, the heard reminder is confirmed and saved', () => {
    let [s, fx] = dispatch(fresh(), { kind: 'long' }, T0)
    expect(fx.listen).toBe('start')
    expect(s.voice?.phase).toBe('listening')
    expect(view(s, T0).texts.find(t => t.name === 'hdr')!.content).toContain('VOICE')
    s = voiceLevel(s, 0.6)
    expect(body(s)).toContain('LISTENING')
    ;[s, fx] = dispatch(s, { kind: 'tap' }, T0)
    expect(fx.listen).toBe('finish')
    expect(s.voice?.phase).toBe('thinking')
    s = voiceHeard(s, 'Remind me to call mum in 20 minutes', T0 + 2000)
    expect(body(s, T0 + 2000)).toContain('□ Call mum')
    expect(body(s, T0 + 2000)).toContain('10:20 · in 20 min')
    ;[s] = dispatch(s, { kind: 'down' }, T0 + 3000)
    expect(s.voice?.phase === 'confirm' && s.voice.due).toBe(T0 + 2000 + 30 * MIN)
    ;[s, fx] = dispatch(s, { kind: 'tap' }, T0 + 4000)
    expect(fx.persist).toBe(true)
    expect(s.voice).toBeNull()
    expect(s.card).toBe('remind')
    expect(s.reminders.at(-1)).toMatchObject({ text: 'Call mum', due: T0 + 2000 + 30 * MIN })
  })

  it('auto-saves hands-free, and double tap cancels', () => {
    let [s] = dispatch(fresh(), { kind: 'menu', id: 6 }, T0)
    s = voiceHeard(voiceThinking(s, T0), 'stretch in 10 minutes', T0)
    ;[s] = tick(s, T0 + VOICE_AUTOSAVE_MS - 1000)
    expect(s.voice?.phase).toBe('confirm')
    const [saved, fx] = tick(s, T0 + VOICE_AUTOSAVE_MS)
    expect(saved.voice).toBeNull()
    expect(fx.persist).toBe(true)
    expect(saved.reminders.at(-1)?.text).toBe('Stretch')

    const [listening] = dispatch(fresh(), { kind: 'long' }, T0)
    const [cancelled, cfx] = dispatch(listening, { kind: 'double' }, T0)
    expect(cancelled.voice).toBeNull()
    expect(cfx.listen).toBe('cancel')
  })

  it('shows errors, retries on tap, and suppresses alerts while listening', () => {
    let [s] = dispatch(fresh(), { kind: 'long' }, T0)
    s = voiceHeard(s, 'remind me to', T0)
    expect(s.voice?.phase).toBe('error')
    const [retry, fx] = dispatch(s, { kind: 'tap' }, T0)
    expect(fx.listen).toBe('start')
    const [still] = tick(retry, T0 + 2 * MIN)
    expect(still.alert).toBeNull()
    expect(voiceFailed(fresh(), 'x', T0).voice).toBeNull()
  })

  it('every voice screen is a valid 576x288 Even Hub page', () => {
    const [l] = dispatch(fresh(), { kind: 'long' }, T0)
    const pages = [
      voiceLevel(l, 1),
      voiceThinking(l, T0),
      voiceHeard(l, 'remind me to send the quarterly report to the whole design team tomorrow at 9:30', T0),
      voiceHeard(l, 'buy flowers', T0),
      voiceFailed(l, 'Speech-to-text HTTP 502 from a very long upstream error message', T0),
    ]
    for (const s of pages) {
      const page = view(s, T0)
      expect(validatePage(page)).toEqual([])
      expect(unsafeGlyphs(page)).toEqual([])
      expect(validateEvenHubPageContainer(toContainers(page))).toEqual({ valid: true })
      for (const t of page.texts) {
        expect(t.content.split('\n').length).toBeLessThanOrEqual(t.h > 100 ? 6 : 1)
        for (const line of t.content.split('\n')) expect(line.length).toBeLessThanOrEqual(t.w > 300 ? 56 : 20)
      }
    }
  })
})
