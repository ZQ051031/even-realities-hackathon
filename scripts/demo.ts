/**
 * One-command scripted demo for the Even Hub simulator (also a repeatable end-to-end check).
 *
 *   npm run demo                # starts Vite + simulator, walks every card, saves screenshots
 *   npm run demo -- --keep      # leave the simulator open afterwards (e.g. to keep recording)
 *   npm run demo -- --pace 4    # seconds per step (default 3) - slow it down for a voice-over
 *   npm run demo -- --voice tts # say the voice reminder with espeak-ng into a PulseAudio sink (Linux)
 *   npm run demo -- --voice mic # pause and let you say it into your microphone
 *
 * Nothing is uploaded anywhere. Output: demo-out/NN-step.png + demo-out/captions.txt.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateSync, inflateSync, crc32 } from 'node:zlib'

const args = process.argv.slice(2)
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt
}
const flag = (name: string) => args.includes(`--${name}`)
const PACE = Number(opt('pace', '3')) * 1000
const VOICE = opt('voice', flag('voice') ? 'mic' : 'off')
const PORT = Number(opt('port', '5173'))
const AUTO = Number(opt('automation-port', '9898'))
const OUT = resolve(opt('out', 'demo-out'))
const APP = `http://localhost:${PORT}`
const SIM = `http://127.0.0.1:${AUTO}`
const UTTERANCE = 'Remind me to call mum in twenty minutes.'

const children: ChildProcess[] = []
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const t0 = Date.now()
const captions: string[] = []

function log(msg: string) {
  const t = ((Date.now() - t0) / 1000).toFixed(1).padStart(6)
  console.log(`[demo ${t}s] ${msg}`)
}

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

async function waitFor(url: string, what: string, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await up(url)) return
    await sleep(500)
  }
  throw new Error(`${what} did not come up at ${url}`)
}

// ---------- calendar for the demo: times relative to now so every alert shows up on cue ----------

function icsTime(ms: number) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

function demoIcs(now: number): string {
  const m = (n: number) => now + n * 60_000
  const ev = (uid: string, start: number, end: number, title: string, loc: string, desc = '') =>
    ['BEGIN:VEVENT', `UID:${uid}@glance-demo`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`, `SUMMARY:${title}`, `LOCATION:${loc}`, desc && `DESCRIPTION:${desc}`, 'END:VEVENT']
      .filter(Boolean)
      .join('\r\n')
  const d = new Date(now)
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Glance//demo//EN',
    ev('standup', m(-40), m(-25), 'Team standup', 'Zoom'),
    ev('review', m(4.5), m(50), 'Design review', 'Room 4B, Level 3', 'GO: Take the lift to Level 3 | 1 min\\nGO: Exit lift\\, turn right | 20 m\\nGO: Room 4B\\, 2nd door on left | arrive'),
    ev('lunch', m(120), m(180), 'Lunch with Sam', 'Noodle Bar, 12 Hill St'),
    ev('gym', m(300), m(360), 'Gym', 'FitHub'),
    ['BEGIN:VEVENT', 'UID:hack@glance-demo', `DTSTART;VALUE=DATE:${day}`, 'SUMMARY:Heads Up hackathon', 'END:VEVENT'].join('\r\n'),
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

// ---------- simulator automation ----------

async function input(action: string) {
  const res = await fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
  if (!res.ok) throw new Error(`input ${action}: HTTP ${res.status}`)
}

let shotNo = 0
async function shot(name: string, caption: string) {
  const res = await fetch(`${SIM}/api/screenshot/glasses`)
  const file = join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`)
  writeFileSync(file, alphaToBlack(Buffer.from(await res.arrayBuffer())))
  captions.push(`${((Date.now() - t0) / 1000).toFixed(1)}s\t${file.slice(OUT.length + 1)}\t${caption}`)
  log(`${caption}  -> ${file.slice(process.cwd().length + 1)}`)
}

async function step(caption: string, name: string, actions: string[] = [], pace = PACE) {
  for (const a of actions) {
    await input(a)
    await sleep(350)
  }
  await sleep(Math.max(600, pace - 350 * actions.length))
  await shot(name, caption)
}

/** The simulator returns the display in the alpha channel of a green image; flatten it onto black. */
function alphaToBlack(png: Buffer): Buffer {
  let off = 8
  let w = 0
  let h = 0
  let type = 0
  const idat: Buffer[] = []
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    const kind = png.toString('ascii', off + 4, off + 8)
    const data = png.subarray(off + 8, off + 8 + len)
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      type = data[9]
      if (data[8] !== 8 || data[12] !== 0) return png
    } else if (kind === 'IDAT') idat.push(data)
    off += 12 + len
  }
  if (type !== 6) return png
  const bpp = 4
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0
      const p = a + b - c
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c) : 0
      px[y * stride + x] = (src[x] + pred) & 0xff
    }
  }
  const rgb = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * stride + x * 4
      const o = y * (w * 3 + 1) + 1 + x * 3
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.round((px[i + k] * px[i + 3]) / 255)
    }
  const chunk = (kind: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(kind, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rgb)), chunk('IEND', Buffer.alloc(0))])
}

// ---------- voice ----------

const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0

