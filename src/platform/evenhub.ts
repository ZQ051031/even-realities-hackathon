import {
  AudioInputSource,
  OsEventTypeList,
  TextContainerUpgrade,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import type { Input } from '../core/types'
import type { Page } from '../core/page'
import type { Mic, Renderer } from './renderer'
import { toRebuild, toStartUp } from './containers'

/** CLICK_EVENT is 0 and is often omitted from the payload, so a present envelope without a type is a click. */
const typeOf = (env?: { eventType?: OsEventTypeList }) => (env ? env.eventType ?? OsEventTypeList.CLICK_EVENT : null)

export function mapEvent(event: EvenHubEvent): Input | null {
  const menuId = event.menuItemClickEvent?.itemID
  if (menuId !== undefined) return { kind: 'menu', id: menuId }

  const sys = event.sysEvent
  if (sys?.eventType === OsEventTypeList.LONG_PRESS_EVENT) return { kind: 'long' }

  if (event.listEvent) {
    const t = typeOf(event.listEvent)
    if (t === OsEventTypeList.CLICK_EVENT) return { kind: 'select', index: event.listEvent.currentSelectItemIndex ?? 0 }
    if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'double' }
    return null
  }

  const t = event.textEvent ? typeOf(event.textEvent) : sys && sys.imuData === undefined ? typeOf(sys) : null
  switch (t) {
    case OsEventTypeList.CLICK_EVENT:
      return { kind: 'tap' }
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { kind: 'double' }
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return { kind: 'up' }
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return { kind: 'down' }
    default:
      return null
  }
}

export class EvenHubRenderer implements Renderer {
  readonly kind = 'evenhub' as const
  private current: Page | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private unsubscribe: (() => void) | null = null
  private onPcm: ((pcm: Uint8Array) => void) | null = null

  constructor(
    private bridge: EvenAppBridge,
    private audioSource: AudioInputSource = AudioInputSource.Glasses,
  ) {}

  /** Glasses microphone via audioControl; PCM arrives as audioEvent on the event stream. */
  readonly mic: Mic = {
    start: async onPcm => {
      this.onPcm = onPcm
      const ok = await this.enqueue(() => this.bridge.audioControl(true, this.audioSource))
      if (!ok) {
        this.onPcm = null
        throw new Error('Microphone unavailable')
      }
    },
    stop: async () => {
      if (!this.onPcm) return
      this.onPcm = null
      await this.enqueue(() => this.bridge.audioControl(false))
    },
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(err => console.error('[glance] bridge call failed', err))
    return run
  }

  /** Serialised: page calls go over BLE and must not overlap. */
  show(page: Page): Promise<void> {
    return this.enqueue(() => this.apply(page))
  }

  private async apply(page: Page) {
    const prev = this.current
    if (!prev) {
      const result = await this.bridge.createStartUpPageContainer(toStartUp(page))
      if (result !== 0) throw new Error(`createStartUpPageContainer failed (${result})`)
      console.log('[glance] ready')
    } else if (prev.layout !== page.layout) {
      if (!(await this.bridge.rebuildPageContainer(toRebuild(page)))) throw new Error('rebuildPageContainer failed')
    } else {
      for (const t of page.texts) {
        const old = prev.texts.find(o => o.id === t.id)
        if (old?.content === t.content) continue
        await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({ containerID: t.id, containerName: t.name, content: t.content }),
        )
      }
    }
    this.current = page
  }

  onInput(cb: (input: Input) => void) {
    this.unsubscribe?.()
    this.unsubscribe = this.bridge.onEvenHubEvent(event => {
      const audio = event.audioEvent
      if (audio) {
        const pcm = audio.audioPcm instanceof Uint8Array ? audio.audioPcm : Uint8Array.from(audio.audioPcm as ArrayLike<number>)
        this.onPcm?.(pcm)
        return
      }
      const t = event.sysEvent?.eventType
      if (t === OsEventTypeList.SYSTEM_EXIT_EVENT || t === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
        this.unsubscribe?.()
        return
      }
      const input = mapEvent(event)
      if (input) cb(input)
    })
  }

  async exit() {
    await this.bridge.shutDownPageContainer(1)
  }
}
