import { createServer } from 'node:http'
import { configFromEnv, handleAgendaRequest } from './agenda.ts'

/** Standalone agenda proxy for packaged builds: `GLANCE_ICS_URL=... node server/standalone.ts`. */
const port = Number(process.env.PORT ?? 8787)
const cfg = configFromEnv()

createServer((req, res) => {
  if (req.url?.startsWith('/api/agenda')) return void handleAgendaRequest(req, res, cfg)
  res.statusCode = 404
  res.end('not found')
}).listen(port, () => {
  const src = cfg.icsUrl ? 'GLANCE_ICS_URL' : cfg.icsFile ? `file ${cfg.icsFile}` : 'nothing configured (clients fall back to demo)'
  console.log(`Glance agenda proxy on http://localhost:${port}/api/agenda - source: ${src}`)
})
