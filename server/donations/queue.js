// Anti-overlap donation alert queue.
import crypto from 'node:crypto'

export function normalizeAlert(partial) {
  return {
    id: partial.id || crypto.randomBytes(8).toString('hex'),
    source: partial.source || 'unknown', // donationalerts | donatex | manual
    user: partial.user || 'Anonymous',
    amount: partial.amount ?? 0,
    currency: partial.currency || '',
    message: partial.message || '',
    mediaUrl: partial.mediaUrl || null,
    durationMs: partial.durationMs || 8000,
    createdAt: partial.createdAt || Date.now(),
    blocked: !!partial.blocked
  }
}

export class AlertQueue {
  constructor({ onPlay, onStop, onQueue, defaultDurationMs = 8000 } = {}) {
    this.pending = []
    this.current = null
    this.paused = false
    this.log = []
    this.defaultDurationMs = defaultDurationMs
    this.onPlay = onPlay
    this.onStop = onStop
    this.onQueue = onQueue
    this._timer = null
  }

  snapshot() {
    return {
      paused: this.paused,
      current: this.current,
      pending: [...this.pending],
      log: this.log.slice(0, 50)
    }
  }

  _emitQueue() {
    if (this.onQueue) this.onQueue(this.snapshot())
  }

  enqueue(raw) {
    const alert = normalizeAlert({
      ...raw,
      durationMs: raw.durationMs || this.defaultDurationMs
    })
    this.log.unshift(alert)
    if (this.log.length > 200) this.log.length = 200
    if (alert.blocked) {
      this._emitQueue()
      return alert
    }
    this.pending.push(alert)
    this._emitQueue()
    this.tryPlay()
    return alert
  }

  tryPlay() {
    if (this.paused || this.current) return
    const next = this.pending.shift()
    if (!next) { this._emitQueue(); return }
    this.current = next
    if (this.onPlay) this.onPlay(next)
    this._emitQueue()
    clearTimeout(this._timer)
    this._timer = setTimeout(() => this.complete(next.id), next.durationMs || this.defaultDurationMs)
  }

  complete(id) {
    if (!this.current || this.current.id !== id) return
    const done = this.current
    this.current = null
    clearTimeout(this._timer)
    this._timer = null
    if (this.onStop) this.onStop(done.id, 'complete')
    this.tryPlay()
  }

  ctrl(action, id) {
    switch (action) {
      case 'pause':
        this.paused = true
        this._emitQueue()
        return { ok: true }
      case 'resume':
        this.paused = false
        this._emitQueue()
        this.tryPlay()
        return { ok: true }
      case 'skip':
      case 'hide': {
        if (this.current && (!id || this.current.id === id)) {
          const cur = this.current
          this.current = null
          clearTimeout(this._timer)
          if (this.onStop) this.onStop(cur.id, action)
          this.tryPlay()
          return { ok: true }
        }
        if (id) {
          this.pending = this.pending.filter((a) => a.id !== id)
          this._emitQueue()
          return { ok: true }
        }
        return { ok: false, error: 'nothing to skip' }
      }
      case 'replay': {
        const src = (this.log.find((a) => a.id === id) || this.current)
        if (!src) return { ok: false, error: 'not found' }
        this.pending.unshift(normalizeAlert({ ...src, id: crypto.randomBytes(8).toString('hex') }))
        this._emitQueue()
        this.tryPlay()
        return { ok: true }
      }
      default:
        return { ok: false, error: 'unknown action' }
    }
  }
}
