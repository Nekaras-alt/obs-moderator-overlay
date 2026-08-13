// DonationAlerts + Donatex ingest + routes + Multi-Alerts page.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, ensureDirs } from '../config/paths.js'
import { AlertQueue, normalizeAlert } from './queue.js'
import {
  daConfigured, daAuthorizeUrl, exchangeDaCode, fetchDaUser,
  DonationAlertsListener
} from './donationalerts.js'
import { DonatexListener, streamerIdFromToken } from './donatex.js'
import { resolveDonatexConfig, DONATEX_DEFAULTS } from './donatex-defaults.js'

const AUTH_FILE = path.join(DATA_DIR, 'donations-auth.json')
const pendingOAuth = new Map()

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'))
  } catch (_) { /* ignore */ }
  return { da: null, donatex: null }
}

function saveAuth(auth) {
  ensureDirs()
  const tmp = AUTH_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(auth, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, AUTH_FILE)
}

function seedDonatexFromEnv(auth) {
  const resolved = resolveDonatexConfig(auth.donatex || {})
  const next = {
    ...resolved,
    streamerId: resolved.streamerId || streamerIdFromToken(resolved.token) || '',
    webhookSecret: resolved.webhookSecret || crypto.randomBytes(12).toString('hex')
  }
  const changed = JSON.stringify(next) !== JSON.stringify(auth.donatex || {})
  auth.donatex = next
  if (changed) saveAuth(auth)
  return auth
}

