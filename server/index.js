// server/index.js — Express + WebSocket authoritative scene server.
// Cold path: core routes + listen ASAP. Heavy integrations mount after listen.
import './config/env.js'
import express from 'express'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { store } from './state.js'
import {
  getSecret, createSession, roleForToken, getSession,
  checkLoginRateLimit, tokenFromReq, needsSetup, completeSetup, changePin
} from './auth.js'
import { mountUploadRoute } from './media.js'
import { mountEmoteRoutes } from './emotes.js'
import { mountEmoteCacheRoutes, hydrateSceneEmotes } from './emote-cache.js'
import { mountSoundRoutes } from './sounds.js'
import { mountBrowserProxy } from './browser-proxy.js'
import { bridge } from './obs-bridge.js'
import { obsPreview } from './obs-preview.js'
import { DATA_DIR, UPLOADS_DIR, ROOT, ensureDirs } from './config/paths.js'
import { collectNetworkInfo } from './config/network.js'
import { createYtTimelineStore } from './yt-timeline.js'
import { connector, mountConnectorRoutes } from './connector/index.js'
import { loadConnectorConfig } from './connector/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8090
const OMO_MODE = String(process.env.OMO_MODE || 'host').toLowerCase()
ensureDirs()
connector.setMode(OMO_MODE === 'host-obs' ? 'host-obs' : 'host')
connector.setLocalPort(PORT)

// Donatex/SignalR may throw uncaught from handshake teardown; don't crash the process.
function isBenignSignalRNoise(err) {
  const msg = String(err?.message || err || '')
  return (
    msg.includes('HttpConnection.stopConnection') ||
    msg.includes('Error parsing handshake response') ||
    (msg.includes('stopConnection') && msg.includes('connecting state'))
  )
}
process.on('uncaughtException', (err) => {
  if (isBenignSignalRNoise(err)) {
    console.warn('[server] ignored SignalR teardown race:', err?.message || err)
    return
  }
  console.error('[server] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  if (isBenignSignalRNoise(reason)) {
    console.warn('[server] ignored SignalR rejection:', reason?.message || reason)
    return
  }
  console.error('[server] unhandledRejection:', reason)
})

const DIST_CANDIDATES = [
  path.join(ROOT, 'dist'),
  process.resourcesPath ? path.join(process.resourcesPath, 'app', 'dist') : null
].filter(Boolean)
let REAL_DIST = null
for (const candidate of DIST_CANDIDATES) {
  if (fs.existsSync(candidate)) { REAL_DIST = candidate; break }
}
const HAS_DIST = !!REAL_DIST

const app = express()
app.use(express.json({ limit: '5mb' }))
if (HAS_DIST) app.use(express.static(REAL_DIST))
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true, etag: true }))
const DOCS_CANDIDATES = [
  path.join(ROOT, 'docs'),
  process.resourcesPath ? path.join(process.resourcesPath, 'docs') : null,
  process.resourcesPath ? path.join(process.resourcesPath, 'app', 'docs') : null
].filter(Boolean)
const DOCS_DIR = DOCS_CANDIDATES.find((d) => fs.existsSync(d)) || path.join(ROOT, 'docs')
app.use('/docs', express.static(DOCS_DIR))

function requireModerator(req, res) {
  const token = tokenFromReq(req)
  if (roleForToken(token) !== 'moderator') {
    res.status(403).json({ ok: false, error: 'Moderator only' })
    return false
  }
  return true
}

