// electron/frame-bridge.cjs
// Phase 4: offscreen /obs compositor → localhost TCP frames (BGRA).
// OBS plugin "OMO Overlay (Native)" consumes frames — no obs-browser / CEF in OBS.

const { BrowserWindow } = require('electron')
const net = require('node:net')
const { EventEmitter } = require('node:events')

const MAGIC = 0x4f4d4f46 // 'OMOF'
const FORMAT_BGRA = 1
const HEADER_SIZE = 24

function writeHeader(buf, offset, { width, height, stride, frameId, payloadLen }) {
  buf.writeUInt32BE(MAGIC, offset)
  buf.writeUInt16BE(1, offset + 4) // version
  buf.writeUInt16BE(width, offset + 6)
  buf.writeUInt16BE(height, offset + 8)
  buf.writeUInt16BE(FORMAT_BGRA, offset + 10)
  buf.writeUInt32BE(stride, offset + 12)
  buf.writeUInt32BE(frameId >>> 0, offset + 16)
  buf.writeUInt32BE(payloadLen >>> 0, offset + 20)
}

class FrameBridge extends EventEmitter {
  constructor(opts = {}) {
    super()
    this.port = Number(opts.port) || Number(process.env.OMO_FRAME_PORT) || 8092
    this.width = Number(opts.width) || 1920
    this.height = Number(opts.height) || 1080
    this.fps = Number(opts.fps) || Number(process.env.OMO_FRAME_FPS) || 60
    this.getObsUrl = opts.getObsUrl || (() => null)
    this._win = null
    this._server = null
    this._clients = new Set()
    this._frameId = 0
    this._lastBitmap = null
    this._lastStride = 0
    this._running = false
    this._paintCount = 0
    this._lastPaintAt = 0
    this._lastError = null
    this._fallbackTimer = null
    this._statusTimer = null
  }

  status() {
    return {
      enabled: this._running,
      port: this.port,
      width: this.width,
      height: this.height,
      fps: this.fps,
      frameId: this._frameId,
      clients: this._clients.size,
      paintCount: this._paintCount,
      lastPaintAt: this._lastPaintAt,
      hasFrame: !!this._lastBitmap,
      lastError: this._lastError,
      ageMs: this._lastPaintAt ? Date.now() - this._lastPaintAt : null
    }
  }

  async start() {
    if (this._running) return this.status()
    const url = this.getObsUrl()
    if (!url) throw new Error('No OBS overlay URL (viewer token missing?)')

    this._running = true
    this._lastError = null
    await this._startTcp()
    await this._startOffscreen(url)
    this._fallbackTimer = setInterval(() => { this._captureFallback() }, Math.max(50, Math.floor(1000 / this.fps)))
    this._statusTimer = setInterval(() => this.emit('status', this.status()), 1000)
    console.log(`[frame-bridge] publishing ${this.width}x${this.height}@${this.fps} on 127.0.0.1:${this.port}`)
    this.emit('status', this.status())
    return this.status()
  }

  async stop() {
    this._running = false
    if (this._fallbackTimer) {
      clearInterval(this._fallbackTimer)
      this._fallbackTimer = null
    }
    if (this._statusTimer) {
      clearInterval(this._statusTimer)
      this._statusTimer = null
    }
    if (this._win && !this._win.isDestroyed()) {
      try { this._win.webContents.stop() } catch (_) { /* ignore */ }
      this._win.destroy()
    }
    this._win = null
    for (const c of this._clients) {
      try { c.destroy() } catch (_) { /* ignore */ }
    }
    this._clients.clear()
    if (this._server) {
      await new Promise((resolve) => this._server.close(() => resolve()))
      this._server = null
    }
    this._lastBitmap = null
    this.emit('status', this.status())
  }

  async reload(url) {
    if (!this._win || this._win.isDestroyed()) return
    const target = url || this.getObsUrl()
    if (target) await this._win.loadURL(target)
  }

