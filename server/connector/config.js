// Connector transport config (env + optional data/connector.json).
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, ensureDirs } from '../config/paths.js'

const FILE = () => path.join(DATA_DIR, 'connector.json')

/**
 * Default relay list is empty — streamers set their own self-hosted URLs.
 * Community / personal defaults come from OMO_RELAY_URLS or Settings.
 * Placeholder example.invalid hosts are never used for real connections.
 */
export const DEFAULT_RELAYS = []

function isPlaceholderUrl(url) {
  const u = String(url || '')
  return !u || u.includes('example.invalid') || u.includes('example.com')
}

function envRelays() {
  if (!process.env.OMO_RELAY_URLS) return null
  const urls = process.env.OMO_RELAY_URLS.split(',').map((s) => s.trim()).filter(Boolean)
  if (!urls.length) return null
  return urls.map((url, i) => ({
    id: `env-${i}`,
    url,
    region: i === 0 ? 'eu' : (i === 1 ? 'ru' : `r${i}`)
  }))
}

export function loadConnectorConfig() {
  ensureDirs()
  let file = {}
  try {
    if (fs.existsSync(FILE())) file = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch (_) { /* ignore */ }

  const fromEnv = envRelays()
  let relays = fromEnv
    || (Array.isArray(file.relays) && file.relays.length ? file.relays.map((r) => ({ ...r })) : DEFAULT_RELAYS.map((r) => ({ ...r })))

  // Merge single EU/RU env over matching region entries when not using OMO_RELAY_URLS list.
  if (!fromEnv) {
    if (process.env.OMO_RELAY_EU) {
      const eu = relays.find((r) => r.region === 'eu') || relays[0]
      if (eu) eu.url = process.env.OMO_RELAY_EU
      else relays.push({ id: 'eu', url: process.env.OMO_RELAY_EU, region: 'eu' })
    }
    if (process.env.OMO_RELAY_RU) {
      let ru = relays.find((r) => r.region === 'ru')
      if (!ru) {
        ru = { id: 'ru', url: process.env.OMO_RELAY_RU, region: 'ru' }
        relays.push(ru)
      } else {
        ru.url = process.env.OMO_RELAY_RU
      }
    }
  }

  // Drop placeholders so probe/start fail with a clear “configure relays” message
  relays = relays.filter((r) => r && r.url && !isPlaceholderUrl(r.url))

  return {
    enabled: file.enabled !== false,
    // Primary remote path is outbound WSS relay + join code (not Tailscale).
    preferredProfile: file.preferredProfile || process.env.OMO_PREFERRED_PROFILE || 'relay',
    preferredRegion: file.preferredRegion || process.env.OMO_PREFERRED_REGION || 'auto', // auto | eu | ru
    multiHome: file.multiHome !== false && process.env.OMO_RELAY_MULTIHOME !== '0',
    failover: file.failover !== false && process.env.OMO_RELAY_FAILOVER !== '0',
    relays,
    wireguard: file.wireguard || null,
    headscaleUrl: file.headscaleUrl || process.env.OMO_HEADSCALE_URL || '',
    bindHostOnly: file.bindHostOnly === true || process.env.OMO_BIND_LOOPBACK === '1',
    harden: file.harden === true || process.env.OMO_HARDEN === '1',
    cloudflareHostname: file.cloudflareHostname || process.env.OMO_CLOUDFLARE_HOSTNAME || ''
  }
}

export function saveConnectorConfig(partial) {
  ensureDirs()
  const cur = loadConnectorConfig()
  const next = { ...cur, ...partial }
  if (partial.relays) next.relays = partial.relays
  const toWrite = {
    enabled: next.enabled,
    preferredProfile: next.preferredProfile,
    preferredRegion: next.preferredRegion,
    multiHome: next.multiHome,
    failover: next.failover,
    relays: next.relays,
    wireguard: next.wireguard,
    headscaleUrl: next.headscaleUrl,
    bindHostOnly: next.bindHostOnly,
    harden: next.harden,
    cloudflareHostname: next.cloudflareHostname || ''
  }
  fs.writeFileSync(FILE(), JSON.stringify(toWrite, null, 2), { mode: 0o600 })
  return loadConnectorConfig()
}

/** Parse Endpoint = host:port from WireGuard conf. */
export function parseWireguardEndpoint(confText) {
  const m = String(confText || '').match(/^\s*Endpoint\s*=\s*([^\s#]+)/im)
  return m ? m[1].trim() : ''
}

export { isPlaceholderUrl }