// --- Auth --------------------------------------------------------------------
app.get('/api/hello', (_req, res) => {
  let build = { buildStamp: 'unknown', channel: 'unknown' }
  try {
    const p = path.join(ROOT, 'shared', 'build-info.json')
    if (fs.existsSync(p)) build = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (_) { /* ignore */ }
  res.json({
    ok: true,
    requiresPin: true,
    needsSetup: needsSetup(),
    version: '1.0.0',
    mode: connector.mode,
    buildStamp: build.buildStamp || 'unknown',
    buildChannel: build.channel || 'unknown',
    builtAt: build.builtAt || null
  })
})

app.get('/api/health', (_req, res) => {
  let buildStamp = 'unknown'
  try {
    const p = path.join(ROOT, 'shared', 'build-info.json')
    if (fs.existsSync(p)) buildStamp = JSON.parse(fs.readFileSync(p, 'utf8')).buildStamp || buildStamp
  } catch (_) { /* ignore */ }
  let frameBridge = { enabled: false }
  try {
    const fb = globalThis.__omoFrameBridge
    if (fb) frameBridge = fb.status()
  } catch (_) { /* ignore */ }
  const st = connector.status()
  let viewers = 0
  let moderators = 0
  for (const ws of clients) {
    const r = ws._meta?.role
    if (r === 'viewer') viewers++
    else if (r === 'moderator') moderators++
  }
  const vt = getSecret().viewerToken || ''
  res.json({
    ok: true,
    port: Number(PORT) || 8090,
    buildStamp,
    mode: connector.mode || process.env.OMO_MODE || 'host',
    frameBridge,
    connector: {
      profile: st.profile,
      paired: !!st.relay?.paired,
      rttMs: st.relay?.rttMs ?? null,
      joinCode: st.relay?.joinCode || null
    },
    ws: { viewers, moderators, total: clients.size },
    /** Last 4 of viewer token — compare with ?t=… in pasted overlay URL (stale token = Unauthorized). */
    viewerTokenTail: vt.slice(-4),
    sceneRev: store.rev,
    audienceLayers: (store.scene.layers || []).filter((l) => l.audienceVisible).length,
    totalLayers: (store.scene.layers || []).length,
    ts: Date.now()
  })
})

app.post('/api/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
  const limit = checkLoginRateLimit(String(ip))
  if (!limit.ok) {
    return res.status(429).json({ ok: false, error: 'Too many attempts', retryAfterMs: limit.retryAfterMs })
  }
  if (needsSetup()) {
    return res.status(503).json({ ok: false, error: 'Setup required', needsSetup: true })
  }
  const { pin } = req.body || {}
  const secret = getSecret()
  if (pin && pin === secret.pin) {
    const token = createSession('moderator')
    return res.json({ ok: true, token, role: 'moderator' })
  }
  return res.status(401).json({ ok: false, error: 'Invalid PIN' })
})

/** First-run: streamer creates the moderator PIN (once). */
app.post('/api/setup', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
  const limit = checkLoginRateLimit(String(ip))
  if (!limit.ok) {
    return res.status(429).json({ ok: false, error: 'Too many attempts', retryAfterMs: limit.retryAfterMs })
  }
  const { pin, pinConfirm } = req.body || {}
  if (pinConfirm != null && String(pinConfirm) !== String(pin)) {
    return res.status(400).json({ ok: false, error: 'PIN confirmation does not match' })
  }
  const result = completeSetup(pin)
  if (!result.ok) {
    const status = result.error === 'Setup already completed' ? 409 : 400
    return res.status(status).json(result)
  }
  const token = createSession('moderator')
  return res.json({ ok: true, token, role: 'moderator', setupComplete: true })
})

/** Change PIN (authenticated moderator). */
app.post('/api/pin', (req, res) => {
  if (!requireModerator(req, res)) return
  const { currentPin, newPin, newPinConfirm } = req.body || {}
  if (newPinConfirm != null && String(newPinConfirm) !== String(newPin)) {
    return res.status(400).json({ ok: false, error: 'PIN confirmation does not match' })
  }
  const result = changePin(currentPin, newPin)
  if (!result.ok) {
    const status = result.error === 'Current PIN is incorrect' ? 401 : 400
    return res.status(status).json(result)
  }
  return res.json({ ok: true })
})

app.get('/api/viewer-token', (req, res) => {
  if (!requireModerator(req, res)) return
  res.json({ token: getSecret().viewerToken })
})

mountUploadRoute(app)

app.get('/api/obs-sources', (req, res) => {
  if (!requireModerator(req, res)) return
  res.json(bridge.snapshot())
})

