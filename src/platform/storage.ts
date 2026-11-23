import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export interface KV {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/** Even App storage survives WebView restarts on the phone; browser localStorage is the fallback. */
export function bridgeKV(bridge: EvenAppBridge): KV {
  return {
    async get(key) {
      try {
        const v = await bridge.getLocalStorage(key)
        return v ? v : null
      } catch {
        return webKV.get(key)
      }
    },
    async set(key, value) {
      await webKV.set(key, value)
      try {
        await bridge.setLocalStorage(key, value)
      } catch {
        /* keep the browser copy */
      }
    },
  }
}

export const webKV: KV = {
  async get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage disabled */
    }
  },
}