  _startTcp() {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        socket.setNoDelay(true)
        socket.setKeepAlive(true, 5000)
        this._clients.add(socket)
        console.log(`[frame-bridge] client connected (${this._clients.size})`)
        this.emit('status', this.status())
        if (this._lastBitmap) this._sendFrame(socket, this._lastBitmap, this._lastStride)
        socket.on('close', () => {
          this._clients.delete(socket)
          this.emit('status', this.status())
        })
        socket.on('error', () => {
          this._clients.delete(socket)
          this.emit('status', this.status())
        })
      })
      server.on('error', (err) => {
        this._lastError = err.message
        reject(err)
      })
      server.listen(this.port, '127.0.0.1', () => {
        this._server = server
        resolve()
      })
    })
  }

  async _startOffscreen(url) {
    const win = new BrowserWindow({
      width: this.width,
      height: this.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      paintWhenInitiallyHidden: true,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true
      }
    })
    this._win = win
    win.setBackgroundColor('#00000000')
    win.webContents.setFrameRate(this.fps)
    win.webContents.on('paint', (_event, _dirty, image) => {
      this._ingestImage(image)
    })

    win.webContents.on('did-fail-load', (_e, code, desc) => {
      this._lastError = `load failed ${code}: ${desc}`
      console.warn('[frame-bridge] did-fail-load', code, desc)
      this.emit('status', this.status())
    })
    win.webContents.on('did-finish-load', () => {
      console.log('[frame-bridge] overlay loaded', url)
      try { win.webContents.invalidate() } catch (_) { /* ignore */ }
    })

    await win.loadURL(url)
  }

  _ingestImage(image) {
    if (!this._running || !image) return
    try {
      const size = image.getSize()
      if (!size.width || !size.height) return
      const bitmap = image.toBitmap()
      const stride = size.width * 4
      this._lastBitmap = Buffer.from(bitmap)
      this._lastStride = stride
      this.width = size.width
      this.height = size.height
      this._frameId++
      this._paintCount++
      this._lastPaintAt = Date.now()
      this._lastError = null
      this._broadcast(this._lastBitmap, stride)
    } catch (err) {
      this._lastError = err.message
      console.warn('[frame-bridge] paint error:', err.message)
    }
  }

  async _captureFallback() {
    if (!this._running || !this._win || this._win.isDestroyed()) return
    // If paint events are flowing, skip expensive capturePage
    if (this._lastPaintAt && Date.now() - this._lastPaintAt < Math.max(80, 2000 / this.fps)) return
    try {
      const image = await this._win.webContents.capturePage()
      this._ingestImage(image)
    } catch (err) {
      this._lastError = err.message
    }
  }

  _broadcast(bitmap, stride) {
    if (!this._clients.size) return
    for (const socket of [...this._clients]) {
      this._sendFrame(socket, bitmap, stride)
    }
  }

  _sendFrame(socket, bitmap, stride) {
    if (!socket.writable) return
    // Backpressure: skip if socket buffer is large (>2 frames)
    if (socket.writableLength > bitmap.length * 2) return

    const payloadLen = bitmap.length
    const packet = Buffer.allocUnsafe(HEADER_SIZE + payloadLen)
    writeHeader(packet, 0, {
      width: this.width,
      height: this.height,
      stride,
      frameId: this._frameId,
      payloadLen
    })
    bitmap.copy(packet, HEADER_SIZE)
    try {
      socket.write(packet)
    } catch (_) {
      try { socket.destroy() } catch (_) { /* ignore */ }
      this._clients.delete(socket)
    }
  }
}

let singleton = null

function getFrameBridge() {
  return singleton
}

function createFrameBridge(opts) {
  if (singleton) return singleton
  singleton = new FrameBridge(opts)
  return singleton
}

function resetFrameBridge() {
  singleton = null
}

module.exports = {
  FrameBridge,
  createFrameBridge,
  getFrameBridge,
  resetFrameBridge,
  HEADER_SIZE,
  MAGIC,
  FORMAT_BGRA
}