app.post('/api/obs/item-enabled', async (req, res) => {
  if (!requireModerator(req, res)) return
  const { sceneName, itemName, enabled } = req.body || {}
  res.json(await bridge.setItemEnabled(sceneName, itemName, enabled))
})

app.post('/api/obs/switch-scene', async (req, res) => {
  if (!requireModerator(req, res)) return
  const { sceneName } = req.body || {}
  res.json(await bridge.switchScene(sceneName))
})

app.post('/api/obs/layout-target', async (req, res) => {
  if (!requireModerator(req, res)) return
  const target = req.body?.target === 'preview' ? 'preview' : 'program'
  res.json(await bridge.setLayoutTarget(target))
})

app.get('/api/obs/scenes', async (req, res) => {
  if (!requireModerator(req, res)) return
  res.json(await bridge.listScenes())
})

obsPreview.mountRoutes(app, requireModerator)

app.get('/api/network-info', (_req, res) => {
  res.json(collectNetworkInfo(PORT))
})

app.get('/api/presence', (req, res) => {
  if (!requireModerator(req, res)) return
  res.json({ moderators: listModerators() })
})

mountConnectorRoutes(app, requireModerator)

// OBS plugin / local tools — loopback only (no secrets beyond viewer token for overlay URL).
const obsPluginPresence = new Map() // id -> { type, at, detail, frameId, connected }
const OBS_PLUGIN_TTL_MS = 8000

function pruneObsPluginPresence(now = Date.now()) {
  for (const [id, row] of obsPluginPresence) {
    if (!row?.at || now - row.at > OBS_PLUGIN_TTL_MS) obsPluginPresence.delete(id)
  }
}

function frameBridgeStatus() {
  try {
    const fb = globalThis.__omoFrameBridge
    return fb ? fb.status() : { enabled: false, port: Number(process.env.OMO_FRAME_PORT) || 8092 }
  } catch (_) {
    return { enabled: false, port: Number(process.env.OMO_FRAME_PORT) || 8092 }
  }
}

function obsPluginSnapshot() {
  const now = Date.now()
  pruneObsPluginPresence(now)
  const plugins = [...obsPluginPresence.entries()].map(([id, row]) => ({
    id,
    type: row.type,
    ageMs: now - row.at,
    detail: row.detail || null,
    frameId: row.frameId ?? null,
    connected: !!row.connected
  }))
  const fb = frameBridgeStatus()
  const browserLive = plugins.some((p) => p.type === 'browser' && p.ageMs < OBS_PLUGIN_TTL_MS)
  const nativeLive = plugins.some((p) => p.type === 'native' && p.ageMs < OBS_PLUGIN_TTL_MS) ||
    (!!fb.enabled && Number(fb.clients || 0) > 0)
  return {
    hostOnline: true,
    browserConnected: browserLive,
    nativeConnected: nativeLive,
    plugins,
    frameBridge: fb
  }
}

function requireLoopback(req, res) {
  const ip = String(req.socket?.remoteAddress || '')
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  if (!local) {
    res.status(403).json({ ok: false, error: 'localhost only' })
    return false
  }
  return true
}

app.get('/api/obs-plugin/info', (req, res) => {
  if (!requireLoopback(req, res)) return
  const secret = getSecret()
  const st = connector.status()
  const port = Number(PORT) || 8090
  const snap = obsPluginSnapshot()
  res.json({
    ok: true,
    port,
    overlayUrl: `http://127.0.0.1:${port}/obs?t=${secret.viewerToken}`,
    remoteOverlayUrl: st.relay?.remoteOverlayUrl || null,
    multiAlertsUrl: `http://127.0.0.1:${port}/multi-alerts?t=${secret.viewerToken}`,
    viewerToken: secret.viewerToken,
    joinCode: st.relay?.joinCode || null,
    profile: st.profile,
    paired: !!st.relay?.paired,
    rttMs: st.relay?.rttMs ?? null,
    mode: connector.mode || process.env.OMO_MODE || 'host',
    sidecarHint: 'Frame bridge defaults ON for host; Native source uses :8092',
    ...snap
  })
})

