// Detect installed mesh/VPN clients, adapter UP, and live :8090 reachability on this PC.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { execFile } from 'node:child_process'
import { listExternalIpv4, isCgnatIp } from '../config/network.js'
import { isPlaceholderUrl } from './config.js'
import { overlayHttpUrlFromRelay } from './join-code.js'

export const TRANSPORT_RANK = [
  'tailscale',
  'headscale',
  'netbird',
  'zerotier',
  'radmin',
  'porthole',
  'wireguard',
  'cloudflare',
  'relay'
]

/** Steam AppID for Porthole - Local Port Sharing */
const PORTHOLE_APPID = '4963920'

const WIN = process.platform === 'win32'
const CLI_MS = 1000
const PROBE_MS = 600

function pf() {
  return process.env.ProgramFiles || 'C:\\Program Files'
}
function pf86() {
  return process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
}
function localApp() {
  return process.env.LOCALAPPDATA || ''
}

function exists(p) {
  try {
    return !!(p && fs.existsSync(p))
  } catch {
    return false
  }
}

function winCandidates(relPaths) {
  const roots = [pf(), pf86(), localApp()].filter(Boolean)
  const out = []
  for (const root of roots) {
    for (const rel of relPaths) out.push(path.join(root, rel))
  }
  return out
}

function linuxCandidates(absPaths) {
  return absPaths
}

function firstExisting(paths) {
  for (const p of paths) {
    if (exists(p)) return p
  }
  return null
}

function execTimed(cmd, args, timeoutMs = CLI_MS) {
  return new Promise((resolve) => {
    if (!cmd) return resolve({ ok: false, stdout: '', stderr: '' })
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        err
      })
    })
  })
}

async function whichCmd(name) {
  const tool = WIN ? 'where' : 'which'
  const r = await execTimed(tool, [name], CLI_MS)
  if (!r.ok) return null
  const line = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return line && exists(line) ? line : (line || null)
}

function probeUrl(url, timeoutMs = PROBE_MS) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(!!ok)
    }
    let req
    try {
      const u = new URL(url)
      const lib = u.protocol === 'https:' ? https : http
      req = lib.get(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: `${u.pathname || '/'}${u.search || ''}`,
          timeout: timeoutMs,
          rejectUnauthorized: true
        },
        (res) => {
          res.resume()
          done(res.statusCode >= 200 && res.statusCode < 500)
        }
      )
      req.on('timeout', () => {
        try { req.destroy() } catch { /* ignore */ }
        done(false)
      })
      req.on('error', () => done(false))
    } catch {
      done(false)
    }
  })
}

function meshOverlay(ip, port) {
  if (!ip) return null
  return `http://${ip}:${Number(port) || 8090}/obs`
}

function publicOverlay(host) {
  const h = String(host || '').trim().replace(/\/+$/, '')
  if (!h) return null
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h)
      return `${u.protocol}//${u.host}/obs`
    } catch {
      return null
    }
  }
  return `https://${h}/obs`
}

function ifacesFor(tag, ifaces) {
  return ifaces.filter((a) => (a.tags || []).includes(tag) || (tag === 'cgnat' && isCgnatIp(a.address)))
}

function pickIp(tagged, fallbackCgnat) {
  const hit = tagged[0] || fallbackCgnat[0]
  return hit ? { ip: hit.address, iface: hit.name } : { ip: null, iface: null }
}

async function findTailscaleExe() {
  const local = [
    ...winCandidates(['Tailscale\\tailscale.exe']),
    path.join(pf(), 'Tailscale', 'tailscale.exe'),
    ...linuxCandidates(['/usr/bin/tailscale', '/usr/local/bin/tailscale'])
  ]
  return firstExisting(local) || (await whichCmd('tailscale'))
}

async function findExe(winRels, linuxPaths, whichName) {
  const local = [
    ...(WIN ? winCandidates(winRels) : []),
    ...(!WIN ? linuxCandidates(linuxPaths) : [])
  ]
  return firstExisting(local) || (await whichCmd(whichName))
}

