import type { Input } from '../core/types'
import type { Page } from '../core/page'
import type { Mic, Renderer } from './renderer'

/**
 * Browser stand-in for the G2 display: draws the same containers at 576x288 in green on black
 * and emulates the touchpad, list selection and the contextual menu.
 */
export class MockRenderer implements Renderer {
  readonly kind = 'mock' as const
  private page: Page | null = null
  private listIndex = 0
  private menuOpen = false
  private menuIndex = 0
  private cb: (input: Input) => void = () => {}
  private screen: HTMLElement
  private exited = false

  constructor(host: HTMLElement) {
    host.innerHTML = `
      <div class="glasses"><div class="screen" role="img" aria-label="Simulated G2 display"></div></div>
      <div class="pad">
        <button data-a="up" title="Swipe up (ArrowUp)">▲ Swipe up</button>
        <button data-a="tap" title="Tap (Enter / Space)">● Tap</button>
        <button data-a="down" title="Swipe down (ArrowDown)">▼ Swipe down</button>
        <button data-a="double" title="Double tap (Backspace / Esc)">●● Double tap</button>
        <button data-a="long" title="Long press (L)">Hold</button>
        <button data-a="menu" title="Contextual menu (M)">Menu</button>
      </div>
      <p class="keys">Keys: ↑ ↓ swipe · Enter tap · Esc double tap · L hold · M menu</p>`
    this.screen = host.querySelector('.screen')!
    host.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach(b =>
      b.addEventListener('click', () => this.press(b.dataset.a!)),
    )
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      const a = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'tap', ' ': 'tap', Escape: 'double', Backspace: 'double', l: 'long', m: 'menu' }[e.key]
      if (a) {
        e.preventDefault()
        this.press(a)
      }
    })
  }

  press(action: string) {
    if (this.exited) return
    const page = this.page
    if (action === 'menu') {
      this.menuOpen = !this.menuOpen
      this.menuIndex = 0
      return this.draw()
    }
    if (this.menuOpen && page) {
      if (action === 'up') this.menuIndex = Math.max(0, this.menuIndex - 1)
      else if (action === 'down') this.menuIndex = Math.min(page.menu.length - 1, this.menuIndex + 1)
      else if (action === 'tap') {
        this.menuOpen = false
        this.cb({ kind: 'menu', id: page.menu[this.menuIndex].id })
      } else if (action === 'double') this.menuOpen = false
      return this.draw()
    }
    if (page?.list) {
      const n = page.list.items.length
      if (action === 'up') return this.setListIndex(this.listIndex - 1, n)
      if (action === 'down') return this.setListIndex(this.listIndex + 1, n)
      if (action === 'tap') return this.cb({ kind: 'select', index: this.listIndex })
    }
    this.cb({ kind: action as 'tap' | 'double' | 'up' | 'down' | 'long' })
  }

  private setListIndex(i: number, n: number) {
    this.listIndex = Math.min(n - 1, Math.max(0, i))
    this.draw()
  }

  async show(page: Page) {
    if (this.exited) return
    if (page.layout !== this.page?.layout) this.listIndex = 0
    this.page = page
    this.draw()
  }

  private draw() {
    const page = this.page
    if (!page) return
    const box = (x: number, y: number, w: number, h: number, extra = '') =>
      `left:${x}px;top:${y}px;width:${w}px;height:${h}px;${extra}`
    const parts = page.texts.map(t => {
      const style = box(t.x, t.y, t.w, t.h, `padding:${t.padding ?? 0}px;opacity:${0.35 + 0.65 * ((t.color ?? 4) / 4)};` +
        (t.border ? `border:${t.border}px solid var(--g);border-radius:${t.radius ?? 0}px;` : ''))
      return `<div class="c text" data-name="${t.name}" style="${style}">${esc(t.content)}</div>`
    })
    if (page.list) {
      const l = page.list
      const visible = Math.max(1, Math.floor((l.h - 2 * (l.padding ?? 0)) / 34))
      const start = Math.min(Math.max(0, this.listIndex - visible + 1), Math.max(0, l.items.length - visible))
      const items = l.items
        .slice(start, start + visible)
        .map((it, i) => `<div class="item${start + i === this.listIndex ? ' sel' : ''}">${esc(it)}</div>`)
        .join('')
      parts.push(`<div class="c list" data-name="${l.name}" style="${box(l.x, l.y, l.w, l.h, `padding:${l.padding ?? 0}px;border:${l.border ?? 0}px solid var(--g);`)}">${items}</div>`)
    }
    if (this.menuOpen) {
      const items = ['Display off', 'Brightness', ...page.menu.map(m => m.name), 'Close Glance']
      const sel = this.menuIndex + 2
      parts.push(`<div class="c menu">${items.map((m, i) => `<div class="item${i === sel ? ' sel' : ''}${i < 2 || i === items.length - 1 ? ' sys' : ''}">${esc(m)}</div>`).join('')}</div>`)
    }
    this.screen.innerHTML = parts.join('')
  }

  /** Browser microphone resampled to the glasses' 16 kHz s16le format, so the same voice pipeline runs. */
  readonly mic: Mic = browserMic()

  onInput(cb: (input: Input) => void) {
    this.cb = cb
  }

  async exit() {
    this.exited = true
    this.screen.innerHTML = '<div class="c text exit">Glance closed.<br><br>Reload the page to start again.</div>'
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function browserMic(): Mic {
  let stop: (() => void) | null = null
  return {
    async start(onPcm) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('No microphone in this browser')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const ctx = new AudioContext({ sampleRate: 16_000 })
      if (ctx.state === 'suspended') await ctx.resume()
      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(2048, 1, 1)
      let acc: number[] = []
      proc.onaudioprocess = e => {
        const f = e.inputBuffer.getChannelData(0)
        for (const x of f) acc.push(Math.max(-1, Math.min(1, x)))
        while (acc.length >= 1600) {
          const frame = acc.slice(0, 1600)
          acc = acc.slice(1600)
          const pcm = new Uint8Array(3200)
          const v = new DataView(pcm.buffer)
          frame.forEach((x, i) => v.setInt16(i * 2, Math.round(x * 32767), true))
          onPcm(pcm)
        }
      }
      src.connect(proc)
      proc.connect(ctx.destination)
      stop = () => {
        proc.disconnect()
        src.disconnect()
        stream.getTracks().forEach(t => t.stop())
        void ctx.close()
      }
    },
    async stop() {
      stop?.()
      stop = null
    },
  }
}