export function createDonationSystem({ broadcast, getSettings }) {
  let auth = seedDonatexFromEnv(loadAuth())
  let daStatus = { connected: false }
  let donatexStatus = { connected: false }
  const queue = new AlertQueue({
    defaultDurationMs: 8000,
    onPlay: (alert) => broadcast({ type: 'donation-play', alert }),
    onStop: (id, reason) => broadcast({ type: 'donation-stop', id, reason }),
    onQueue: (snap) => broadcast({ type: 'donation-queue', ...snap })
  })

  function blockedWords() {
    return getSettings()?.donations?.blockedWords || []
  }

  function isBlocked(message) {
    const words = blockedWords().map((w) => String(w).toLowerCase()).filter(Boolean)
    if (!words.length) return false
    const msg = String(message || '').toLowerCase()
    return words.some((w) => msg.includes(w))
  }

  function ingest(partial) {
    const settings = getSettings()?.donations || {}
    const blocked = isBlocked(partial.message)
    const alertBase = {
      ...partial,
      blocked: blocked && settings.autoSkipBlocked !== false,
      durationMs: partial.durationMs || settings.defaultDurationMs || 8000
    }
    if (!settings.enabled && partial.source !== 'manual') {
      const alert = normalizeAlert(alertBase)
      queue.log.unshift(alert)
      if (queue.log.length > 200) queue.log.length = 200
      broadcast({ type: 'donation-queue', ...queue.snapshot() })
      return alert
    }
    const alert = queue.enqueue(alertBase)
    if (alert.blocked) queue.ctrl('skip', alert.id)
    return alert
  }

  const daListener = new DonationAlertsListener({
    getTokens: () => auth.da,
    onDonation: (partial) => ingest(partial),
    onStatus: (st) => {
      daStatus = st
      broadcast({ type: 'donation-status', da: st, donatex: donatexStatus })
    },
    onTokensUpdated: (patch) => {
      if (!auth.da) return
      auth.da = {
        ...auth.da,
        accessToken: patch.accessToken,
        refreshToken: patch.refreshToken || auth.da.refreshToken || '',
        expiresIn: patch.expiresIn ?? auth.da.expiresIn,
        savedAt: Date.now()
      }
      saveAuth(auth)
    },
    onAuthInvalid: () => {
      // Keep username for UI, drop dead tokens so we don't spam DA on every restart.
      if (auth.da) {
        const { username, userId } = auth.da
        auth.da = { username, userId, accessToken: '', refreshToken: '', needsReauth: true, savedAt: Date.now() }
        saveAuth(auth)
      }
      daListener.stop()
    }
  })

  const donatexListener = new DonatexListener({
    getConfig: () => resolveDonatexConfig(auth.donatex || {}),
    onDonation: (partial) => ingest(partial),
    onStatus: (st) => {
      donatexStatus = st
      broadcast({ type: 'donation-status', da: daStatus, donatex: st })
    }
  })

  function maybeStartDa() {
    if (auth.da?.accessToken && getSettings()?.donations?.enabled) daListener.start()
    else daListener.stop()
  }

  function maybeStartDonatex() {
    // Always ensure defaults are present.
    auth = seedDonatexFromEnv(auth)
    if (auth.donatex?.token && getSettings()?.donations?.enabled !== false) {
      // Auto-enable donations when Donatex is configured so SignalR starts.
      donatexListener.start()
    } else if (auth.donatex?.token) {
      donatexListener.start()
    } else {
      donatexListener.stop()
    }
  }

  // Auto-start if we already have tokens and donations enabled
  setTimeout(() => { maybeStartDa(); maybeStartDonatex() }, 500)

  function mountRoutes(app, requireModerator) {
    app.get('/api/donations/status', (req, res) => {
      if (!requireModerator(req, res)) return
      res.json({
        ok: true,
        daConfigured: daConfigured(),
        daConnected: !!(auth.da?.accessToken),
        daLive: !!daStatus.connected,
        daUser: daStatus.user || auth.da?.username || null,
        donatexConnected: !!(auth.donatex?.token || auth.donatex?.widgetUrl || auth.donatex?.webhookSecret),
        donatexLive: !!donatexStatus.connected,
        donatex: {
          hasToken: !!auth.donatex?.token,
          hasWidget: !!auth.donatex?.widgetUrl,
          hasAiWidget: !!auth.donatex?.aiWidgetUrl,
          hasWebhookSecret: !!auth.donatex?.webhookSecret,
          streamerId: auth.donatex?.streamerId || null,
          widgetUrl: auth.donatex?.widgetUrl || DONATEX_DEFAULTS.widgetUrl,
          aiWidgetUrl: auth.donatex?.aiWidgetUrl || DONATEX_DEFAULTS.aiWidgetUrl,
          live: donatexStatus
        },
        queue: queue.snapshot()
      })
    })

    app.get('/api/donations/log', (req, res) => {
      if (!requireModerator(req, res)) return
      const limit = Math.min(100, Number(req.query.limit) || 50)
      res.json({ ok: true, log: queue.log.slice(0, limit), ...queue.snapshot() })
    })

    app.post('/api/donations/ctrl', (req, res) => {
      if (!requireModerator(req, res)) return
      const { action, id } = req.body || {}
      res.json(queue.ctrl(action, id))
    })

    // --- DonationAlerts OAuth ---
    app.get('/api/donations/oauth/da/start', (req, res) => {
      if (!requireModerator(req, res)) return
      if (!daConfigured()) {
        return res.status(503).json({
          ok: false,
          error: 'Set DA_CLIENT_ID and DA_CLIENT_SECRET (create app at donationalerts.com/application/clients). Redirect URI: http://localhost:8090/api/donations/oauth/da/callback'
        })
      }
      const state = crypto.randomBytes(12).toString('hex')
      pendingOAuth.set(state, Date.now())
      res.json({ ok: true, url: daAuthorizeUrl(state) })
    })

    app.get('/api/donations/oauth/da/callback', async (req, res) => {
      const { code, state } = req.query
      if (!code || !pendingOAuth.has(String(state))) return res.status(400).send('bad OAuth state')
      pendingOAuth.delete(String(state))
      try {
        const tokens = await exchangeDaCode(code)
        const user = await fetchDaUser(tokens.access_token)
        auth.da = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || '',
          expiresIn: tokens.expires_in,
          userId: user.id,
          username: user.name || user.code,
          savedAt: Date.now()
        }
        saveAuth(auth)
        maybeStartDa()
        res.send('<html><body style="font-family:system-ui;background:#111;color:#eee;padding:40px"><h2>DonationAlerts connected</h2><p>You can close this window.</p><script>setTimeout(()=>window.close(),1200)</script></body></html>')
      } catch (err) {
        res.status(500).send('DA OAuth failed: ' + err.message)
      }
    })

    // Manual access token (fallback without app registration during testing)
    app.post('/api/donations/da/token', async (req, res) => {
      if (!requireModerator(req, res)) return
      const { accessToken, refreshToken } = req.body || {}
      if (!accessToken) return res.status(400).json({ ok: false, error: 'accessToken required' })
      try {
        const user = await fetchDaUser(accessToken)
        auth.da = {
          accessToken,
          refreshToken: refreshToken || '',
          userId: user.id,
          username: user.name || user.code,
          savedAt: Date.now()
        }
        saveAuth(auth)
        maybeStartDa()
        res.json({ ok: true, daConnected: true, username: auth.da.username })
      } catch (err) {
        res.status(401).json({ ok: false, error: err.message })
      }
    })

    app.post('/api/donations/da/reconnect', (req, res) => {
      if (!requireModerator(req, res)) return
      maybeStartDa()
      res.json({ ok: true, daLive: !!daStatus.connected })
    })

    // Donatex config — JWT + SignalR; defaults always present so mods never re-enter.
    app.post('/api/donations/donatex/config', (req, res) => {
      if (!requireModerator(req, res)) return
      const { widgetUrl, aiWidgetUrl, token, webhookSecret, streamerId } = req.body || {}
      const merged = resolveDonatexConfig({
        ...(auth.donatex || {}),
        ...(widgetUrl !== undefined ? { widgetUrl } : {}),
        ...(aiWidgetUrl !== undefined ? { aiWidgetUrl } : {}),
        ...(token ? { token } : {}),
        ...(webhookSecret !== undefined ? { webhookSecret } : {})
      })
      auth.donatex = {
        ...merged,
        streamerId: streamerId || streamerIdFromToken(merged.token) || auth.donatex?.streamerId || '',
        webhookSecret: merged.webhookSecret || crypto.randomBytes(12).toString('hex')
      }
      saveAuth(auth)
      maybeStartDonatex()
      res.json({
        ok: true,
        donatexConnected: true,
        donatexLive: !!donatexStatus.connected,
        webhookUrl: '/api/donations/hooks/donatex',
        webhookSecret: auth.donatex.webhookSecret,
        streamerId: auth.donatex.streamerId,
        widgetUrl: auth.donatex.widgetUrl,
        aiWidgetUrl: auth.donatex.aiWidgetUrl,
        hasToken: !!auth.donatex.token
      })
    })

    app.post('/api/donations/donatex/reconnect', async (req, res) => {
      if (!requireModerator(req, res)) return
      await maybeStartDonatex()
      res.json({ ok: true, donatexLive: !!donatexStatus.connected, live: donatexStatus })
    })

    app.post('/api/donations/hooks/donatex', (req, res) => {
      const body = req.body || {}
      const expected = auth.donatex?.webhookSecret
      const got = req.headers['x-donatex-secret'] || req.headers['x-webhook-secret'] || body.secret
      if (expected && got !== expected) {
        return res.status(403).json({ ok: false, error: 'bad secret' })
      }
      const alert = ingest({
        source: 'donatex',
        user: body.username || body.user || body.name || body.nickname || 'Donor',
        amount: body.amount ?? body.sum ?? body.value ?? 0,
        currency: body.currency || body.currency_type || body.currencyCode || '',
        message: body.message || body.text || body.comment || '',
        mediaUrl: body.mediaUrl || body.media || null,
        durationMs: body.durationMs
      })
      res.json({ ok: true, id: alert.id })
    })

    app.post('/api/donations/hooks/donationalerts', (req, res) => {
      const body = req.body || {}
      const alert = ingest({
        source: 'donationalerts',
        user: body.username || body.user_name || 'Donor',
        amount: body.amount ?? body.amount_formatted ?? 0,
        currency: body.currency || '',
        message: body.message || ''
      })
      res.json({ ok: true, id: alert.id })
    })

    app.delete('/api/donations/auth', (req, res) => {
      if (!requireModerator(req, res)) return
      const which = req.query.which
      if (which === 'da') { auth.da = null; daListener.stop() }
      else if (which === 'donatex') {
        auth.donatex = null
        donatexListener.stop()
        auth = seedDonatexFromEnv(auth) // re-apply server defaults
      }
      else {
        auth.da = null
        auth.donatex = null
        daListener.stop()
        donatexListener.stop()
        auth = seedDonatexFromEnv(auth)
      }
      saveAuth(auth)
      res.json({ ok: true })
    })

    app.post('/api/donations/simulate', (req, res) => {
      if (!requireModerator(req, res)) return
      const alert = ingest({
        source: req.body?.source || 'manual',
        user: req.body?.user || 'TestDonor',
        amount: req.body?.amount ?? 100,
        currency: req.body?.currency || 'RUB',
        message: req.body?.message || 'Test donation',
        durationMs: req.body?.durationMs
      })
      res.json({ ok: true, alert })
    })

    // When settings.donations.enabled flips via scene, clients can hit this.
    app.post('/api/donations/sync-listener', (req, res) => {
      if (!requireModerator(req, res)) return
      maybeStartDa()
      maybeStartDonatex()
      res.json({ ok: true, daLive: !!daStatus.connected, donatexLive: !!donatexStatus.connected })
    })
  }

  function multiAlertsHtml() {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Multi Alerts</title>
<style>
  html,body{margin:0;background:transparent;overflow:hidden;font-family:system-ui,sans-serif}
  #box{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .alert{background:rgba(0,0,0,.78);color:#fff;padding:24px 36px;border-radius:16px;
    text-align:center;max-width:80vw;animation:pop .35s ease;backdrop-filter:blur(6px)}
  .alert .user{font-size:28px;font-weight:700}
  .alert .amount{font-size:22px;color:#7dd3fc;margin-top:6px}
  .alert .msg{font-size:18px;margin-top:12px;opacity:.95}
  .alert .src{font-size:12px;opacity:.6;margin-top:8px;text-transform:uppercase}
  @keyframes pop{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}
</style></head><body>
<div id="box"></div>
<script>
const params=new URLSearchParams(location.search);
const t=params.get('t')||'';
const proto=location.protocol==='https:'?'wss:':'ws:';
let ws;
function connect(){
  ws=new WebSocket(proto+'//'+location.host+'/ws?t='+encodeURIComponent(t));
  ws.onmessage=(ev)=>{
    let msg; try{msg=JSON.parse(ev.data)}catch(e){return}
    if(msg.type==='donation-play') show(msg.alert);
    if(msg.type==='donation-stop') hide();
  };
  ws.onclose=()=>setTimeout(connect,1500);
}
function show(a){
  const el=document.getElementById('box');
  el.innerHTML='<div class="alert"><div class="user">'+esc(a.user)+'</div>'+
    '<div class="amount">'+esc(String(a.amount))+' '+esc(a.currency||'')+'</div>'+
    (a.message?'<div class="msg">'+esc(a.message)+'</div>':'')+
    '<div class="src">'+esc(a.source)+'</div></div>';
}
function hide(){ document.getElementById('box').innerHTML=''; }
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));}
connect();
</script></body></html>`
  }

  return { queue, ingest, mountRoutes, multiAlertsHtml, auth, maybeStartDa, maybeStartDonatex, daListener, donatexListener }
}
