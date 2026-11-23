import { MIN, HOUR, startOfDay } from './time'

export interface ParsedReminder {
  text: string
  due: number
  /** true when no time was spoken and the default delay was used */
  defaulted: boolean
}

export const DEFAULT_DELAY_MIN = 30

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
}
const NUM = String.raw`(\d+(?:\.\d+)?|(?:twenty|thirty|forty|fifty)[ -](?:one|two|three|four|five|six|seven|eight|nine)|${Object.keys(WORDS).join('|')})`

function num(s: string): number {
  const t = s.toLowerCase().replace('-', ' ')
  if (/^\d/.test(t)) return Number(t)
  const parts = t.split(' ')
  return parts.reduce((sum, p) => sum + (WORDS[p] ?? 0), 0)
}

/** Clock time today (or tomorrow if already past / "tomorrow" was said). */
function clockTime(h: number, m: number, ampm: string | undefined, tomorrow: boolean, now: number): number {
  let hour = h
  const ap = ampm?.replace(/\./g, '').toLowerCase()
  if (ap === 'pm' && hour < 12) hour += 12
  if (ap === 'am' && hour === 12) hour = 0
  const base = startOfDay(now) + (tomorrow ? 24 * HOUR : 0)
  const d = new Date(base)
  d.setHours(hour, m, 0, 0)
  let t = d.getTime()
  if (!tomorrow && t <= now) {
    // "at 3" said at 14:00 means 15:00; a past 24h time means tomorrow
    if (!ap && hour < 12 && t + 12 * HOUR > now) t += 12 * HOUR
    else t += 24 * HOUR
  }
  return t
}

/**
 * Turns a spoken sentence into a reminder: "remind me to call mum in 20 minutes",
 * "water the plants at 6 pm", "tomorrow at 9:30 send the report", "stretch in half an hour".
 */
export function parseReminder(transcript: string, now: number): ParsedReminder | null {
  const norm = transcript
    .toLowerCase()
    .replace(/\b([ap])\.\s?m\b\.?/g, '$1m')
    .replace(/[“”"!?,;]|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  let s = ` ${norm} `
  let due: number | null = null
  const take = (re: RegExp, f: (m: RegExpMatchArray) => number | null) => {
    if (due !== null) return
    const m = s.match(re)
    if (!m) return
    const v = f(m)
    if (v === null) return
    due = v
    s = s.replace(m[0], ' ')
  }
  const tomorrow = /\btomorrow\b/.test(s)
  if (tomorrow) s = s.replace(/\b(tomorrow|tomorrow morning)\b/, ' ')

  take(/\bin (?:a )?half (?:an )?hour\b/, () => now + 30 * MIN)
  take(/\bin (?:an |one )?hour and a half\b/, () => now + 90 * MIN)
  take(/\bin (?:a )?quarter (?:of )?(?:an )?hour\b/, () => now + 15 * MIN)
  take(new RegExp(String.raw`\bin ${NUM} (minutes?|mins?|hours?|hrs?|seconds?|secs?)\b`), m => {
    const n = num(m[1])
    const unit = m[2][0] === 'h' ? HOUR : m[2][0] === 's' ? 1000 : MIN
    return n > 0 ? now + Math.round(n * unit) : null
  })
  take(/\bat (\d{1,2})(?::|\.| )(\d{2}) ?(am|pm)?(?=\s)/, m =>
    Number(m[1]) < 24 && Number(m[2]) < 60 ? clockTime(Number(m[1]), Number(m[2]), m[3], tomorrow, now) : null,
  )
  take(new RegExp(String.raw`\bat ${NUM}(?: o'?clock)? ?(am|pm)?(?=\s)`), m => {
    const h = num(m[1])
    return h >= 0 && h < 24 && Number.isInteger(h) ? clockTime(h, 0, m[2], tomorrow, now) : null
  })
  take(/\bat noon\b/, () => clockTime(12, 0, undefined, tomorrow, now))
  take(/\btonight\b/, () => clockTime(20, 0, undefined, tomorrow, now))
  if (due === null && tomorrow) due = clockTime(9, 0, undefined, true, now)

  const text = s
    .replace(/^\s*(hey glance|okay glance|ok glance|glance)\s/, ' ')
    .replace(/\b(please|can you|could you)\b/g, ' ')
    .replace(/^\s*(remind(s|ed)? me (to|about|that)?|don'?t (let me )?forget (to)?|remember to|i need to|i have to|i must|note to self:?|reminder:?|add a reminder (to)?|set a reminder (to)?)\s/, ' ')
    .replace(/\s+(and|then)?\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text.length < 2) return null
  const clean = text.charAt(0).toUpperCase() + text.slice(1)
  return { text: clean.slice(0, 60), due: due ?? now + DEFAULT_DELAY_MIN * MIN, defaulted: due === null }
}

// ---------- audio: endpointing + WAV ----------

export const SAMPLE_RATE = 16_000
const FRAME_MS = 100

/** Root-mean-square level of 16-bit little-endian mono PCM. */
export function rms(pcm: Uint8Array): number {
  const n = Math.floor(pcm.length / 2)
  if (!n) return 0
  const v = new DataView(pcm.buffer, pcm.byteOffset, n * 2)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const x = v.getInt16(i * 2, true)
    sum += x * x
  }
  return Math.sqrt(sum / n)
}

export interface Endpointer {
  /** Feed one PCM chunk; returns 'done' when the utterance ended (or timed out). */
  push(pcm: Uint8Array): 'listening' | 'speaking' | 'done'
  readonly heardSpeech: boolean
  readonly level: number
  audio(): Uint8Array
}

/** Energy-based voice activity detector: adapts to the noise floor, stops after a pause. */
export function endpointer(opts: { silenceMs?: number; maxMs?: number; noSpeechMs?: number } = {}): Endpointer {
  const silenceMs = opts.silenceMs ?? 1200
  const maxMs = opts.maxMs ?? 10_000
  const noSpeechMs = opts.noSpeechMs ?? 6000
  const chunks: Uint8Array[] = []
  let elapsed = 0
  let floor = 0
  let heard = false
  let quiet = 0
  let level = 0
  return {
    get heardSpeech() {
      return heard
    },
    get level() {
      return level
    },
    push(pcm) {
      chunks.push(pcm)
      const ms = pcm.length / ((SAMPLE_RATE * 2) / 1000) || FRAME_MS
      elapsed += ms
      const e = rms(pcm)
      floor = floor === 0 ? e : Math.min(e, floor * 0.95 + e * 0.05)
      level = Math.min(1, e / 6000)
      const speech = e > Math.max(400, floor * 3)
      if (speech) {
        heard = true
        quiet = 0
      } else if (heard) quiet += ms
      if (elapsed >= maxMs || (heard && quiet >= silenceMs) || (!heard && elapsed >= noSpeechMs)) return 'done'
      return heard ? 'speaking' : 'listening'
    },
    audio() {
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(total)
      let o = 0
      for (const c of chunks) {
        out.set(c, o)
        o += c.length
      }
      return out
    },
  }
}

/** Wraps 16 kHz mono s16le PCM in a WAV container. */
export function wav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}
