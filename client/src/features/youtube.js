// client/src/features/youtube.js
// YouTube IFrame embed transport over postMessage. The embed URL carries
// enablejsapi=1, which exposes a JSON command/state channel via window
// .postMessage — no external API script required. We use it to drive
// play/pause/seek from the moderator's media-ctrl commands and to read back
// the current time / player state so the editor transport bar stays accurate.
//
// Crucially this is what lets the editor preview and the OBS stream stay in
// lock-step: both render the same embed, and both receive the same media-ctrl
// command, which we translate here into YouTube postMessage calls.

function post(iframe, obj) {
  if (!iframe || !iframe.contentWindow) return
  try { iframe.contentWindow.postMessage(JSON.stringify(obj), '*') } catch (_) { /* ignore */ }
}

// Command the embedded player.
//   func: 'playVideo' | 'pauseVideo' | 'seekTo' | 'mute' | 'unMute' |
//         'stopVideo' | 'setVolume' | 'loadVideoById'
//   args: array (seekTo wants [seconds, allowSeekAhead])
export function ytCommand(iframe, func, args = []) {
  post(iframe, { event: 'command', func, args })
}

// Subscribe to state/time deliveries from an embed. Call after the iframe loads
// and again whenever its src changes (which reloads the player and drops the
// previous subscription).
export function ytListen(iframe) {
  post(iframe, { event: 'listening' })
}

// Force the embed to buffer the opening segment of the video without actually
// playing it through (or making sound). The player only fetches data once it
// starts, so a bare pauseVideo() on a freshly-loaded embed leaves it
// un-buffered and the first real Play stutters while it catches up. The trick:
// mute + kick playback, then the moment it reaches the playing state (data
// streaming), the caller pauses it. Muting the kick is essential — otherwise
// the brief buffer burst is audible, which reads as "the video just started
// playing" the instant you add it. StageRenderer restores the layer's real
// mute/volume via applyYtSettings once the buffer lands.
export function ytPreload(iframe) {
  if (!iframe) return null
  ytCommand(iframe, 'mute')
  ytCommand(iframe, 'playVideo')
  return 3
}

// Fan-out for inbound YT messages. Each delivery is (sourceWindow, payload).
const cbs = new Set()
let bound = false
function ensure() {
  if (bound) return
  bound = true
  window.addEventListener('message', (ev) => {
    // YouTube messages originate from youtube.com; ignore everything else
    // (other extensions, frames, etc. that may post on the same window).
    if (!String(ev.origin || '').includes('youtube.com')) return
    let d
    try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data } catch (_) { return }
    if (!d || typeof d.event !== 'string') return
    for (const fn of cbs) fn(ev.source, d)
  })
}
export function onYtMessage(fn) {
  ensure()
  cbs.add(fn)
  return () => cbs.delete(fn)
}

// Map a YT playerState code to a playing/ended pair.
//   -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
export function ytStateInfo(code) {
  return { playing: code === 1, ended: code === 0 }
}
