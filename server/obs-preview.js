/**
 * OBS preview stream for moderators.
 *
 * MVP: MJPEG built from GetSourceScreenshot, only while subscribers > 0.
 * Stage 4: optional WHEP URL (MediaMTX) advertised via status — browser plays
 * WebRTC when configured; MJPEG remains the fallback.
 *
 * Env:
 *   OBS_PREVIEW_WHEP_URL  — e.g. http://127.0.0.1:8889/obs-preview/whep
 *   OBS_PREVIEW_FPS       — default 4
 *   OBS_PREVIEW_WIDTH     — default 960
 */

import { bridge } from './obs-bridge.js'

const FPS = Math.max(1, Math.min(10, Number(process.env.OBS_PREVIEW_FPS) || 4))
const WIDTH = Math.max(320, Math.min(1280, Number(process.env.OBS_PREVIEW_WIDTH) || 960))
const QUALITY = Math.max(20, Math.min(80, Number(process.env.OBS_PREVIEW_QUALITY) || 40))
const WHEP_URL = String(process.env.OBS_PREVIEW_WHEP_URL || '').trim()

class ObsPreview {
  constructor() {
    this.subscribers = 0
    this.timer = null
    this.lastJpeg = null
    this.lastError = ''
    this.clients = new Set()
    this.busy = false
  }

  status() {
    return {
      mode: WHEP_URL ? 'whep' : (this.subscribers > 0 ? 'mjpeg' : null),
      whepUrl: WHEP_URL || null,
      mjpegPath: '/api/obs/preview.mjpeg',
      fps: FPS,
      width: WIDTH,
      subscribers: this.subscribers,
      connected: !!bridge.connected,
      lastError: this.lastError || null
    }
  }

  addSubscriber() {
    this.subscribers++
    this._ensureLoop()
  }

  removeSubscriber() {
    this.subscribers = Math.max(0, this.subscribers - 1)
    if (this.subscribers === 0) this._stopLoop()
  }

  _ensureLoop() {
    if (this.timer || this.subscribers <= 0) return
    const interval = Math.round(1000 / FPS)
    this.timer = setInterval(() => this._tick(), interval)
    this._tick()
  }

  _stopLoop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async _tick() {
    if (this.busy || this.subscribers <= 0) return
    if (!bridge.connected) {
      this.lastError = 'OBS not connected'
      return
    }
    this.busy = true
    try {
      const shot = await bridge.getScreenshot({ width: WIDTH, quality: QUALITY })
      if (!shot.ok) {
        this.lastError = shot.error || 'screenshot failed'
        return
      }
      this.lastError = ''
      this.lastJpeg = Buffer.from(shot.base64, 'base64')
      this._pushFrame(this.lastJpeg)
    } catch (e) {
      this.lastError = e.message || String(e)
    } finally {
      this.busy = false
    }
  }

  _pushFrame(buf) {
    const boundary = Buffer.from(
      `\r\n--omoframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`
    )
    for (const res of this.clients) {
      try {
        res.write(boundary)
        res.write(buf)
      } catch (_) {
        this.clients.delete(res)
        this.removeSubscriber()
      }
    }
  }

  mountRoutes(app, requireModerator) {
    app.get('/api/obs/preview-status', (req, res) => {
      if (!requireModerator(req, res)) return
      res.json(this.status())
    })

    app.get('/api/obs/preview.mjpeg', (req, res) => {
      if (!requireModerator(req, res)) return
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=omoframe',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'close',
        Pragma: 'no-cache'
      })
      this.clients.add(res)
      this.addSubscriber()
      if (this.lastJpeg) {
        try {
          const buf = this.lastJpeg
          res.write(`\r\n--omoframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`)
          res.write(buf)
        } catch (_) { /* ignore */ }
      }
      const cleanup = () => {
        if (this.clients.has(res)) {
          this.clients.delete(res)
          this.removeSubscriber()
        }
        try { res.end() } catch (_) { /* ignore */ }
      }
      req.on('close', cleanup)
      req.on('error', cleanup)
    })

    /** Single JPEG snapshot (debug / fallback img refresh). */
    app.get('/api/obs/preview.jpg', async (req, res) => {
      if (!requireModerator(req, res)) return
      const shot = await bridge.getScreenshot({ width: WIDTH, quality: QUALITY })
      if (!shot.ok) return res.status(503).json({ error: shot.error })
      const buf = Buffer.from(shot.base64, 'base64')
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'no-store')
      res.send(buf)
    })
  }
}

export const obsPreview = new ObsPreview()