function steamLibraryRoots() {
  const roots = new Set()
  const seeds = WIN
    ? [
        path.join(pf86(), 'Steam'),
        path.join(pf(), 'Steam'),
        path.join(localApp(), 'Steam')
      ]
    : [
        path.join(os.homedir(), '.steam', 'steam'),
        path.join(os.homedir(), '.local', 'share', 'Steam'),
        path.join(os.homedir(), '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam')
      ]
  for (const s of seeds) {
    if (exists(s)) roots.add(s)
    const vdf = path.join(s, 'steamapps', 'libraryfolders.vdf')
    if (!exists(vdf)) continue
    try {
      const text = fs.readFileSync(vdf, 'utf8')
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
        const p = m[1].replace(/\\\\/g, '\\')
        if (p && exists(p)) roots.add(p)
      }
    } catch { /* ignore */ }
  }
  return [...roots]
}

function portholeExeCandidates(steamRoot) {
  const common = path.join(steamRoot, 'steamapps', 'common')
  const dirs = [
    'Porthole',
    'Porthole - Local Port Sharing',
    'Porthole Local Port Sharing'
  ]
  const exes = WIN
    ? ['Porthole.exe', 'porthole.exe']
    : ['Porthole', 'porthole', 'Porthole.x86_64']
  const out = []
  for (const d of dirs) {
    for (const e of exes) out.push(path.join(common, d, e))
  }
  const acf = path.join(steamRoot, 'steamapps', `appmanifest_${PORTHOLE_APPID}.acf`)
  if (exists(acf)) {
    try {
      const text = fs.readFileSync(acf, 'utf8')
      const m = text.match(/"installdir"\s+"([^"]+)"/i)
      if (m?.[1]) {
        for (const e of exes) out.push(path.join(common, m[1], e))
      }
    } catch { /* ignore */ }
  }
  return out
}

async function findPortholeExe() {
  const paths = []
  for (const root of steamLibraryRoots()) {
    paths.push(...portholeExeCandidates(root))
  }
  if (WIN) {
    paths.push(
      ...winCandidates([
        'Steam\\steamapps\\common\\Porthole\\Porthole.exe',
        'Steam\\steamapps\\common\\Porthole - Local Port Sharing\\Porthole.exe'
      ])
    )
  } else {
    paths.push(
      ...linuxCandidates([
        path.join(os.homedir(), '.steam', 'steam', 'steamapps', 'common', 'Porthole', 'Porthole'),
        '/usr/bin/porthole'
      ])
    )
  }
  return firstExisting(paths) || (await whichCmd('porthole'))
}

async function isPortholeRunning() {
  if (WIN) {
    const r = await execTimed('tasklist', ['/FI', 'IMAGENAME eq Porthole.exe', '/NH'], CLI_MS)
    return /porthole\.exe/i.test(r.stdout || '')
  }
  const r = await execTimed('pgrep', ['-xi', 'porthole'], CLI_MS)
  if (r.ok && String(r.stdout || '').trim()) return true
  const r2 = await execTimed('pgrep', ['-fi', 'Porthole'], CLI_MS)
  return !!(r2.ok && String(r2.stdout || '').trim())
}

async function tailscaleStatusJson(exe) {
  if (!exe) return null
  const r = await execTimed(exe, ['status', '--json'], CLI_MS)
  if (!r.stdout) return null
  try {
    return JSON.parse(r.stdout)
  } catch {
    return null
  }
}

