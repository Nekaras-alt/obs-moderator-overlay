// client/src/features/ytTimeline.js
// Authoritative YouTube timeline helpers + postMessage apply/correct.
// Used by StageRenderer (editor + OBS) for serverClock / moderatorMaster modes.

import { ytCommand, ytListen } from './youtube.js'

export const YT_SYNC_MODES = Object.freeze(['serverClock', 'moderatorMaster', 'legacy'])
export const YT_CORRECT_THRESHOLD_SEC = 0.75
export const YT_HEARTBEAT_MS = 500
export const YT_CORRECT_INTERVAL_MS = 800

export function normalizeSyncMode(mode) {
  return YT_SYNC_MODES.includes(mode) ? mode : 'serverClock'
}

/**
 * Expected media time from a timeline snapshot.
 * @param {{ playing?: boolean, mediaTime?: number, wallClock?: number, rate?: number, stop?: boolean }} tl
 * @param {number} [nowMs]
 */
export function expectedTime(tl, nowMs = Date.now()) {
  if (!tl) return 0
  if (tl.stop) return 0
  const base = Math.max(0, Number(tl.mediaTime) || 0)
  if (!tl.playing) return base
  const rate = (typeof tl.rate === 'number' && tl.rate > 0) ? tl.rate : 1
  const wall = Number(tl.wallClock) || nowMs
  const elapsed = Math.max(0, (nowMs - wall) / 1000) * rate
  return base + elapsed
}

export function shouldCorrect(actual, expected, threshold = YT_CORRECT_THRESHOLD_SEC) {
  if (actual == null || expected == null) return false
  if (!isFinite(actual) || !isFinite(expected)) return false
  return Math.abs(actual - expected) > threshold
}

/**
 * Apply a timeline snapshot to a ready iframe.
 * Hard seek ONLY when timeline.forceSeek / stop / opts.forceSeek.
 * Play/pause alone must not seekTo (scrub floods desynced OBS).
 * @returns {'applied'|'queued'|'missing'}
 */
export function applyTimeline(iframe, timeline, opts = {}) {
  if (!iframe) return 'missing'
  if (!timeline) return 'missing'
  const ready = opts.ready !== false
  if (!ready) return 'queued'

  if (timeline.stop) {
    ytCommand(iframe, 'pauseVideo')
    ytCommand(iframe, 'seekTo', [0, true])
    return 'applied'
  }

  const forceSeek = opts.forceSeek === true || timeline.forceSeek === true
  if (forceSeek) {
    const t = expectedTime(timeline, opts.now || Date.now())
    ytCommand(iframe, 'seekTo', [Math.max(0, t), true])
  }

  if (typeof timeline.rate === 'number' && timeline.rate > 0) {
    ytCommand(iframe, 'setPlaybackRate', [timeline.rate])
  }

  if (timeline.playing) ytCommand(iframe, 'playVideo')
  else ytCommand(iframe, 'pauseVideo')

  return 'applied'
}

/**
 * Soft seek correction without forcing play/pause (assumes play state already matches).
 */
export function correctToExpected(iframe, timeline, actual, opts = {}) {
  if (!iframe || !timeline) return false
  const expected = expectedTime(timeline, opts.now || Date.now())
  const threshold = opts.threshold != null ? opts.threshold : YT_CORRECT_THRESHOLD_SEC
  if (!shouldCorrect(actual, expected, threshold)) return false
  ytCommand(iframe, 'seekTo', [Math.max(0, expected), true])
  if (timeline.playing) ytCommand(iframe, 'playVideo')
  else ytCommand(iframe, 'pauseVideo')
  return true
}

/** Build embed origin for YouTube IFrame API handshake. */
export function ytEmbedOrigin() {
  try {
    if (typeof location !== 'undefined' && location.origin && location.origin !== 'null') {
      return location.origin
    }
  } catch (_) { /* ignore */ }
  return ''
}

export { ytCommand, ytListen }
