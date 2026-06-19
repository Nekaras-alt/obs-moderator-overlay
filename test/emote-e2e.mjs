// test/emote-e2e.mjs
// End-to-end smoke test for the 'emote' layer type:
//   1. Moderator WS client applies an addLayer op for an emote.
//   2. Verifies the server accepts it and broadcasts a scene containing it.
//   3. OBS viewer WS client connects and confirms it receives the emote layer.
//   4. Tests both a BTTV emote and a 7TV emote round-trip.
//
// Run against a running server:  node test/emote-e2e.mjs
// Exits 0 on success, 1 on failure.

import { WebSocket } from 'ws'
import fs from 'node:fs'
import { createLayer } from '../shared/schema.js'

const HOST = process.env.HOST || 'ws://localhost:8090/ws'
const PIN = process.env.PIN || '6918'
const HTTP = HOST.replace('ws', 'http').replace('/ws', '')

function log(...a) { console.log('[e2e]', ...a) }

async function moderatorToken() {
  const r = await fetch(`${HTTP}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN })
  })
  const j = await r.json()
  if (!j.ok) throw new Error('login failed: ' + JSON.stringify(j))
  return j.token
}

function viewerToken() {
  return JSON.parse(fs.readFileSync(new URL('../data/.secret', import.meta.url), 'utf8')).viewerToken
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HOST}?t=${token}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function recv(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('recv timeout')), timeoutMs)
    ws.on('message', (buf) => {
      const msg = JSON.parse(buf.toString())
      if (predicate(msg)) { clearTimeout(to); resolve(msg) }
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- Test cases: two emotes from different providers ---
const TEST_EMOTES = [
  {
    label: 'BTTV',
    src: 'https://cdn.betterttv.net/emote/54fa8f1401e468494b85b537/3x.png',
    name: 'E2E BTTV Emote',
    emote: { provider: 'bttv', emoteId: '54fa8f1401e468494b85b537', animated: false }
  },
  {
    label: '7TV',
    // Known 7TV emote "cat" from search results.
    src: 'https://cdn.7tv.app/emote/01KTXZSA7DP4FTYMJVM96ZH31C/4x.webp',
    name: 'E2E 7TV Emote',
    emote: { provider: '7tv', emoteId: '01KTXZSA7DP4FTYMJVM96ZH31C', animated: true }
  }
]

try {
  log('logging in as moderator…')
  const token = await moderatorToken()

  log('connecting moderator WS…')
  const modWs = await connect(token)
  await recv(modWs, (m) => m.type === 'scene')
  log('moderator connected')

  for (const te of TEST_EMOTES) {
    log(`--- testing ${te.label} emote ---`)
    const layer = createLayer({ type: 'emote', src: te.src, name: te.name, emote: te.emote })

    modWs.send(JSON.stringify({ type: 'op', op: { kind: 'addLayer', layer }, ref: 'e2e-add' }))

    const opRes = await recv(modWs, (m) => m.type === 'op-result' && m.ref === 'e2e-add')
    if (!opRes.result?.ok) throw new Error(`[${te.label}] addLayer rejected`)
    log(`[${te.label}] op-result: ok`)

    const sceneMsg = await recv(modWs, (m) => m.type === 'scene')
    const added = sceneMsg.scene.layers.find((l) => l.id === layer.id)
    if (!added) throw new Error(`[${te.label}] emote layer missing from broadcast`)
    if (added.type !== 'emote') throw new Error(`[${te.label}] type not emote: ${added.type}`)
    if (added.src !== te.src) throw new Error(`[${te.label}] src mismatch`)
    if (added.emote?.provider !== te.emote.provider) throw new Error(`[${te.label}] emote.provider mismatch`)
    log(`[${te.label}] broadcast OK:`, { type: added.type, provider: added.emote.provider, animated: added.emote.animated })

    // OBS viewer: open fresh connection, check it sees the layer.
    const viewWs = await connect(viewerToken())
    const viewScene = await recv(viewWs, (m) => m.type === 'scene')
    const vAdded = viewScene.scene.layers.find((l) => l.id === layer.id)
    if (!vAdded) throw new Error(`[${te.label}] OBS viewer missing emote layer`)
    log(`[${te.label}] OBS viewer received it`)
    viewWs.close()

    // Cleanup
    modWs.send(JSON.stringify({ type: 'op', op: { kind: 'deleteLayer', id: layer.id }, ref: 'e2e-del' }))
    await recv(modWs, (m) => m.type === 'op-result' && m.ref === 'e2e-del')
    log(`[${te.label}] cleaned up`)
  }

  modWs.close()
  log('ALL CHECKS PASSED ✓ (BTTV + 7TV)')
  process.exit(0)
} catch (err) {
  console.error('[e2e] FAILED:', err.message)
  process.exit(1)
}
