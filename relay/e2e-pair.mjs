#!/usr/bin/env node
/**
 * Local E2E: start in-process checks against a running relay, or spawn one.
 * Usage: node e2e-pair.mjs [ws://127.0.0.1:8787/connector]
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { WebSocket } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const urlArg = process.argv[2]
const PORT = 18787
const PATH = '/connector'
const url = urlArg || `ws://127.0.0.1:${PORT}${PATH}`

function waitOpen(ws, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws open timeout')), ms)
    ws.once('open', () => { clearTimeout(t); resolve() })
    ws.once('error', (e) => { clearTimeout(t); reject(e) })
  })
}

function onceMessage(ws, pred, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('message timeout')), ms)
    const onMsg = (raw) => {
      let msg
      try { msg = JSON.parse(String(raw)) } catch (_) { return }
      if (!pred(msg)) return
      clearTimeout(t)
      ws.off('message', onMsg)
      resolve(msg)
    }
    ws.on('message', onMsg)
  })
}

async function runPair(relayUrl) {
  const host = new WebSocket(relayUrl)
  await waitOpen(host)
  host.send(JSON.stringify({ type: 'hello', role: 'host' }))
  const reg = await onceMessage(host, (m) => m.type === 'registered' || m.type === 'error')
  if (reg.type === 'error') throw new Error('host: ' + reg.error)
  const code = reg.code
  console.log('[e2e] registered', code)

  const client = new WebSocket(relayUrl)
  await waitOpen(client)
  client.send(JSON.stringify({ type: 'join', role: 'client', code }))
  const pairedC = onceMessage(client, (m) => m.type === 'paired' || m.type === 'error')
  const pairedH = onceMessage(host, (m) => m.type === 'paired' || m.type === 'error')
  const [a, b] = await Promise.all([pairedC, pairedH])
  if (a.type === 'error') throw new Error('client: ' + a.error)
  if (b.type === 'error') throw new Error('host: ' + b.error)
  console.log('[e2e] paired both sides')

  // Mux a test frame
  const got = onceMessage(host, (m) => m.type === 'tunnel-test')
  client.send(JSON.stringify({ type: 'tunnel-test', n: 42 }))
  const frame = await got
  if (frame.n !== 42) throw new Error('mux failed')
  console.log('[e2e] frame mux ok')

  // Second simultaneous client should fail
  const client2 = new WebSocket(relayUrl)
  await waitOpen(client2)
  client2.send(JSON.stringify({ type: 'join', role: 'client', code }))
  const rej = await onceMessage(client2, (m) => m.type === 'error' || m.type === 'paired')
  if (rej.type !== 'error') throw new Error('expected busy-room rejection')
  console.log('[e2e] busy-room rejection ok:', rej.error)

  try { host.close() } catch (_) { /* ignore */ }
  try { client.close() } catch (_) { /* ignore */ }
  try { client2.close() } catch (_) { /* ignore */ }
}

async function runOverlay(relayHttp, relayWs) {
  const host = new WebSocket(relayWs)
  await waitOpen(host)
  host.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch (_) { return }
    if (msg.type === 'http-req') {
      host.send(JSON.stringify({
        type: 'http-res',
        id: msg.id,
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from(`path=${msg.path}`).toString('base64')
      }))
    }
    if (msg.type === 'ws-open') {
      host.send(JSON.stringify({
        type: 'ws-data',
        id: msg.id,
        binary: false,
        data: 'hello-overlay'
      }))
    }
  })
  host.send(JSON.stringify({ type: 'hello', role: 'host' }))
  const reg = await onceMessage(host, (m) => m.type === 'registered' || m.type === 'error')
  if (reg.type === 'error') throw new Error('overlay host: ' + reg.error)
  const code = reg.code
  console.log('[e2e] overlay registered', code)

  const r = await fetch(`${relayHttp}/o/${code}/obs`)
  if (r.status !== 200) throw new Error('overlay http ' + r.status)
  const text = await r.text()
  if (!text.includes('path=/obs')) throw new Error('bad overlay body: ' + text)
  const setCookie = r.headers.getSetCookie?.()?.join('; ') || r.headers.get('set-cookie') || ''
  if (!setCookie.includes('omo_room=')) throw new Error('missing overlay cookie')
  console.log('[e2e] overlay http ok')

  const r2 = await fetch(`${relayHttp}/assets/app.js`, { headers: { cookie: `omo_room=${code}` } })
  const t2 = await r2.text()
  if (r2.status !== 200 || !t2.includes('path=/assets/app.js')) {
    throw new Error('cookie overlay path fail: ' + r2.status + ' ' + t2)
  }
  console.log('[e2e] overlay cookie path ok')

  const wsUrl = relayWs.replace(/\/connector\/?$/, '/ws')
  const ows = new WebSocket(wsUrl, { headers: { cookie: `omo_room=${code}` } })
  await waitOpen(ows)
  const hello = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('overlay ws timeout')), 8000)
    ows.once('message', (raw) => { clearTimeout(t); resolve(String(raw)) })
  })
  if (hello !== 'hello-overlay') throw new Error('overlay ws got: ' + hello)
  console.log('[e2e] overlay ws ok')

  try { ows.close() } catch (_) { /* ignore */ }
  try { host.close() } catch (_) { /* ignore */ }
}

async function main() {
  let child = null
  if (!urlArg) {
    child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: String(PORT),
        OMO_RELAY_PATH: PATH,
        OMO_RELAY_PAIR_ONCE: '1',
        OMO_RELAY_MAX_ROOMS: '50'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('relay start timeout')), 8000)
      child.stdout.on('data', (buf) => {
        const s = String(buf)
        process.stdout.write(s)
        if (s.includes('listening')) {
          clearTimeout(t)
          resolve()
        }
      })
      child.stderr.on('data', (buf) => process.stderr.write(buf))
      child.on('exit', (code) => {
        clearTimeout(t)
        reject(new Error('relay exited early: ' + code))
      })
    })
    await new Promise((r) => setTimeout(r, 200))
  }

  try {
    await runPair(url)
    const httpBase = url.replace(/^ws/, 'http').replace(/\/connector\/?$/, '')
    await runOverlay(httpBase, url)
    console.log('[e2e] PASS')
  } finally {
    if (child) {
      try { child.kill('SIGTERM') } catch (_) { /* ignore */ }
    }
  }
}

main().catch((err) => {
  console.error('[e2e] FAIL', err.message || err)
  process.exit(1)
})
