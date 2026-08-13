// client/src/features/transforms.js
// Pure helpers for layer geometry. All operate on a layer's transform in
// logical 1920x1080 stage pixels. The UI calls these and sends the result
// via store.updateLayer(); none of them touch the store directly.

import { STAGE } from '@shared/schema.js'

const cx = STAGE.W / 2
const cy = STAGE.H / 2

// Snap a layer's top-left so its CENTER lands on stage center.
export function centerOnStage(t) {
  return { ...t, x: Math.round(cx - t.w / 2), y: Math.round(cy - t.h / 2) }
}

// Horizontal alignment relative to the stage.
export function alignH(t, where) {
  // where: 'left' | 'center' | 'right'
  if (where === 'left') return { ...t, x: 0 }
  if (where === 'right') return { ...t, x: STAGE.W - t.w }
  return { ...t, x: Math.round(cx - t.w / 2) } // center
}
export function alignV(t, where) {
  // where: 'top' | 'center' | 'bottom'
  if (where === 'top') return { ...t, y: 0 }
  if (where === 'bottom') return { ...t, y: STAGE.H - t.h }
  return { ...t, y: Math.round(cy - t.h / 2) }
}

// Stick to a corner: place the layer flush in that corner.
export function stickCorner(t, corner) {
  const corners = {
    tl: { x: 0, y: 0 },
    tr: { x: STAGE.W - t.w, y: 0 },
    bl: { x: 0, y: STAGE.H - t.h },
    br: { x: STAGE.W - t.w, y: STAGE.H - t.h }
  }
  return { ...t, ...corners[corner] }
}

// Flip horizontal / vertical (just toggles; renderer applies scaleX/Y).
export function flipH(t) { return { ...t, flipH: !t.flipH } }
export function flipV(t) { return { ...t, flipV: !t.flipV } }

// Scale with locked aspect ratio around the layer's center.
export function scaleAspect(t, factor, minSize = 16) {
  const nw = Math.max(minSize, t.w * factor)
  const nh = Math.max(minSize, t.h * factor)
  // keep center fixed
  return {
    ...t,
    x: Math.round(t.x + (t.w - nw) / 2),
    y: Math.round(t.y + (t.h - nh) / 2),
    w: Math.round(nw),
    h: Math.round(nh)
  }
}

// Resize from a given handle keeping aspect ratio. dx,dy are deltas in stage px.
// anchor is the handle being dragged (nw, ne, sw, se, n, e, s, w).
// Corners: opposite corner fixed. Edges: opposite edge fixed; secondary axis
// recentered so the box stays visually anchored on that edge.
export function resizeAspect(t, anchor, dx, dy) {
  const ratio = (t.w > 0 && t.h > 0) ? t.w / t.h : 1
  let { x, y, w, h } = t

  if (anchor === 'se') {
    w = t.w + dx
    h = w / ratio
  } else if (anchor === 'nw') {
    w = t.w - dx
    h = w / ratio
    x = t.x + (t.w - w)
    y = t.y + (t.h - h)
  } else if (anchor === 'ne') {
    w = t.w + dx
    h = w / ratio
    y = t.y + (t.h - h)
  } else if (anchor === 'sw') {
    w = t.w - dx
    h = w / ratio
    x = t.x + (t.w - w)
  } else if (anchor === 'e') {
    w = t.w + dx
    h = w / ratio
    y = t.y + (t.h - h) / 2
  } else if (anchor === 'w') {
    w = t.w - dx
    h = w / ratio
    x = t.x + (t.w - w)
    y = t.y + (t.h - h) / 2
  } else if (anchor === 's') {
    h = t.h + dy
    w = h * ratio
    x = t.x + (t.w - w) / 2
  } else if (anchor === 'n') {
    h = t.h - dy
    w = h * ratio
    y = t.y + (t.h - h)
    x = t.x + (t.w - w) / 2
  }

  w = Math.max(16, Math.round(w))
  h = Math.max(16, Math.round(h))
  return { ...t, x: Math.round(x), y: Math.round(y), w, h }
}

// Free resize (no aspect lock) from a handle.
export function resizeFree(t, anchor, dx, dy) {
  let { x, y, w, h } = t
  if (anchor.includes('e')) w = t.w + dx
  if (anchor.includes('s')) h = t.h + dy
  if (anchor.includes('w')) { w = t.w - dx; x = t.x + dx }
  if (anchor.includes('n')) { h = t.h - dy; y = t.y + dy }
  w = Math.max(16, Math.round(w))
  h = Math.max(16, Math.round(h))
  return { ...t, x: Math.round(x), y: Math.round(y), w, h }
}

// Align multiple layers to each other (e.g. align selected to a target).
export function alignLayersTo(layers, target, axis, where) {
  // axis: 'h'|'v', where: 'start'|'center'|'end'
  return layers.map((l) => {
    if (axis === 'h') {
      if (where === 'start') return { ...l, transform: { ...l.transform, x: target.x } }
      if (where === 'end') return { ...l, transform: { ...l.transform, x: target.x + target.w - l.transform.w } }
      return { ...l, transform: { ...l.transform, x: target.x + (target.w - l.transform.w) / 2 } }
    } else {
      if (where === 'start') return { ...l, transform: { ...l.transform, y: target.y } }
      if (where === 'end') return { ...l, transform: { ...l.transform, y: target.y + target.h - l.transform.h } }
      return { ...l, transform: { ...l.transform, y: target.y + (target.h - l.transform.h) / 2 } }
    }
  })
}
