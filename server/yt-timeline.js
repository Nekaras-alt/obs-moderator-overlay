// server/yt-timeline.js
// In-memory authoritative YouTube playback timelines (not persisted to scene.json).
// Clients compute expected media time from { playing, mediaTime, wallClock, rate }
// and correct drift. Transport commands update the snapshot; moderatorMaster
// mode also fans out lightweight chase heartbeats from the editor.

function now() {
  return Date.now()
}

function nonce() {
  return now() + '-' + Math.random().toString(36).slice(2, 8)
}

function emptyTimeline(id) {
  return {
    id,
    playing: false,
    mediaTime: 0,
    wallClock: now(),
    rate: 1,
    stop: false,
    // Clients must hard-seek only when forceSeek is true (seek/stop/restart).
    // Play/pause/rate alone must NOT seekTo — that was desyncing OBS vs editor.
    forceSeek: false,
    nonce: nonce()
  }
}

/** Advance mediaTime to "now" while preserving playing/rate (for seek/pause anchors). */
function freezeAtNow(tl) {
  const t = now()
  if (tl.playing) {
    const elapsed = Math.max(0, (t - tl.wallClock) / 1000) * (tl.rate || 1)
    tl.mediaTime = Math.max(0, (tl.mediaTime || 0) + elapsed)
  }
  tl.wallClock = t
  return tl
}

export function createYtTimelineStore() {
  /** @type {Map<string, object>} */
  const map = new Map()

  function get(id) {
    return map.get(id) || null
  }

  function ensure(id) {
    let tl = map.get(id)
    if (!tl) {
      tl = emptyTimeline(id)
      map.set(id, tl)
    }
    return tl
  }

  function snapshotOne(id) {
    const tl = map.get(id)
    return tl ? { ...tl } : null
  }

  function snapshotAll() {
    const out = {}
    for (const [id, tl] of map) out[id] = { ...tl }
    return out
  }

  /**
   * Apply a moderator transport patch.
   * patch: { playing?, seek?, stop?, rate? }
   */
  function applyTransport(id, patch = {}) {
    if (!id) return null
    const tl = ensure(id)
    const wasPlaying = !!tl.playing
    freezeAtNow(tl)

    const hasSeek = typeof patch.seek === 'number' && isFinite(patch.seek)
    let forceSeek = false

    if (patch.stop) {
      tl.playing = false
      tl.mediaTime = 0
      tl.stop = true
      forceSeek = true
    } else {
      tl.stop = false
      if (hasSeek) {
        tl.mediaTime = Math.max(0, patch.seek)
        forceSeek = true
      }
      if (typeof patch.rate === 'number' && isFinite(patch.rate) && patch.rate > 0) {
        tl.rate = patch.rate
      }
      if (patch.playing === true) tl.playing = true
      else if (patch.playing === false) tl.playing = false
      // Anchor BOTH clients to the shared mediaTime on play/pause edges.
      // Play with forceSeek=false left editor+OBS free-running from different
      // preload positions (post-fix log line forceSeek:false) → permanent drift.
      if (tl.playing !== wasPlaying) forceSeek = true
    }

    tl.forceSeek = forceSeek
    tl.wallClock = now()
    tl.nonce = nonce()
    map.set(id, tl)
    return { ...tl }
  }

  /**
   * Chase heartbeat from moderatorMaster mode.
   * patch: { current, playing?, rate? }
   * forceSeek stays false — OBS soft-corrects only.
   */
  function applyChase(id, patch = {}) {
    if (!id) return null
    const tl = ensure(id)
    if (typeof patch.current === 'number' && isFinite(patch.current)) {
      tl.mediaTime = Math.max(0, patch.current)
    }
    if (patch.playing === true) tl.playing = true
    else if (patch.playing === false) tl.playing = false
    if (typeof patch.rate === 'number' && isFinite(patch.rate) && patch.rate > 0) {
      tl.rate = patch.rate
    }
    tl.stop = false
    tl.forceSeek = false
    tl.wallClock = now()
    tl.nonce = nonce()
    map.set(id, tl)
    return { ...tl }
  }

  function remove(id) {
    map.delete(id)
  }

  return { get, ensure, snapshotOne, snapshotAll, applyTransport, applyChase, remove }
}
