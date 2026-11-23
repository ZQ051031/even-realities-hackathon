import type { Plugin } from 'vite'
import { handleAgendaRequest, type AgendaConfig } from './agenda.ts'

/** Serves GET /api/agenda from the Vite dev/preview server, so the simulator needs no extra process. */
export function agendaPlugin(cfg: AgendaConfig): Plugin {
  const mount = (server: { middlewares: { use: (path: string, fn: (req: any, res: any) => void) => unknown } }) => {
    server.middlewares.use('/api/agenda', (req, res) => void handleAgendaRequest(req, res, cfg))
  }
  return { name: 'glance-agenda', configureServer: mount, configurePreviewServer: mount }
}
