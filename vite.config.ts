import { defineConfig, loadEnv } from 'vite'
import { configFromEnv } from './server/agenda.ts'
import { agendaPlugin } from './server/vite-plugin.ts'

export default defineConfig(({ mode }) => ({
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  plugins: [agendaPlugin(configFromEnv({ ...process.env, ...loadEnv(mode, process.cwd(), 'GLANCE_') }))],
}))
