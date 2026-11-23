import type { Input } from '../core/types'
import type { Page } from '../core/page'

/** 16 kHz mono signed 16-bit little-endian PCM, delivered in ~100 ms chunks. */
export interface Mic {
  start(onPcm: (pcm: Uint8Array) => void): Promise<void>
  stop(): Promise<void>
}

export interface Renderer {
  readonly kind: 'evenhub' | 'mock'
  readonly mic?: Mic
  show(page: Page): Promise<void>
  onInput(cb: (input: Input) => void): void
  exit(): Promise<void>
}