function ttsUtterance(): string | null {
  if (!has('espeak-ng') || !has('ffmpeg') || !has('paplay') || !has('pactl')) return null
  const raw = join(OUT, 'utterance-raw.wav')
  const out = join(OUT, 'utterance.wav')
  spawnSync('espeak-ng', ['-s', '150', '-w', raw, UTTERANCE])
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-t', '0.6', '-i', 'anullsrc=r=16000:cl=mono', '-i', raw, '-f', 'lavfi', '-t', '2', '-i', 'anullsrc=r=16000:cl=mono', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-ar', '16000', '-ac', '1', out])
  const sinks = spawnSync('pactl', ['list', 'short', 'sinks']).stdout.toString()
  if (!sinks.includes('glance_voice')) spawnSync('pactl', ['load-module', 'module-null-sink', 'sink_name=glance_voice', 'rate=16000', 'channels=1'])
  spawnSync('pactl', ['set-default-source', 'glance_voice.monitor'])
  return out
}

// ---------- run ----------

function start(cmd: string, argv: string[], env: Record<string, string> = {}) {
  const child = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr?.on('data', d => {
    const line = String(d).trim()
    if (/error|panic/i.test(line) && !/Gtk|dbind|libEGL/i.test(line)) console.error(`  [${cmd}] ${line.split('\n')[0]}`)
  })
  child.on('error', err => {
    console.error(`[demo] could not start ${cmd}: ${err.message} (did you run npm install?)`)
    cleanup()
    process.exit(1)
  })
  children.push(child)
  return child
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const stt = await fetch(`${APP}/api/transcribe`).then(r => r.json()).catch(() => null)

  if (await up(`${APP}/api/agenda`)) {
    log(`using the dev server already running on ${APP} (its own calendar; restart it via this script for the demo calendar)`)
  } else {
    const ics = join(OUT, 'demo.ics')
    writeFileSync(ics, demoIcs(Date.now()))
    log(`starting Vite on ${APP} with demo calendar ${ics}`)
    start(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { GLANCE_ICS_FILE: ics })
    await waitFor(`${APP}/api/agenda`, 'Vite')
  }
  const sttNow = stt ?? (await fetch(`${APP}/api/transcribe`).then(r => r.json()).catch(() => ({})))

  if (await up(`${SIM}/api/ping`)) log('attaching to the simulator that is already running (reload it to reset the demo)')
  else {
    log('starting the Even Hub simulator')
    start(process.execPath, [resolve('node_modules/@evenrealities/evenhub-simulator/bin/index.js'), `${APP}/?reset`, '--automation-port', String(AUTO)])
    await waitFor(`${SIM}/api/ping`, 'Even Hub simulator')
  }
  await sleep(4000)
  const appStart = Date.now()

  await step('Event heads-up pops up: Design review starts in 4 min', 'alert-event', [], 1500)
  await step('Tap: turn-by-turn GO cards for the meeting', 'go-step1', ['click'])
  await step('Tap: next step', 'go-step2', ['click'])
  await step('Tap: last step', 'go-step3', ['click'])
  await step('Tap: arrived', 'go-arrived', ['click'])
  await step('Double tap: home - the NOW card', 'now', ['double_click'])
  await step('Swipe: AGENDA - today at a glance', 'agenda', ['down'])
  await step('Tap: pick an event from the list', 'agenda-pick', ['click'])
  await step('Double tap: back', 'agenda-back', ['double_click'], 1200)
  await step('Swipe + tap: FOCUS timer running, also shown in the header', 'focus', ['down', 'click'])
  await step('Swipe: GO card for the next event', 'go', ['down'])
  await step('Swipe: REMIND list', 'remind', ['down'])

  if (VOICE === 'off' || !sttNow?.configured) {
    log(VOICE === 'off' ? 'voice step skipped (add --voice tts or --voice mic)' : 'voice step skipped: speech-to-text is not configured on the server (GLANCE_WHISPER_CMD, see README)')
  } else {
    const wav = VOICE === 'tts' ? ttsUtterance() : null
    if (VOICE === 'tts' && !wav) log('tts needs espeak-ng, ffmpeg and PulseAudio - falling back to your microphone')
    await step('Double tap: home. Hold: voice reminder - listening', 'voice-listen', ['double_click', 'long_press', 'long_press_release'], 1500)
    if (wav) spawnSync('paplay', ['--device=glance_voice', wav])
    else {
      log(`>>> say now: "${UTTERANCE}"`)
      await sleep(6000)
    }
    await sleep(3500)
    await shot('voice-confirm', 'Heard and parsed: reminder confirmed, saves itself hands-free')
    await step('Tap: saved to REMIND', 'voice-saved', ['click'])
  }

  const wait = 62_000 - (Date.now() - appStart)
  if (wait > 0) {
    log(`waiting ${Math.ceil(wait / 1000)} s for the first demo reminder to fall due`)
    await sleep(wait)
  }
  await step('Reminder alert pops up on its own', 'alert-reminder', [], 1500)
  await step('Tap: done', 'reminder-done', ['click'])
  await step('Contextual menu (simulator menu button)', 'menu', ['context_menu'])

  writeFileSync(join(OUT, 'captions.txt'), captions.join('\n') + '\n')
  log(`done: ${shotNo} screenshots + captions.txt in ${OUT}`)
}

const cleanup = () => {
  if (!flag('keep')) children.forEach(c => c.kill())
}
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})
main()
  .then(() => {
    if (flag('keep') && children.length) log('--keep: simulator left running, Ctrl+C to quit')
    else cleanup()
  })
  .catch(err => {
    console.error(`[demo] failed: ${err.message}`)
    cleanup()
    process.exit(1)
  })