app.get('/api/obs-plugin/status', (req, res) => {
  if (!requireLoopback(req, res)) return
  res.json({ ok: true, ...obsPluginSnapshot(), ts: Date.now() })
})

app.post('/api/obs-plugin/heartbeat', (req, res) => {
  if (!requireLoopback(req, res)) return
  const type = String(req.body?.type || 'unknown').slice(0, 32)
  const id = String(req.body?.id || type).slice(0, 64)
  obsPluginPresence.set(id, {
    type,
    at: Date.now(),
    detail: req.body?.detail ? String(req.body.detail).slice(0, 200) : null,
    frameId: req.body?.frameId != null ? Number(req.body.frameId) : null,
    connected: req.body?.connected !== false
  })
  res.json({ ok: true, ...obsPluginSnapshot() })
})

app.get('/api/obs-plugin/frame-bridge', (req, res) => {
  if (!requireLoopback(req, res)) return
  try {
    res.json({ ok: true, ...frameBridgeStatus(), ...obsPluginSnapshot() })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/obs-plugin/frame-bridge/start', async (req, res) => {
  if (!requireLoopback(req, res)) return
  try {
    process.env.OMO_FRAME_BRIDGE = '1'
    if (typeof globalThis.__omoStartFrameBridge === 'function') {
      await globalThis.__omoStartFrameBridge()
    }
    res.json({ ok: true, ...frameBridgeStatus() })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

app.post('/api/obs-plugin/frame-bridge/stop', async (req, res) => {
  if (!requireLoopback(req, res)) return
  try {
    process.env.OMO_FRAME_BRIDGE = '0'
    if (typeof globalThis.__omoStopFrameBridge === 'function') {
      await globalThis.__omoStopFrameBridge()
    }
    res.json({ ok: true, ...frameBridgeStatus() })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})
mountEmoteRoutes(app, requireModerator)
mountEmoteCacheRoutes(app, requireModerator)
mountSoundRoutes(app, requireModerator)
mountBrowserProxy(app, requireModerator)

app.post('/api/obs/connect', (req, res) => {
  if (!requireModerator(req, res)) return
  bridge.start()
  res.json({ ok: true, started: true })
})
app.post('/api/obs/disconnect', (req, res) => {
  if (!requireModerator(req, res)) return
  bridge.stop()
  res.json({ ok: true, started: false })
})

// Stub until deferred donations module loads (WS + /multi-alerts keep working).
let donations = {
  queue: {
    snapshot: () => ({ queue: [], log: [], playing: null }),
    complete() {},
    ctrl() { return { ok: false, error: 'donations still starting' } }
  },
  mountRoutes() {},
  multiAlertsHtml() {
    return '<!doctype html><html><body style="font-family:system-ui;background:#111;color:#eee;padding:24px">Donations module starting…</body></html>'
  }
}
let deferredReady = false

const server = http.createServer(app)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: true
})
const clients = new Set()

const ytTimelines = createYtTimelineStore()

function broadcast(message, except = null) {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws === except) continue
    if (ws.readyState !== 1) continue
    ws.send(data)
  }
}

function broadcastYtTimeline(tl) {
  if (!tl) return
  broadcast({ type: 'yt-timeline', id: tl.id, timeline: tl })
  const patch = {}
  if (tl.stop) {
    patch.stop = true
  } else {
    if (tl.forceSeek) patch.seek = Math.max(0, Number(tl.mediaTime) || 0)
    patch.playing = !!tl.playing
  }
  broadcast({ type: 'media-ctrl', id: tl.id, patch, nonce: 'yt-' + tl.nonce })
}

function broadcastYtChase(tl) {
  if (!tl) return
  broadcast({ type: 'yt-chase', id: tl.id, timeline: tl })
}

function sendYtTimelines(ws) {
  const all = ytTimelines.snapshotAll()
  if (!Object.keys(all).length) return
  ws.send(JSON.stringify({ type: 'yt-timelines', timelines: all }))
}

function broadcastToMods(message) {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws._meta?.role !== 'moderator') continue
    if (ws.readyState !== 1) continue
    ws.send(data)
  }
}

