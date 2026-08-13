// Connector manager: multi-home EU/RU relays, RTT failover, WG/Headscale, API mount.
import fs from 'node:fs'
import path from 'node:path'
import { WebSocket } from 'ws'
import { HostRelaySession } from './host.js'
import { ClientRelaySession } from './client.js'
import {
  loadConnectorConfig,
  saveConnectorConfig,
  parseWireguardEndpoint
} from './config.js'
import { FRAME, encodeFrame, decodeFrame } from './protocol.js'
import { generateJoinCode, overlayHttpUrlFromRelay } from './join-code.js'
import { DATA_DIR, ensureDirs } from '../config/paths.js'
import { collectNetworkInfo } from '../config/network.js'
import { detectTransports, overlayForActive } from './transports.js'

class ConnectorManager {
  constructor() {
    this.mode = 'host'
    this.localPort = Number(process.env.PORT) || 8090
    this.config = loadConnectorConfig()
    /** @type {Map<string, HostRelaySession>} */
    this.hostSessions = new Map()
    this.clientSession = null
    this.activeRelay = null
    this.joinCode = null
    this.profile = 'direct'
    this._listeners = new Set()
    this._probeCache = []
    this._failoverTimer = null
    this._lastFailoverAt = 0
    this._transports = null
    this._transportsAt = 0
    this._transportsP = null
    setTimeout(() => { this.refreshTransports().catch(() => {}) }, 400)
  }

