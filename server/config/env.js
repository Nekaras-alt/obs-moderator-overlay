// Minimal .env loader (no dotenv dependency). Idempotent.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

let loaded = false

export function loadEnv(extraPaths = []) {
  if (loaded) return
  loaded = true
  const candidates = [
    process.env.OMO_ENV_FILE,
    ...extraPaths,
    path.join(ROOT, '.env')
  ].filter(Boolean)

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const text = fs.readFileSync(file, 'utf8')
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq <= 0) continue
        const key = line.slice(0, eq).trim()
        let val = line.slice(eq + 1).trim()
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        if (process.env[key] === undefined) process.env[key] = val
      }
    } catch (_) { /* ignore unreadable env files */ }
  }
}

// Auto-load when this module is imported (before other modules read process.env).
loadEnv()
