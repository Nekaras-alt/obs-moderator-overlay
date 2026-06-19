// server/index.js
// Express (HTTP + static) + ws (WebSocket). Authoritative scene state lives in
// memory and is broadcast to every connected client on every change. Two roles:
//   - viewer (/obs in OBS Browser Source): read-only, renders the scene
//   - moderator (the editor): full control after PIN auth
//
// Dev: vite serves the client on :5173 and proxies /ws + /api here.
// Prod: this server also serves the built client from ../dist.

import express from 'express'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { store } from './state.js'
import { getSecret, createSession, roleForToken } from './auth.js'
import { mountUploadRoute } from './media.js'
import { mountEmoteRoutes } from './emotes.js'
import { bridge } from './obs-bridge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const PORT = process.env.PORT || 8090
const PROD = process.env.NODE_ENV === 'production'

const app = express()
app.use(express.json({ limit: '5mb' }))

// --- Static client -----------------------------------------------------------
// Serve the built SPA whenever dist/ exists. We deliberately don't gate this on
// NODE_ENV: start.bat clears NODE_ENV (so npm install reliably pulls dev deps),
// and `npm run dev` (vite on :5173) never hits these routes anyway because the
// proxy forwards /ws + /api but not the SPA. Keying on dist/ existing is both
// simpler and matches what the user actually observes. /obs is a client route
// (Vue Router), so non-API/WS paths fall through to index.html below.
const DIST = path.join(ROOT, 'dist')
const HAS_DIST = fs.existsSync(DIST)
if (HAS_DIST) {
  app.use(express.static(DIST))
}
app.use('/uploads', express.static(path.join(ROOT, 'uploads')))

// --- Auth API ----------------------------------------------------------------
app.get('/api/hello', (_req, res) => {
  // Lets the client probe the server + announce whether a PIN is set.
  res.json({ ok: true, requiresPin: true, version: '0.1.0' })
})

app.post('/api/login', (req, res) => {
  const { pin } = req.body || {}
  const secret = getSecret()
  if (pin === secret.pin) {
    const token = createSession('moderator')
    return res.json({ ok: true, token, role: 'moderator' })
  }
  return res.status(401).json({ ok: false, error: 'Invalid PIN' })
})

// A viewer token is embedded in the /obs URL so OBS can connect with no login.
app.get('/api/viewer-token', (_req, res) => {
  res.json({ token: getSecret().viewerToken })
})

// Media upload (moderator only): POST /api/upload multipart -> { url, type }.
mountUploadRoute(app)

// OBS bridge: read-only query of native OBS source boundaries.
app.get('/api/obs-sources', (_req, res) => res.json(bridge.snapshot()))

// OBS bridge: toggle a scene item's visibility (moderator only).
app.post('/api/obs/item-enabled', async (req, res) => {
  if (!requireModerator(req, res)) return
  const { sceneName, itemName, enabled } = req.body || {}
  const result = await bridge.setItemEnabled(sceneName, itemName, enabled)
  res.json(result)
})

// OBS bridge: switch the current program scene (moderator only).
app.post('/api/obs/switch-scene', async (req, res) => {
  if (!requireModerator(req, res)) return
  const { sceneName } = req.body || {}
  const result = await bridge.switchScene(sceneName)
  res.json(result)
})

// OBS bridge: list all scenes (moderator only).
app.get('/api/obs/scenes', async (_req, res) => {
  const result = await bridge.listScenes()
  res.json(result)
})

// Emote search/browse proxy (moderator only) — see server/emotes.js.
mountEmoteRoutes(app, requireModerator)

// OBS bridge connect/disconnect — moderator only. The bridge starts
// disconnected; these let the moderator turn the websocket link on/off from
// the Settings panel without restarting the server. Token comes from the
// Authorization: Bearer <token> header set by the editor after PIN login.
function requireModerator(req, res) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (roleForToken(token) !== 'moderator') {
    res.status(403).json({ ok: false, error: 'Moderator only' })
    return false
  }
  return true
}
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

// --- WebSocket ---------------------------------------------------------------
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

// Connected clients: ws -> { role, token, isObs }
const clients = new Set()

function broadcast(message, except = null) {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws === except) continue
    if (ws.readyState !== 1) continue // OPEN
    ws.send(data)
  }
}

function sendFullScene(ws) {
  ws.send(JSON.stringify({ type: 'scene', scene: store.snapshot() }))
}

// OBS bridge: push native source boundaries to moderators whenever OBS changes.
// Viewers (OBS Browser Source) don't need this — it's editor-only chrome.
function broadcastObsSources() {
  const snap = bridge.snapshot()
  broadcast({ type: 'obs-sources', sources: snap.sources, obsConnected: snap.connected })
}
bridge.onUpdate = broadcastObsSources

// If the moderator previously enabled OBS (persisted in scene.settings), auto-
// start the bridge so the setting survives server restarts. The bridge will
// silently retry if OBS isn't running yet — that's fine because the moderator
// explicitly opted in.
if (store.snapshot().settings.obsEnabled) {
  bridge.start()
}