function listModerators() {
  const out = []
  for (const ws of clients) {
    if (ws._meta?.role !== 'moderator') continue
    out.push({
      sessionId: ws._meta.sessionId,
      displayName: ws._meta.displayName,
      avatarSeed: ws._meta.avatarSeed
    })
  }
  return out
}

function broadcastPresence() {
  broadcastToMods({ type: 'presence', moderators: listModerators() })
}

function sendFullScene(ws) {
  ws.send(JSON.stringify({ type: 'scene', scene: store.snapshot(), rev: store.rev }))
}

function broadcastObsLayout() {
  const msg = bridge.layoutMessage('obs-layout')
  broadcastToMods({ ...msg, type: 'obs-sources', sources: msg.sources, obsConnected: msg.obsConnected })
  broadcastToMods(msg)
}

function broadcastObsLayoutPatch(patch) {
  broadcastToMods({ type: 'obs-layout-patch', ...patch, obsConnected: bridge.connected })
}

bridge.onUpdate = () => {
  broadcastObsLayout()
  broadcastToMods({ type: 'obs-preview-status', ...obsPreview.status() })
}
bridge.onLayoutPatch = (patch) => broadcastObsLayoutPatch(patch)
bridge.onSceneChange = () => {
  const nonce = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  broadcast({ type: 'sound-play', stopAll: true, nonce })
}

if (store.snapshot().settings.obsEnabled) bridge.start()
setInterval(() => { if (bridge.connected) broadcastObsLayout() }, 15000)