async function tailscaleControlUrl(exe) {
  if (!exe) return ''
  const r = await execTimed(exe, ['debug', 'prefs'], CLI_MS)
  const text = `${r.stdout}\n${r.stderr}`
  const m = text.match(/ControlURL["'\s:=]+([^\s"',}]+)/i) || text.match(/"ControlURL"\s*:\s*"([^"]+)"/i)
  return m ? String(m[1]).replace(/\\+$/, '') : ''
}

function isOfficialTailscaleControl(url) {
  const u = String(url || '').toLowerCase()
  return !u || u.includes('login.tailscale.com') || u.includes('controlplane.tailscale.com')
}

function itemBase(id) {
  return {
    id,
    installed: false,
    up: false,
    live: false,
    ip: null,
    iface: null,
    overlayUrl: null,
    needsToken: true,
    hint: ''
  }
}

/**
 * @param {{
 *   port?: number,
 *   config?: object,
 *   relay?: { connected?: boolean, remoteOverlayUrl?: string|null, joinCode?: string|null, relayUrl?: string|null }
 * }} opts
 */
export async function detectTransports(opts = {}) {
  const port = Number(opts.port) || 8090
  const config = opts.config || {}
  const relayInfo = opts.relay || {}
  const ifaces = listExternalIpv4()
  const cgnat = ifaces.filter((a) => isCgnatIp(a.address) && !(a.tags || []).some((t) => t !== 'cgnat' && t !== 'tailscale'))

  const tsIf = ifacesFor('tailscale', ifaces)
  const nbIf = ifacesFor('netbird', ifaces)
  const ztIf = ifacesFor('zerotier', ifaces)
  const rdIf = ifacesFor('radmin', ifaces)
  const wgIf = ifacesFor('wireguard', ifaces)

  const [tsExe, nbExe, ztExe, rdExe, phExe, wgExe, cfExe] = await Promise.all([
    findTailscaleExe(),
    findExe(['NetBird\\netbird.exe', 'netbird\\netbird.exe'], ['/usr/bin/netbird', '/usr/local/bin/netbird'], 'netbird'),
    findExe(
      ['ZeroTier\\One\\zerotier-cli.bat', 'ZeroTier\\One\\zerotier-one_x64.exe', 'ZeroTier\\ZeroTier One\\zerotier-one_x64.exe'],
      ['/usr/sbin/zerotier-one', '/usr/bin/zerotier-cli'],
      'zerotier-cli'
    ),
    findExe(['Radmin VPN\\RadminVPN.exe', 'Radmin VPN\\RvpnSvc.exe'], [], 'RadminVPN'),
    findPortholeExe(),
    findExe(['WireGuard\\wireguard.exe', 'WireGuard\\wg.exe'], ['/usr/bin/wg', '/usr/bin/wg-quick'], 'wireguard'),
    findExe(['cloudflared\\cloudflared.exe'], ['/usr/bin/cloudflared', '/usr/local/bin/cloudflared'], 'cloudflared')
  ])
  const phRunning = phExe ? await isPortholeRunning() : false

  const tsJson = tsExe ? await tailscaleStatusJson(tsExe) : null
  const controlUrl = tsExe ? await tailscaleControlUrl(tsExe) : ''
  const savedHs = String(config.headscaleUrl || '').trim()
  const tsRunning = String(tsJson?.BackendState || '').toLowerCase() === 'running'
  const headscaleControl = !!(controlUrl && !isOfficialTailscaleControl(controlUrl))
  const officialTs = !!(tsExe && !headscaleControl)

  const tsPick = pickIp(tsIf, officialTs || (!nbExe && cgnat.length) ? cgnat : [])
  const hsPick = pickIp(tsIf, headscaleControl ? cgnat : [])
  const nbPick = pickIp(nbIf, !tsIf.length && nbExe ? cgnat.filter((a) => !tsIf.includes(a)) : [])
  const ztPick = pickIp(ztIf, [])
  const rdPick = pickIp(rdIf, [])
  const wgConfPath = config.wireguard?.confPath || ''
  const wgPick = pickIp(wgIf, [])

  const relayUrls = (config.relays || []).filter((r) => r?.url && !isPlaceholderUrl(r.url))
  const relayOverlay = relayInfo.remoteOverlayUrl
    || overlayHttpUrlFromRelay(relayInfo.relayUrl, relayInfo.joinCode)

  const cfHost = String(config.cloudflareHostname || config.cloudflareHost || '').trim()

  const items = {
    tailscale: {
      ...itemBase('tailscale'),
      installed: !!(tsExe || tsIf.length),
      up: !!(tsPick.ip || tsRunning),
      ip: tsPick.ip,
      iface: tsPick.iface,
      overlayUrl: meshOverlay(tsPick.ip, port),
      needsToken: true
    },
    headscale: {
      ...itemBase('headscale'),
      installed: !!(headscaleControl || savedHs || tsExe),
      up: !!(hsPick.ip && headscaleControl) || !!(tsRunning && headscaleControl),
      ip: headscaleControl ? hsPick.ip : null,
      iface: headscaleControl ? hsPick.iface : null,
      overlayUrl: headscaleControl ? meshOverlay(hsPick.ip, port) : null,
      needsToken: true
    },
    netbird: {
      ...itemBase('netbird'),
      installed: !!(nbExe || nbIf.length),
      up: !!nbPick.ip,
      ip: nbPick.ip,
      iface: nbPick.iface,
      overlayUrl: meshOverlay(nbPick.ip, port),
      needsToken: true
    },
    zerotier: {
      ...itemBase('zerotier'),
      installed: !!(ztExe || ztIf.length),
      up: !!ztPick.ip,
      ip: ztPick.ip,
      iface: ztPick.iface,
      overlayUrl: meshOverlay(ztPick.ip, port),
      needsToken: true
    },
    radmin: {
      ...itemBase('radmin'),
      installed: !!(rdExe || rdIf.length),
      up: !!rdPick.ip,
      ip: rdPick.ip,
      iface: rdPick.iface,
      overlayUrl: meshOverlay(rdPick.ip, port),
      needsToken: true
    },
    porthole: {
      ...itemBase('porthole'),
      installed: !!phExe,
      up: phRunning,
      live: false,
      ip: '127.0.0.1',
      iface: null,
      overlayUrl: meshOverlay('127.0.0.1', port),
      needsToken: true,
      hint: 'streamer-url-is-localhost-after-porthole-approve'
    },
    wireguard: {
      ...itemBase('wireguard'),
      installed: !!(wgExe || wgIf.length || (wgConfPath && exists(wgConfPath))),
      up: !!wgPick.ip,
      ip: wgPick.ip,
      iface: wgPick.iface,
      overlayUrl: meshOverlay(wgPick.ip, port),
      needsToken: true
    },
    cloudflare: {
      ...itemBase('cloudflare'),
      installed: !!(cfExe || cfHost),
      up: !!cfHost,
      ip: null,
      iface: null,
      overlayUrl: publicOverlay(cfHost),
      needsToken: true,
      hostname: cfHost || ''
    },
    relay: {
      ...itemBase('relay'),
      installed: relayUrls.length > 0,
      up: !!relayInfo.connected,
      live: !!relayInfo.connected,
      ip: null,
      iface: null,
      overlayUrl: relayOverlay,
      needsToken: false
    }
  }

  // Same Tailscale adapter: official vs Headscale — only one should claim the mesh IP as primary.
  if (headscaleControl) {
    items.tailscale.up = false
    items.tailscale.live = false
    items.tailscale.ip = null
    items.tailscale.overlayUrl = null
  } else if (!savedHs) {
    items.headscale.installed = false
  }

  const probes = []
  for (const id of TRANSPORT_RANK) {
    if (id === 'relay' || id === 'porthole') continue
    const it = items[id]
    if (id === 'cloudflare') {
      if (it.overlayUrl) {
        const health = it.overlayUrl.replace(/\/obs\/?$/, '/api/health')
        probes.push(probeUrl(health).then((ok) => { it.live = ok }))
      }
      continue
    }
    if (it.ip) {
      probes.push(
        probeUrl(`http://${it.ip}:${port}/api/health`).then((ok) => {
          it.live = ok
        })
      )
    }
  }
  await Promise.all(probes)
  // Never mark Porthole live via localhost health — would steal activeId from mesh VPNs.
  items.porthole.live = false

  const list = TRANSPORT_RANK.map((id) => items[id])
  const activeId = list.find((i) => i.live)?.id || null
  const firstInstalled = list.find((i) => i.installed)?.id || null
  let recommendedId = activeId || firstInstalled
  let hint = ''
  if (activeId) {
    const ai = TRANSPORT_RANK.indexOf(activeId)
    const better = list.find((i) => TRANSPORT_RANK.indexOf(i.id) < ai && i.installed && !i.live)
    if (better) {
      recommendedId = better.id
      hint = `${better.id}:installed-not-live`
    }
  } else {
    recommendedId = firstInstalled
  }

  return {
    activeId,
    recommendedId,
    hint,
    items: list
  }
}

export function overlayForActive(transports, relayOverlayUrl) {
  const id = transports?.activeId
  const item = (transports?.items || []).find((i) => i.id === id)
  if (!item) {
    return { url: relayOverlayUrl || null, needsToken: !relayOverlayUrl, transportId: id || null }
  }
  return {
    url: item.overlayUrl || (item.id === 'relay' ? relayOverlayUrl : null),
    needsToken: item.id !== 'relay',
    transportId: item.id
  }
}