  onStatus(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  _emit() {
    const s = this.status()
    for (const fn of this._listeners) {
      try { fn(s) } catch (_) { /* ignore */ }
    }
  }

  _relaySnapshot() {
    const hosts = [...this.hostSessions.entries()].map(([id, s]) => ({
      id,
      ...s.status()
    }))
    const primary = hosts.find((h) => h.paired) || hosts.find((h) => h.connected) || hosts[0] || null
    const client = this.clientSession?.status() || null
    const joinCode = this.joinCode || primary?.code || client?.code || null
    const relayUrl = primary?.relayUrl || this.activeRelay?.url || null
    return { hosts, primary, client, joinCode, relayUrl }
  }

  async refreshTransports() {
    if (this._transportsP) return this._transportsP
    const now = Date.now()
    if (this._transports && now - this._transportsAt < 4000) return this._transports
    this._transportsP = this._runTransportDetect()
      .catch(() => this._transports || { activeId: null, recommendedId: null, hint: '', items: [] })
      .finally(() => { this._transportsP = null })
    return this._transportsP
  }

  async _runTransportDetect() {
    const snap = this._relaySnapshot()
    const detected = await detectTransports({
      port: this.localPort,
      config: this.config,
      relay: {
        connected: !!(snap.primary?.connected || snap.client?.connected),
        remoteOverlayUrl: overlayHttpUrlFromRelay(snap.relayUrl, snap.joinCode),
        joinCode: snap.joinCode,
        relayUrl: snap.relayUrl
      }
    })
    this._transports = detected
    this._transportsAt = Date.now()
    return detected
  }

  status() {
    const { hosts, primary, client, joinCode, relayUrl } = this._relaySnapshot()
    const net = collectNetworkInfo(this.localPort)
    const meshHint = this.config.headscaleUrl
      ? { headscaleUrl: this.config.headscaleUrl, note: 'Use Headscale ACL TCP 8090; see docs/HEADSCALE.md' }
      : null

    const transports = this._transports || { activeId: null, recommendedId: null, hint: '', items: [] }
    const remoteOverlayUrl = overlayHttpUrlFromRelay(relayUrl, joinCode)
    const overlay = overlayForActive(transports, remoteOverlayUrl)
    const profile = transports.activeId || this.profile

    return {
      mode: this.mode,
      profile,
      sessionProfile: this.profile,
      preferredProfile: this.config.preferredProfile,
      preferredRegion: this.config.preferredRegion,
      multiHome: !!this.config.multiHome,
      failover: !!this.config.failover,
      localPort: this.localPort,
      bindHostOnly: !!this.config.bindHostOnly,
      harden: !!this.config.harden,
      direct: {
        preferredHost: net.preferredHost,
        isTailscale: net.isTailscale,
        tailscaleIp: net.tailscaleIp,
        lanIp: net.lanIp,
        port: net.port,
        editorUrl: `http://${net.preferredHost}:${net.port}/`,
        mesh: meshHint
      },
      relay: {
        active: this.activeRelay,
        endpoints: this.config.relays,
        hosts,
        host: primary,
        client,
        joinCode,
        remoteOverlayUrl,
        paired: !!(primary?.paired || client?.paired),
        rttMs: primary?.rttMs ?? client?.rttMs ?? null,
        probes: this._probeCache
      },
      wireguard: this._wireguardStatus(),
      headscaleUrl: this.config.headscaleUrl || '',
      cloudflareHostname: this.config.cloudflareHostname || '',
      transports,
      overlay
    }
  }

  _wireguardStatus() {
    const wg = this.config.wireguard
    if (!wg) return { configured: false }
    const confPath = wg.confPath || ''
    let confPreview = ''
    try {
      if (confPath && fs.existsSync(confPath)) {
        confPreview = fs.readFileSync(confPath, 'utf8').slice(0, 200)
      }
    } catch (_) { /* ignore */ }
    return {
      configured: true,
      confPath,
      exists: confPath ? fs.existsSync(confPath) : false,
      endpointHint: wg.endpointHint || '',
      interfaceHint: wg.interfaceHint || 'omo0',
      hasConf: !!confPreview
    }
  }

  setMode(mode) {
    this.mode = mode === 'remote' ? 'remote' : (mode === 'host-obs' ? 'host-obs' : 'host')
  }

  setLocalPort(port) {
    this.localPort = Number(port) || 8090
  }

  reloadConfig() {
    this.config = loadConnectorConfig()
    return this.config
  }

  updateConfig(partial) {
    this.config = saveConnectorConfig(partial)
    this._emit()
    return this.config
  }

  /** Sort probes: ok first, preferred region bias, then RTT. */
  _rankProbes(probes) {
    const prefer = String(this.config.preferredRegion || 'auto').toLowerCase()
    return [...probes].sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1
      if (prefer === 'eu' || prefer === 'ru') {
        const aP = a.region === prefer ? 0 : 1
        const bP = b.region === prefer ? 0 : 1
        if (aP !== bP) return aP - bP
      }
      return (a.rttMs ?? 1e9) - (b.rttMs ?? 1e9)
    })
  }

  async probeRelays(timeoutMs = 4000) {
    const results = []
    await Promise.all(
      (this.config.relays || []).map(async (ep) => {
        const started = Date.now()
        const rtt = await this._pingRelay(ep.url, timeoutMs)
        results.push({
          id: ep.id,
          url: ep.url,
          region: ep.region,
          ok: rtt != null,
          rttMs: rtt,
          probedAt: Date.now(),
          elapsedMs: Date.now() - started
        })
      })
    )
    this._probeCache = this._rankProbes(results)
    return this._probeCache
  }

  _pingRelay(url, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false
      let ws
      const done = (v) => {
        if (settled) return
        settled = true
        try { ws?.close() } catch (_) { /* ignore */ }
        resolve(v)
      }
      const t = setTimeout(() => done(null), timeoutMs)
      try {
        // Invalid placeholder hosts fail fast
        if (!url || url.includes('example.invalid') || url.includes('example.com')) {
          clearTimeout(t)
          return done(null)
        }
        ws = new WebSocket(url)
        const t0 = Date.now()
        ws.on('open', () => {
          ws.send(encodeFrame({ type: FRAME.PING, t: t0, probe: true }))
        })
        ws.on('message', (raw) => {
          const msg = decodeFrame(raw)
          if (msg?.type === FRAME.PONG) {
            clearTimeout(t)
            done(Math.max(0, Date.now() - (msg.t || t0)))
          }
        })
        ws.on('error', () => {
          clearTimeout(t)
          done(null)
        })
        ws.on('close', () => {
          clearTimeout(t)
          if (!settled) done(null)
        })
      } catch (_) {
        clearTimeout(t)
        done(null)
      }
    })
  }

  _startFailoverWatch() {
    if (this._failoverTimer) clearInterval(this._failoverTimer)
    if (!this.config.failover) return
    this._failoverTimer = setInterval(() => {
      if (this.profile !== 'relay') return
      // Re-probe occasionally; reconnect dead host sessions (they self-reconnect).
      // Promote activeRelay to healthiest connected host.
      const alive = [...this.hostSessions.entries()].filter(([, s]) => s.alive)
      if (!alive.length) return
      const ranked = this._rankProbes(
        alive.map(([id, s]) => ({
          id,
          url: s.relayUrl,
          region: this.config.relays.find((r) => r.id === id)?.region,
          ok: true,
          rttMs: s._rttMs ?? 9999
        }))
      )
      const best = ranked[0]
      if (best && this.activeRelay?.id !== best.id) {
        const now = Date.now()
        if (now - this._lastFailoverAt > 8000) {
          this._lastFailoverAt = now
          this.activeRelay = {
            id: best.id,
            url: best.url,
            region: best.region
          }
          console.log(`[connector] failover promote relay=${best.id} rtt=${best.rttMs}`)
          this._emit()
        }
      }
    }, 10000)
  }

  async startHostRelay(opts = {}) {
    await this.stopSessions()
    this.profile = 'relay'
    this.config = loadConnectorConfig()

    const configured = (this.config.relays || []).filter((r) => r?.url && !String(r.url).includes('example.invalid') && !String(r.url).includes('example.com'))
    if (!configured.length) {
      throw new Error(
        'No relay URLs configured. Add wss://…/connector in Settings → Connector (or OMO_RELAY_URLS). See docs/CONNECTOR.md — Personal deploy.'
      )
    }
    const probes = opts.skipProbe ? configured.map((r) => ({ ...r, ok: true, rttMs: 0 })) : await this.probeRelays()
    const okList = this._rankProbes(probes).filter((p) => p.ok && p.url && !String(p.url).includes('example.invalid') && !String(p.url).includes('example.com'))
    if (!okList.length) {
      throw new Error(
        'Relay unreachable. Check TLS/DNS, firewall, and Probe relays. Host and mod must both reach the same VPS (docs/CONNECTOR.md).'
      )
    }

    this.joinCode = opts.joinCode || generateJoinCode(6)
    const targets = this.config.multiHome ? okList : [okList[0]]

    for (const ep of targets) {
      const session = new HostRelaySession({
        localPort: this.localPort,
        relayUrl: ep.url,
        preferredCode: this.joinCode,
        onStatus: () => this._emit(),
        onDisconnect: () => this._emit()
      })
      this.hostSessions.set(ep.id, session)
      session.start()
    }

    this.activeRelay = {
      id: targets[0].id,
      url: targets[0].url,
      region: targets[0].region
    }
    this._startFailoverWatch()
    this._emit()

    // Wait briefly for registration on primary
    await new Promise((r) => setTimeout(r, 600))
    return this.status()
  }

  async startClientRelay({ joinCode, localPort } = {}) {
    if (!joinCode) throw new Error('joinCode required')
    await this.stopSessions()
    this.profile = 'relay'
    this.joinCode = joinCode
    this.config = loadConnectorConfig()

    const configured = (this.config.relays || []).filter((r) => r?.url && !String(r.url).includes('example.invalid') && !String(r.url).includes('example.com'))
    if (!configured.length) {
      throw new Error(
        'No relay URLs configured on this remote build. Set the same OMO_RELAY_URLS / Settings relays as the host.'
      )
    }
    const probes = await this.probeRelays()
    const list = this._rankProbes(probes).filter((p) => p.ok)
    const endpoints = list.length ? list : configured
    if (!endpoints.length) {
      throw new Error('All relays unreachable — check join code and that the host relay is running.')
    }

    const port = localPort || Number(process.env.OMO_REMOTE_PORT) || 18090
    let lastErr = null

    for (const ep of endpoints) {
      try {
        this.activeRelay = { id: ep.id, url: ep.url, region: ep.region }
        this.clientSession = new ClientRelaySession({
          relayUrl: ep.url,
          joinCode,
          localPort: port,
          onStatus: () => this._emit()
        })
        await this.clientSession.start()
        await this.clientSession.waitUntilPaired(10000)
        this._emit()
        console.log(`[connector] client paired via ${ep.id} (${ep.region})`)
        return this.status()
      } catch (err) {
        lastErr = err
        console.warn(`[connector] client join failed on ${ep.id}:`, err.message)
        try { this.clientSession?.stop() } catch (_) { /* ignore */ }
        this.clientSession = null
      }
    }
    throw lastErr || new Error('All relays failed')
  }

  async stopSessions() {
    if (this._failoverTimer) {
      clearInterval(this._failoverTimer)
      this._failoverTimer = null
    }
    for (const [, s] of this.hostSessions) {
      try { s.stop() } catch (_) { /* ignore */ }
    }
    this.hostSessions.clear()
    if (this.clientSession) {
      try { this.clientSession.stop() } catch (_) { /* ignore */ }
      this.clientSession = null
    }
    this.activeRelay = null
    this.joinCode = null
    this._emit()
  }

  useDirectProfile() {
    this.profile = 'direct'
    this._emit()
    return this.status()
  }

  useWireguardProfile() {
    this.profile = 'wireguard'
    this._emit()
    return this.status()
  }

  /**
   * preferredProfile=relay → always start WSS relay.
   * preferredProfile=direct / wireguard → that profile.
   * preferredProfile=auto (and meshFirst) → live mesh rank, then own relay if it is the only path.
   */
  async applyAutoProfile(opts = {}) {
    this.config = loadConnectorConfig()
    const prefer = String(this.config.preferredProfile || 'relay').toLowerCase()
    const meshFirst = opts.meshFirst === true || prefer === 'auto'
    const hasRelays = (this.config.relays || []).some(
      (r) => r?.url && !String(r.url).includes('example.invalid') && !String(r.url).includes('example.com')
    )

    if (!meshFirst && prefer === 'direct') {
      this.useDirectProfile()
      return { ...this.status(), autoChose: 'direct' }
    }
    if (!meshFirst && prefer === 'wireguard') {
      this.useWireguardProfile()
      return { ...this.status(), autoChose: 'wireguard' }
    }
    if (!meshFirst && prefer === 'relay') {
      await this.startHostRelay()
      await this.refreshTransports()
      return { ...this.status(), autoChose: 'relay' }
    }

    const t = await this.refreshTransports()
    const meshLive = t.activeId && t.activeId !== 'relay'
    if (meshLive) {
      this.profile = t.activeId
      this._emit()
      return { ...this.status(), autoChose: t.activeId }
    }
    if (hasRelays) {
      try {
        await this.startHostRelay()
        await this.refreshTransports()
        return { ...this.status(), autoChose: 'relay' }
      } catch (err) {
        if (t.recommendedId && t.recommendedId !== 'relay') {
          this.profile = t.recommendedId
          this._emit()
          return { ...this.status(), autoChose: t.recommendedId, relayError: err.message }
        }
        throw err
      }
    }
    if (t.recommendedId) {
      this.profile = t.recommendedId === 'wireguard' ? 'wireguard' : (t.recommendedId === 'relay' ? 'direct' : t.recommendedId)
      this._emit()
      return { ...this.status(), autoChose: t.recommendedId }
    }
    throw new Error(
      'No live mesh and no relay URLs. Install a mesh client or add wss://…/connector in Settings → Connector (docs/CONNECTOR.md).'
    )
  }

  saveWireguardProfile(confText, meta = {}) {
    ensureDirs()
    const dir = path.join(DATA_DIR, 'wireguard')
    fs.mkdirSync(dir, { recursive: true })
    const confPath = path.join(dir, 'omo.conf')
    const conf = String(confText || '')
    fs.writeFileSync(confPath, conf, { mode: 0o600 })
    const endpoint = meta.endpointHint || parseWireguardEndpoint(conf)
    this.config = saveConnectorConfig({
      wireguard: {
        confPath,
        endpointHint: endpoint,
        interfaceHint: meta.interfaceHint || 'omo0'
      }
    })
    this._emit()
    return this._wireguardStatus()
  }

  readWireguardConf() {
    const wg = this._wireguardStatus()
    if (!wg.exists || !wg.confPath) return { ok: false, error: 'No WireGuard profile saved' }
    return { ok: true, conf: fs.readFileSync(wg.confPath, 'utf8'), ...wg }
  }

  exportWireguardPath() {
    return this._wireguardStatus()
  }
}

