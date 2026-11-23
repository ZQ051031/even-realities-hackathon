import { createServer } from 'node:http'
import { configFromEnv, handleAgendaRequest } from './agenda.ts'
import { handleTranscribeRequest, sttEngine, sttFromEnv } from './transcribe.ts'

/** Standalone API for packaged builds: `GLANCE_ICS_URL=... GLANCE_WHISPER_CMD=... node server/standalone.ts`. */
const port = Number(process.env.PORT ?? 8787)
const cfg = configFromEnv()
const stt = sttFromEnv()

createServer((req, res) => {
  if (req.url?.startsWith('/api/agenda')) return void handleAgendaRequest(req, res, cfg)
  if (req.url?.startsWith('/api/transcribe')) return void handleTranscribeRequest(req, res, stt)
  res.statusCode = 404
  res.end('not found')
}).listen(port, () => {
  const src = cfg.icsUrl ? 'GLANCE_ICS_URL' : cfg.icsFile ? `file ${cfg.icsFile}` : 'nothing configured (clients fall back to demo)'
  console.log(`Glance API on http://localhost:${port} - agenda: ${src} - speech-to-text: ${sttEngine(stt) ?? 'off'}`)
})