// Tell moderators the current bridge status on demand (e.g. after connect).
let obsStatusTimer = setInterval(() => { if (bridge.connected) broadcastObsSources() }, 5000)

wss.on('connection', (ws, req) => {
  // Token from ?t=... query string.
  const url = new URL(req.url, 'http://x')
  const token = url.searchParams.get('t')
  const role = roleForToken(token)

  if (!role) {
    ws.send(JSON.stringify({ type: 'error', error: 'Unauthorized' }))
    ws.close(4001, 'unauthorized')
    return
  }

  const meta = { role, token, isObs: token === getSecret().viewerToken }
  ws._meta = meta
  clients.add(ws)
  console.log(`[ws] ${role} connected (obs=${meta.isObs}); total=${clients.size}`)

  // Always send the full current scene on connect.
  sendFullScene(ws)

  ws.on('message', (buf) => {
    let msg
    try { msg = JSON.parse(buf.toString()) } catch (_) { return }
    if (meta.role !== 'moderator') {
      // Viewers are read-only; ignore anything they send.
      if (msg.type !== 'ping') return
    }

    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }))
        return
      case 'op': {
        // Authoritative apply: server validates + writes, then broadcasts.
        const result = store.apply(msg.op)
        ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result }))
        if (result.ok) {
          // Full-scene resync to ALL clients (incl. the sender). M0 trades
          // bandwidth for trivial correctness: there is exactly one source of
          // truth (this snapshot), so no client can drift. Optimistic local
          // updates + incremental patches can replace this in a later pass.
          broadcast({ type: 'scene', scene: store.snapshot() })
        }
        return
      }
      case 'mediaCtrl': {
        // Transient media transport (play/pause/seek). NOT persisted: it never
        // touches the store, so it can't pollute scene.json via autosave. We
        // attach a nonce so clients can detect a repeat command (e.g. "seek to
        // 0" twice in a row) and re-apply it. Broadcast to ALL clients incl.
        // the sender — the sender's own StageRenderer applies it too, so the
        // editor preview and the OBS stream converge on the same transport.
        const nonce = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
        const { id, patch } = msg
        broadcast({ type: 'media-ctrl', id, patch, nonce })
        ws.send(JSON.stringify({ type: 'op-result', ref: msg.ref, result: { ok: true } }))
        return
      }
      default:
        return
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    console.log(`[ws] ${meta.role} disconnected; total=${clients.size}`)
  })
})

// SPA fallback (so /obs refresh works). Served whenever the client is built,
// independent of NODE_ENV — see the comment on HAS_DIST above.
if (HAS_DIST) {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/uploads')) {
      return res.status(404).end()
    }
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

// Detect the host's primary LAN IPv4 (for printing friendly URLs in the
// banner). Falls back to 'localhost' if nothing can be resolved — e.g. in a
// sandbox without network access. Best-effort: never throws.
function detectLanIp() {
  try {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        // Skip internal/loopback and non-IPv4. Prefer Tailscale (100.64.0.0/10)
        // and other real NICs. 100.x is the CGNAT range Tailscale uses, so we
        // surface it specifically since the moderator connects over Tailscale.
        if (net.family === 'IPv4' && !net.internal) return net.address
      }
    }
  } catch (_) { /* ignore */ }
  return null
}

server.listen(PORT, '0.0.0.0', () => {
  const secret = getSecret()
  const lanIp = detectLanIp()
  const isTailscale = lanIp && lanIp.startsWith('100.')
  const host = lanIp || 'localhost'
  const line = '═'.repeat(58)
  console.log(line)
  console.log('  OBS Moderator Overlay  —  v0.1.0')
  console.log(line)
  console.log(`  ▸ Editor (you / moderator):  http://localhost:${PORT}/`)
  if (lanIp && lanIp !== '127.0.0.1') {
    console.log(`    on your network:           http://${host}:${PORT}/`)
  }
  console.log(`  ▸ OBS Browser Source URL:     http://localhost:${PORT}/obs?t=${secret.viewerToken}`)
  console.log(line)
  console.log(`  ▸ Moderator PIN:             ${secret.pin}`)
  console.log(`  ▸ Listening on:              0.0.0.0:${PORT}`)
  if (lanIp) {
    const tag = isTailscale ? '  (looks like Tailscale)' : ''
    console.log(`  ▸ Network address:           ${lanIp}:${PORT}${tag}`)
  }
  console.log(`  ▸ Client build:              ${HAS_DIST ? 'served from dist/ ✓' : 'not built (run: npm run build)'}`)
  console.log(line)
  console.log('  Tips:')
  console.log('    • Enter the PIN above in the editor to unlock moderator mode.')
  console.log('    • Paste the OBS Browser Source URL into OBS → Browser Source.')
  console.log('    • New objects are hidden from the audience by default; click')
  console.log('      the globe (🌍) on a layer to reveal it to the stream.')
  console.log('    • Stop the server with Ctrl+C.')
  console.log(line)
})
