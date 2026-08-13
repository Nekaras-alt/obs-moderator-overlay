// client/src/features/snap.js
// Snapping engine. Given a candidate top-left (x,y) for the layer being moved,
// returns adjusted coordinates + any guide lines to render. Thresholds are in
// stage px. Settings drive which snap modes are active.

import { STAGE } from '@shared/schema.js'

const THRESH = 8 // px snap distance

// Compute the candidate's key edges (left, center-x, right; top, center-y, bottom).
function xPoints(x, w) { return { left: x, cx: x + w / 2, right: x + w } }
function yPoints(y, h) { return { top: y, cy: y + h / 2, bottom: y + h } }

export function snapMove(x, y, w, h, settings, allLayers, selfId, extraRects = []) {
  const guides = []
  let bestDX = null
  let bestDY = null
  let snapX = x
  let snapY = y

  const candX = xPoints(x, w)
  const candY = yPoints(y, h)

  const considerX = (target, mode) => {
    for (const which of ['left', 'cx', 'right']) {
      const val = candX[which]
      const d = val - target
      if (Math.abs(d) <= THRESH && (bestDX === null || Math.abs(d) < Math.abs(bestDX))) {
        bestDX = d
        if (which === 'left') snapX = x - d
        else if (which === 'cx') snapX = x - d
        else snapX = x - d
        guides.push({ id: 'sx-' + mode + '-' + target, type: 'v', style: { left: target + 'px', class: 'v' } })
      }
    }
  }
  const considerY = (target, mode) => {
    for (const which of ['top', 'cy', 'bottom']) {
      const val = candY[which]
      const d = val - target
      if (Math.abs(d) <= THRESH && (bestDY === null || Math.abs(d) < Math.abs(bestDY))) {
        bestDY = d
        snapY = y - d
        guides.push({ id: 'sy-' + mode + '-' + target, type: 'h', style: { top: target + 'px', class: 'h' } })
      }
    }
  }

  if (settings.snapToGrid) {
    const g = settings.gridSize || 40
    const rx = Math.round(x / g) * g
    const ry = Math.round(y / g) * g
    if (Math.abs(rx - x) <= THRESH) { snapX = rx; guides.push({ id: 'grid-x', type: 'v', style: { left: rx + 'px' } }) }
    if (Math.abs(ry - y) <= THRESH) { snapY = ry; guides.push({ id: 'grid-y', type: 'h', style: { top: ry + 'px' } }) }
  }

  if (settings.snapToCenter) {
    considerX(STAGE.W / 2, 'center')
    considerY(STAGE.H / 2, 'center')
  }

  if (settings.snapToEdges) {
    for (const l of allLayers) {
      if (l.id === selfId) continue
      const t = l.transform
      const tx = xPoints(t.x, t.w)
      const ty = yPoints(t.y, t.h)
      considerX(tx.left, 'edge'); considerX(tx.cx, 'edge'); considerX(tx.right, 'edge')
      considerY(ty.top, 'edge'); considerY(ty.cy, 'edge'); considerY(ty.bottom, 'edge')
    }
    considerX(0, 'stage'); considerX(STAGE.W, 'stage')
    considerY(0, 'stage'); considerY(STAGE.H, 'stage')
  }

  // Snap to OBS native source bounds (guides).
  if (settings.showObsBounds && extraRects?.length) {
    for (const r of extraRects) {
      if (!r || r.visible === false) continue
      considerX(r.x, 'obs'); considerX(r.x + r.w / 2, 'obs'); considerX(r.x + r.w, 'obs')
      considerY(r.y, 'obs'); considerY(r.y + r.h / 2, 'obs'); considerY(r.y + r.h, 'obs')
    }
  }

  // Normalize guide styles into the format Canvas expects (.v / .h classes).
  const normalized = guides.map((g, i) => {
    const style = { ...g.style }
    if (g.type === 'v') { style.position = 'absolute'; style.width = '1px'; style.top = '0'; style.bottom = '0' }
    else { style.position = 'absolute'; style.height = '1px'; style.left = '0'; style.right = '0' }
    return { id: g.id + '-' + i, style }
  })

  return { x: snapX, y: snapY, guides: normalized }
}

// Distance display: returns text labels describing gaps between `box` and each
// neighboring layer. Emits both horizontal gaps (when the two boxes overlap
// vertically) and vertical gaps (when they overlap horizontally), so the moderator
// sees the spacing on both axes. Each label carries its anchor point in stage px
// and an `axis` so the renderer can offset the label cleanly off the gap midpoint.
export function distanceLabels(box, others, selfId) {
  const labels = []
  const MAX = 400 // px — beyond this the label would clutter more than it helps
  for (const o of others) {
    if (o.id === selfId) continue
    const t = o.transform
    // Horizontal gap: boxes overlap on the Y axis. Anchor at the gap midpoint.
    const vOverlap = !(box.y + box.h < t.y || box.y > t.y + t.h)
    if (vOverlap) {
      const gap = box.x >= t.x + t.w ? box.x - (t.x + t.w)
        : t.x >= box.x + box.w ? t.x - (box.x + box.w) : null
      if (gap !== null && gap <= MAX) {
        const x = Math.min(box.x + box.w, t.x + t.w) + gap / 2
        const y = (Math.max(box.y, t.y) + Math.min(box.y + box.h, t.y + t.h)) / 2
        labels.push({ x, y, text: Math.round(gap) + 'px', axis: 'h' })
      }
    }
    // Vertical gap: boxes overlap on the X axis.
    const hOverlap = !(box.x + box.w < t.x || box.x > t.x + t.w)
    if (hOverlap) {
      const gap = box.y >= t.y + t.h ? box.y - (t.y + t.h)
        : t.y >= box.y + box.h ? t.y - (box.y + box.h) : null
      if (gap !== null && gap <= MAX) {
        const x = (Math.max(box.x, t.x) + Math.min(box.x + box.w, t.x + t.w)) / 2
        const y = Math.min(box.y + box.h, t.y + t.h) + gap / 2
        labels.push({ x, y, text: Math.round(gap) + 'px', axis: 'v' })
      }
    }
  }
  return labels
}
