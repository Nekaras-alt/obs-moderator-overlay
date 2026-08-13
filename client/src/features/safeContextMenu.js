/**
 * Guard helpers for context menus vs drag/select/pan.
 */
import { unref } from 'vue'

export function isPrimaryButton(e) {
  return !e || e.button === 0
}

export function shouldIgnoreContextMenu({ dragging = false, panning = false } = {}) {
  return !!(unref(dragging) || unref(panning))
}

/** Call from @contextmenu — returns true if the handler should abort. */
export function blockContextWhileBusy(e, state) {
  if (shouldIgnoreContextMenu(state)) {
    e?.preventDefault?.()
    return true
  }
  return false
}

/**
 * Composable for Canvas / DnD surfaces.
 * @param {{ dragging?: import('vue').Ref|boolean, panning?: import('vue').Ref|boolean }} state
 */
export function useSafeContextMenu(state = {}) {
  function ignoreOpen() {
    return shouldIgnoreContextMenu(state)
  }
  function onOpenChange(open, setOpen) {
    if (open && ignoreOpen()) {
      setOpen?.(false)
      return false
    }
    setOpen?.(open)
    return open
  }
  function guardEvent(e) {
    return blockContextWhileBusy(e, state)
  }
  return { ignoreOpen, onOpenChange, guardEvent, isPrimaryButton }
}