export const connector = new ConnectorManager()

export function mountConnectorRoutes(app, requireModerator) {
  function isLoopback(req) {
    const ip = String(req.socket?.remoteAddress || '')
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  }

  function requireModOrLocal(req, res) {
    if (isLoopback(req)) return true
    return requireModerator(req, res)
  }

  app.get('/api/connector/status', async (_req, res) => {
    try {
      await connector.refreshTransports()
    } catch (_) { /* keep last cache */ }
    res.json({ ok: true, ...connector.status(), probes: connector._probeCache })
  })

  app.get('/api/connector/config', (req, res) => {
    if (!requireModOrLocal(req, res)) return
    res.json({ ok: true, config: connector.reloadConfig() })
  })

  app.post('/api/connector/config', (req, res) => {
    if (!requireModOrLocal(req, res)) return
    const body = req.body || {}
    // Sanitize relay URL list
    if (Array.isArray(body.relays)) {
      body.relays = body.relays
        .filter((r) => r && r.url)
        .map((r, i) => ({
          id: String(r.id || `r${i}`),
          url: String(r.url).trim(),
          region: String(r.region || (i === 0 ? 'eu' : 'ru')).toLowerCase()
        }))
    }
    if (body.cloudflareHostname != null) {
      body.cloudflareHostname = String(body.cloudflareHostname).trim()
    }
    const cfg = connector.updateConfig(body)
    res.json({ ok: true, config: cfg })
  })

  app.post('/api/connector/probe', async (req, res) => {
    try {
      const probes = await connector.probeRelays()
      res.json({ ok: true, probes, preferredRegion: connector.config.preferredRegion })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  app.post('/api/connector/host/start', async (req, res) => {
    if (!requireModOrLocal(req, res)) return
    try {
      const status = await connector.startHostRelay(req.body || {})
      res.json({ ok: true, ...status })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  app.post('/api/connector/host/auto', async (req, res) => {
    if (!requireModOrLocal(req, res)) return
    try {
      const status = await connector.applyAutoProfile({ meshFirst: true })
      res.json({ ok: true, ...status })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  app.post('/api/connector/host/stop', async (req, res) => {
    if (!requireModOrLocal(req, res)) return
    await connector.stopSessions()
    connector.useDirectProfile()
    res.json({ ok: true, ...connector.status() })
  })

  app.post('/api/connector/client/start', async (req, res) => {
    try {
      const { joinCode, localPort } = req.body || {}
      const status = await connector.startClientRelay({ joinCode, localPort })
      res.json({ ok: true, ...status })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  app.post('/api/connector/client/stop', async (req, res) => {
    await connector.stopSessions()
    res.json({ ok: true, ...connector.status() })
  })

  app.post('/api/connector/profile', (req, res) => {
    if (!requireModOrLocal(req, res)) return
    const p = String(req.body?.profile || 'direct')
    if (p === 'wireguard') connector.useWireguardProfile()
    else if (p === 'relay') { connector.profile = 'relay'; connector._emit() }
    else connector.useDirectProfile()
    res.json({ ok: true, ...connector.status() })
  })

  app.post('/api/connector/wireguard', (req, res) => {
    if (!requireModOrLocal(req, res)) return
    try {
      const { conf, endpointHint, interfaceHint } = req.body || {}
      if (!conf) return res.status(400).json({ ok: false, error: 'conf required' })
      const wg = connector.saveWireguardProfile(conf, { endpointHint, interfaceHint })
      res.json({ ok: true, wireguard: wg })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  app.get('/api/connector/wireguard', (req, res) => {
    if (!requireModOrLocal(req, res)) return
    res.json({ ok: true, wireguard: connector.exportWireguardPath() })
  })

  app.get('/api/connector/wireguard/export', (req, res) => {
    if (!requireModOrLocal(req, res)) return
    const out = connector.readWireguardConf()
    if (!out.ok) return res.status(404).json(out)
    res.type('text/plain').send(out.conf)
  })
}
