import type { Input } from '../core/types'
import type { Page } from '../core/page'

export interface Renderer {
  readonly kind: 'evenhub' | 'mock'
  show(page: Page): Promise<void>
  onInput(cb: (input: Input) => void): void
  exit(): Promise<void>
}
