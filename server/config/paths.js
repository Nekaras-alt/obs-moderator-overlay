// Unified data/uploads path resolution for Electron + standalone.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.join(__dirname, '..', '..')
const RESOURCES = process.resourcesPath || ROOT

/**
 * Mutable app data must never live under Electron resources/ (Program Files).
 * Seed folders there are read-only packaging artifacts (.omo-seed).
 */
function resolveDir(envKey, folder) {
  if (process.env[envKey]) return process.env[envKey]
  // Packaged Electron without OMO_*_DIR would otherwise pick resources/data
  // and write .secret next to the installer — shared PIN for all users.
  if (process.resourcesPath) {
    return path.join(ROOT, folder)
  }
  const bundled = path.join(RESOURCES, folder)
  if (fs.existsSync(bundled)) return bundled
  return path.join(ROOT, folder)
}

export const DATA_DIR = resolveDir('OMO_DATA_DIR', 'data')
export const UPLOADS_DIR = resolveDir('OMO_UPLOADS_DIR', 'uploads')

export function ensureDirs() {
  for (const d of [DATA_DIR, UPLOADS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  }
}