app.get('/multi-alerts', (req, res) => {
  const token = String(req.query.t || '')
  if (roleForToken(token) !== 'viewer' && roleForToken(token) !== 'moderator') {
    return res.status(401).send('Unauthorized')
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(donations.multiAlertsHtml())
})

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x')
  const token = url.searchParams.get('t')
  const role = roleForToken(token)

  if (!role) {
    const got = String(token || '')
    const expect = String(getSecret().viewerToken || '')
    console.warn(
      `[ws] Unauthorized token (len=${got.length} tail=${got.slice(-4) || '—'}; ` +
        `viewerToken tail=${expect.slice(-4) || '—'}). Re-copy overlay URL from Connector.`
    )
    ws.send(JSON.stringify({ type: 'error', error: 'Unauthorized' }))
    ws.close(4001, 'unauthorized')
    return
  }

  const session = role === 'moderator' ? getSession(token) : null
  const meta = {
    role,
    token,
    isObs: token === getSecret().viewerToken,
    sessionId: session?.sessionId || (role === 'viewer' ? 'viewer' : 'unknown'),
    displayName: session?.displayName || (role === 'viewer' ? 'OBS' : 'Mod'),
    avatarSeed: session?.avatarSeed || '00000000'
  }
  ws._meta = meta
  clients.add(ws)
  console.log(`[ws] ${role} connected (obs=${meta.isObs}); total=${clients.size}`)

  sendFullScene(ws)
  sendYtTimelines(ws)
  if (role === 'moderator') {
    broadcastPresence()
    const msg = bridge.layoutMessage('obs-layout')
    ws.send(JSON.stringify({ ...msg, type: 'obs-sources', sources: msg.sources, obsConnected: msg.obsConnected }))
    ws.send(JSON.stringify(msg))
    ws.send(JSON.stringify({ type: 'obs-preview-status', ...obsPreview.status() }))
    ws.send(JSON.stringify({ type: 'donation-queue', ...donations.queue.snapshot() }))
  }

  ws.on('message', (buf) => {
    let msg
    try { msg = JSON.parse(buf.toString()) } catch (_) { return }

    if (msg.type === 'donation-ended' && (meta.role === 'viewer' || meta.role === 'moderator')) {
      donations.queue.complete(msg.id)
      return
    }

    if (meta.role !== 'moderator') {
      if (msg.type !== 'ping') return
    }

    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        return
      case 'resync':
        sendFullScene(ws)
        return
      case 'op': {
        const result = store.apply(msg.op)
        ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result }))
        if (!result.ok) return
        if (!result.fullSync && (msg.op.kind === 'updateLayer' || msg.op.kind === 'updateSettings' || msg.op.kind === 'updateSoundpad')) {
          broadcast({
            type: 'patch',
            rev: result.rev,
            op: msg.op
          })
        } else {
          broadcast({ type: 'scene', scene: store.snapshot(), rev: result.rev })
        }
        return
      }
      case 'mediaCtrl': {
        const nonce = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        broadcast({ type: 'media-ctrl', id: msg.id, patch: msg.patch, nonce })
        ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result: { ok: true } }))
        return
      }
      case 'ytTransport': {
        const tl = ytTimelines.applyTransport(msg.id, msg.patch || {})
        broadcastYtTimeline(tl)
        ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result: { ok: true, timeline: tl } }))
        return
      }
      case 'ytTime': {
        const tl = ytTimelines.applyChase(msg.id, msg.patch || {})
        broadcastYtChase(tl)
        if (msg.ref != null) {
          ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result: { ok: true } }))
        }
        return
      }
      case 'soundPlay': {
        const nonce = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        const master = store.snapshot().settings?.soundpadMasterVolume
        const vol = typeof msg.volume === 'number'
          ? msg.volume * (typeof master === 'number' ? master : 1)
          : (typeof master === 'number' ? master : 1)
        broadcast({
          type: 'sound-play',
          src: msg.src,
          volume: msg.stopAll ? undefined : vol,
          stopAll: !!msg.stopAll,
          slotId: msg.slotId,
          compressor: msg.compressor ?? !!store.snapshot().settings?.soundpadCompressor,
          nonce
        })
        ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result: { ok: true } }))
        return
      }
      case 'donationCtrl': {
        const r = donations.queue.ctrl(msg.action, msg.id)
        ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result: r }))
        return
      }
      default:
        return
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    console.log(`[ws] ${meta.role} disconnected; total=${clients.size}`)
    if (meta.role === 'moderator') broadcastPresence()
  })
})

async function mountDeferredIntegrations() {
  const t0 = Date.now()
  const [
    { mountTwitchRoutes },
    { mountTwitchOAuth },
    { mountJeetbotRoutes },
    { mountSpotifyRoutes },
    { mountBrowserGateway, attachBrowserWsTunnel },
    { createDonationSystem }
  ] = await Promise.all([
    import('./twitch.js'),
    import('./twitch-oauth.js'),
    import('./jeetbot.js'),
    import('./spotify.js'),
    import('./browser-gateway.js'),
    import('./donations/index.js')
  ])

  mountTwitchRoutes(app, requireModerator)
  mountTwitchOAuth(app, requireModerator)
  mountJeetbotRoutes(app, requireModerator, () => store.snapshot().settings?.twitchChannel || '')
  mountSpotifyRoutes(app, requireModerator)
  mountBrowserGateway(app)
  attachBrowserWsTunnel(server)

  donations = createDonationSystem({
    broadcast: (msg) => broadcast(msg),
    getSettings: () => store.snapshot().settings
  })
  donations.mountRoutes(app, requireModerator)

  // SPA fallback must be registered after deferred API routes.
  if (HAS_DIST) {
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/uploads') || req.path.startsWith('/multi-alerts')) {
        return res.status(404).end()
      }
      res.sendFile(path.join(REAL_DIST, 'index.html'))
    })
  }

  deferredReady = true
  broadcastToMods({ type: 'donation-queue', ...donations.queue.snapshot() })
  console.log(`[server] deferred integrations ready in ${Date.now() - t0}ms`)
}

