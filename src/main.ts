import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { Glance } from './platform/controller'
import { EvenHubRenderer } from './platform/evenhub'
import { MockRenderer } from './platform/mock'
import { bridgeKV, webKV } from './platform/storage'
import { mountCompanion } from './companion'

const hasHost = () => 'flutter_inappwebview' in window

/** Inside the Even Realities App (or the Even Hub simulator) the host injects flutter_inappwebview. */
async function findBridge(): Promise<EvenAppBridge | null> {
  if (new URLSearchParams(location.search).has('mock')) return null
  for (let i = 0; i < 10 && !hasHost(); i++) await new Promise(r => setTimeout(r, 100))
  return hasHost() ? waitForEvenAppBridge() : null
}

async function boot() {
  const bridge = await findBridge()
  document.body.classList.add(bridge ? 'evenhub' : 'mock')
  const renderer = bridge ? new EvenHubRenderer(bridge) : new MockRenderer(document.getElementById('mock')!)
  const app = new Glance(renderer, bridge ? bridgeKV(bridge) : webKV)
  await app.start({ reset: new URLSearchParams(location.search).has('reset') })
  mountCompanion(document.getElementById('companion')!, app)
  ;(window as unknown as { glance: Glance }).glance = app
}

boot().catch(err => {
  console.error('[glance] boot failed', err)
  document.getElementById('companion')!.textContent = `Glance failed to start: ${err}`
})
