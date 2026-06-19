// client/src/features/snap.js
// Snapping engine. Given a candidate top-left (x,y) for the layer being moved,
// returns adjusted coordinates + any guide lines to render. Thresholds are in
// stage px. Settings drive which snap modes are active.

import { STAGE } from '@shared/schema.js'

const THRESH = 8 // px snap distance

// Compute the candidate's key edges (left, center-x, right; top, center-y, bottom).
function xPoints(x, w) { return { left: x, cx: x + w / 2, right: x + w } }
function yPoints(y, h) { return { top: y, cy: y + h / 2, bottom: y + h } }

export function snapMove(x, y, w, h, settings, allLayers, selfId) {
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
        // which edge aligns -> new x
        if (which === 'left') snapX = x - d
        else if (which === 'cx') snapX = x - d
        else snapX = x - d
        guides.push({ id: 'sx-' + mode, type: 'v', style: { left: target + 'px', class: 'v' } })
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
        guides.push({ id: 'sy-' + mode, type: 'h', style: { top: target + 'px', class: 'h' } })
      }
    }
  }

  // 1. Snap to grid
  if (settings.snapToGrid) {
    const g = settings.gridSize || 40
    const rx = Math.round(x / g) * g
    const ry = Math.round(y / g) * g
    if (Math.abs(rx - x) <= THRESH) { snapX = rx; guides.push({ id: 'grid-x', type: 'v', style: { left: rx + 'px' } }) }
    if (Math.abs(ry - y) <= THRESH) { snapY = ry; guides.push({ id: 'grid-y', type: 'h', style: { top: ry + 'px' } }) }
  }

  // 2. Snap to stage center
  if (settings.snapToCenter) {
    considerX(STAGE.W / 2, 'center')
    considerY(STAGE.H / 2, 'center')
  }

  // 3. Snap to other layers' edges/centers
  if (settings.snapToEdges) {
    for (const l of allLayers) {
      if (l.id === selfId) continue
      const t = l.transform
      const tx = xPoints(t.x, t.w)
      const ty = yPoints(t.y, t.h)
      considerX(tx.left, 'edge'); considerX(tx.cx, 'edge'); considerX(tx.right, 'edge')
      considerY(ty.top, 'edge'); considerY(ty.cy, 'edge'); considerY(ty.bottom, 'edge')
    }
    // Also snap to stage edges.
    considerX(0, 'stage'); considerX(STAGE.W, 'stage')
    considerY(0, 'stage'); considerY(STAGE.H, 'stage')
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

// Distance display: returns text labels describing gaps to nearest neighbors.
// (Used by the optional "show distances" overlay — M2 polish.)
export function distanceLabels(box, others, selfId) {
  const labels = []
  for (const o of others) {
    if (o.id === selfId) continue
    const t = o.transform
    // Horizontal gap if vertically overlapping
    const vOverlap = !(box.y + box.h < t.y || box.y > t.y + t.h)
    if (vOverlap) {
      const gap = box.x >= t.x + t.w ? box.x - (t.x + t.w) : (t.x >= box.x + box.w ? t.x - (box.x + box.w) : null)
      if (gap !== null && gap < 200) {
        const midY = Math.max(box.y, t.y) + Math.min(box.y + box.h, t.y + t.h) / 2 - Math.max(box.y, t.y) / 2
        labels.push({ x: Math.min(box.x + box.w, t.x + t.w) + gap / 2, y: Math.max(box.y, t.y), text: Math.round(gap) + 'px' })
      }
    }
  }
  return labels
}
