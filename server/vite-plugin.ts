import type { Plugin } from 'vite'
import { handleAgendaRequest, type AgendaConfig } from './agenda.ts'
import { handleTranscribeRequest, type SttConfig } from './transcribe.ts'

/** Serves /api/agenda and /api/transcribe from the Vite dev/preview server, so the simulator needs no extra process. */
export function glancePlugin(cfg: AgendaConfig, stt: SttConfig = {}): Plugin {
  const mount = (server: { middlewares: { use: (path: string, fn: (req: any, res: any) => void) => unknown } }) => {
    server.middlewares.use('/api/agenda', (req, res) => void handleAgendaRequest(req, res, cfg))
    server.middlewares.use('/api/transcribe', (req, res) => void handleTranscribeRequest(req, res, stt))
  }
  return { name: 'glance-api', configureServer: mount, configurePreviewServer: mount }
}