const connectorCfg = loadConnectorConfig()
const listenHost = (connectorCfg.bindHostOnly || connectorCfg.harden || process.env.OMO_BIND_LOOPBACK === '1' || process.env.OMO_HARDEN === '1')
  ? '127.0.0.1'
  : '0.0.0.0'

server.listen(PORT, listenHost, () => {
  const secret = getSecret()
  const net = collectNetworkInfo(PORT)
  let buildStamp = 'unknown'
  try {
    const bi = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'build-info.json'), 'utf8'))
    buildStamp = bi.buildStamp || buildStamp
  } catch (_) {}
  // Background: rewrite CDN emote layers → /uploads/emotes (offline-safe).
  hydrateSceneEmotes(store.scene).then((n) => {
    if (n > 0) {
      store.markDirty()
      store.save(true)
      console.log(`[emote-cache] hydrated ${n} emote layer(s) to local disk`)
    }
  }).catch((err) => {
    console.warn('[emote-cache] scene hydrate failed:', err.message)
  })
  const line = '═'.repeat(58)
  console.log(line)
  console.log('  OBS Moderator Overlay  —  v0.2.0')
  console.log(`  ▸ Build stamp:              ${buildStamp}`)
  console.log(`  ▸ Mode:                      ${connector.mode}`)
  console.log(`  ▸ Bind:                      ${listenHost}:${PORT}${connectorCfg.harden ? ' (harden)' : ''}`)
  console.log(line)
  console.log(`  ▸ Editor:                    http://localhost:${PORT}/`)
  if (listenHost !== '127.0.0.1' && net.preferredHost && net.preferredHost !== 'localhost') {
    console.log(`    Tailscale/LAN:             http://${net.preferredHost}:${PORT}/`)
  }
  if (process.env.OMO_CONNECTOR_AUTO === '1') {
    const prefer = String(connectorCfg.preferredProfile || 'relay').toLowerCase()
    const run = prefer === 'auto' || prefer === 'direct' || prefer === 'wireguard'
      ? connector.applyAutoProfile()
      : connector.startHostRelay()
    run.then((st) => {
      console.log(`  ▸ Connector profile:         ${st.autoChose || st.profile}`)
      console.log(`  ▸ Relay join code:           ${st.relay?.joinCode || '(pending/direct)'}`)
      if (st.relay?.remoteOverlayUrl) {
        console.log(`  ▸ Streamer overlay (plugin): ${st.relay.remoteOverlayUrl}`)
      }
      if (st.relay?.hosts?.length) {
        console.log(`  ▸ Multi-home relays:         ${st.relay.hosts.map((h) => h.id).join(', ')}`)
      }
    }).catch((err) => {
      console.warn('[connector] auto-start failed:', err.message)
    })
  }
  console.log(`  ▸ OBS Browser Source:         http://localhost:${PORT}/obs?t=${secret.viewerToken}`)
  console.log(`  ▸ Multi-Alerts:               http://localhost:${PORT}/multi-alerts?t=${secret.viewerToken}`)
  console.log(line)
  if (needsSetup()) {
    console.log('  ▸ Moderator PIN:             (not set — open the app and create a PIN)')
  } else {
    console.log(`  ▸ Moderator PIN:             ${secret.pin}`)
  }
  console.log(`  ▸ Data dir:                  ${DATA_DIR}`)
  console.log(`  ▸ Client build:              ${HAS_DIST ? 'served from dist/ ✓' : 'not built (npm run build)'}`)
  console.log(line)
  console.log('  Security: prefer relay + harden (localhost bind). Do not expose 8090/4455 publicly.')
  console.log('  Do NOT expose this port to the public internet / Funnel.')
  console.log(line)

  mountDeferredIntegrations().catch((err) => {
    console.error('[server] deferred integrations failed:', err)
  })
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[fatal] Port ${PORT} is already in use.`)
    console.error('  Run: npm run free-ports   (also runs automatically before npm run dev)')
    console.error('  Then retry. An OLD node/Electron instance may still be holding the port.')
    process.exit(1)
  }
  console.error('[fatal] server error:', err)
  process.exit(1)
})

export { deferredReady }
