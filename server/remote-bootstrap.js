// Minimal bootstrap for Electron --mode=remote: join UI + connector client APIs.
// After pairing, the local proxy (ClientRelaySession) serves the host's editor.
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connector, mountConnectorRoutes } from './connector/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.OMO_REMOTE_BOOTSTRAP_PORT) || 18091

const app = express()
app.use(express.json({ limit: '1mb' }))

function requireModerator(_req, res) {
  // Remote bootstrap has no local PIN authority — allow connector ops.
  return true
}

mountConnectorRoutes(app, requireModerator)

app.get('/api/hello', (_req, res) => {
  res.json({
    ok: true,
    mode: 'remote-bootstrap',
    requiresPin: false,
    version: '1.0.0',
    needsSetup: false
  })
})

app.get('/api/connector/status', (_req, res) => {
  res.json({ ok: true, ...connector.status() })
})

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OMO Remote — Join</title>
<style>
  :root { color-scheme: dark; --bg:#1b1c1f; --card:#2b2d31; --text:#e9eaed; --dim:#9aa0a6; --accent:#0078d4; --danger:#f85149; }
  *{box-sizing:border-box} body{margin:0;font:15px/1.45 "Segoe UI",system-ui,sans-serif;background:radial-gradient(900px 500px at 10% -10%,rgba(0,120,212,.25),transparent 55%),var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{width:min(420px,92vw);background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
  h1{margin:0 0 6px;font-size:1.35rem} p{margin:0 0 16px;color:var(--dim);font-size:.9rem}
  label{display:block;font-size:.8rem;color:var(--dim);margin-bottom:6px}
  input{width:100%;padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#1b1c1f;color:var(--text);font-size:1.25rem;letter-spacing:.2em;text-align:center;text-transform:uppercase}
  button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
  button:disabled{opacity:.55;cursor:wait} .err{color:var(--danger);margin-top:10px;font-size:.85rem;min-height:1.2em}
  .hint{margin-top:14px;font-size:.75rem;color:var(--dim)}
  .status{font-size:.8rem;color:var(--dim);margin-top:8px;min-height:1.2em}
</style></head><body>
<div class="card">
  <h1>Remote moderator</h1>
  <p>Enter the join code from the streamer’s <strong>Settings → Connector</strong>, then the host PIN on the next screen.</p>
  <label for="code">Join code</label>
  <input id="code" maxlength="8" autocomplete="off" autofocus placeholder="AB12CD"/>
  <button id="go" type="button">Connect via relay</button>
  <div class="status" id="status"></div>
  <div class="err" id="err"></div>
  <p class="hint">Outbound WSS only — no Tailscale/ngrok required. Use the same relay URLs as the host.</p>
</div>
<script>
const err = document.getElementById('err')
const statusEl = document.getElementById('status')
const go = document.getElementById('go')
const code = document.getElementById('code')
function friendly(msg) {
  const m = String(msg || '')
  if (/No relay|not configured|OMO_RELAY/i.test(m)) return 'No relay URLs on this remote build — set the same relays as the host.'
  if (/unreachable|All relays|failed on/i.test(m)) return 'Relay unreachable. Check network and that the host started relay.'
  if (/Invalid or expired/i.test(m)) return 'Invalid or expired join code — ask the host to Start relay again.'
  if (/timeout|Paired timeout/i.test(m)) return 'Timed out waiting for pair — host must keep relay running with this code.'
  return m || 'Connection failed'
}
go.onclick = async () => {
  err.textContent = ''
  statusEl.textContent = ''
  const joinCode = code.value.trim()
  if (joinCode.length < 4) { err.textContent = 'Enter a valid join code'; return }
  go.disabled = true
  statusEl.textContent = 'Connecting to relay…'
  try {
    const r = await fetch('/api/connector/client/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ joinCode, localPort: 18090 })
    }).then(x => x.json())
    if (!r.ok) throw new Error(r.error || 'Failed')
    statusEl.textContent = 'Waiting for host pair…'
    for (let i = 0; i < 40; i++) {
      const st = await fetch('/api/connector/status').then(x => x.json())
      if (st.relay?.paired) {
        statusEl.textContent = 'Paired — opening editor…'
        location.href = 'http://127.0.0.1:18090/'
        return
      }
      await new Promise(r => setTimeout(r, 250))
    }
    throw new Error('Paired timeout')
  } catch (e) {
    err.textContent = friendly(e.message || String(e))
    statusEl.textContent = ''
  } finally {
    go.disabled = false
  }
}
code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click() })
</script></body></html>`)
})

connector.setMode('remote')

const server = http.createServer(app)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[remote-bootstrap] http://127.0.0.1:${PORT}/`)
})

export { PORT as remoteBootstrapPort, server as remoteBootstrapServer }
