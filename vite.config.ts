import { defineConfig, loadEnv } from 'vite'
import { configFromEnv } from './server/agenda.ts'
import { sttFromEnv } from './server/transcribe.ts'
import { glancePlugin } from './server/vite-plugin.ts'

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), 'GLANCE_') }
  return {
    server: { host: true, port: 5173 },
    build: { target: 'esnext' },
    plugins: [glancePlugin(configFromEnv(env), sttFromEnv(env))],
  }
})
