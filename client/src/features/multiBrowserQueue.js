/**
 * Exclusive alert queue for Multi Browser Source.
 *
 * Third-party widgets (DA, Donatex) keep their own WS connections. We cannot
 * delay their internal playback, but we can:
 *  - give the first active source exclusive visibility + audio
 *  - mute/hide others that fire while busy
 *  - when the active source goes idle, unmute the next pending source
 */

export function createMultiQueue(opts = {}) {
  const idleMs = () => Math.max(0, Number(opts.idleMs) || 900)
  const minHoldMs = () => Math.max(0, Number(opts.minHoldMs) || 2500)
  const maxHoldMs = () => Math.max(minHoldMs(), Number(opts.maxHoldMs) || 60000)
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {}

  let active = null
  const pending = []
  let holdUntil = 0
  let idleTimer = null
  let maxTimer = null
  let enabled = opts.enabled !== false

  function emit() {
    onChange({ active, pending: pending.slice(), enabled })
  }

  function clearTimers() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null }
  }

  function setActive(i) {
    active = i
    holdUntil = Date.now() + minHoldMs()
    clearTimers()
    maxTimer = setTimeout(() => release('max'), maxHoldMs())
    emit()
  }

  function scheduleIdleRelease() {
    if (idleTimer) clearTimeout(idleTimer)
    const wait = Math.max(0, holdUntil - Date.now()) + idleMs()
    idleTimer = setTimeout(() => release('idle'), wait)
  }

  function release(_reason) {
    clearTimers()
    const next = pending.shift()
    if (next !== undefined && next !== null) {
      setActive(next)
      return
    }
    active = null
    emit()
  }

  return {
    getActive: () => active,
    getPending: () => pending.slice(),
    setEnabled(v) {
      enabled = !!v
      if (!enabled) {
        clearTimers()
        pending.length = 0
        active = null
      }
      emit()
    },
    updateTiming(next = {}) {
      if (next.idleMs != null) opts.idleMs = next.idleMs
      if (next.minHoldMs != null) opts.minHoldMs = next.minHoldMs
      if (next.maxHoldMs != null) opts.maxHoldMs = next.maxHoldMs
    },
    onActivity(i) {
      if (!enabled) return { action: 'pass' }
      const idx = Number(i)
      if (!Number.isFinite(idx) || idx < 0) return { action: 'pass' }

      if (active === null) {
        setActive(idx)
        return { action: 'claim' }
      }
      if (active === idx) {
        holdUntil = Math.max(holdUntil, Date.now() + Math.floor(minHoldMs() * 0.35))
        if (idleTimer) scheduleIdleRelease()
        return { action: 'hold' }
      }
      if (!pending.includes(idx)) pending.push(idx)
      emit()
      return { action: 'queue' }
    },
    onIdle(i) {
      if (!enabled) return
      if (active !== Number(i)) return
      scheduleIdleRelease()
    },
    reset() {
      clearTimers()
      pending.length = 0
      active = null
      emit()
    },
    destroy() {
      clearTimers()
      pending.length = 0
      active = null
    }
  }
}
