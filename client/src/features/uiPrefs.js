// Local UI chrome preferences (density, layout, accent). Persisted per-browser;
// not part of the synced scene protocol.

import { reactive, watch, computed } from 'vue'

const STORAGE_KEY = 'omo_ui_prefs_v1'

export const ACCENT_PRESETS = [
  { id: 'system', label: 'System blue', color: '#0078d4' },
  { id: 'teal', label: 'Teal', color: '#038387' },
  { id: 'purple', label: 'Purple', color: '#8764b8' },
  { id: 'green', label: 'Green', color: '#107c10' },
  { id: 'orange', label: 'Orange', color: '#ca5010' },
  { id: 'pink', label: 'Pink', color: '#c239b3' }
]

/** Panel ids that can be hidden from nav (defaults: all enabled). */
export const TOGGLEABLE_PANELS = ['spotify', 'jeetbot', 'pastes', 'stream']

const DEFAULTS = {
  density: 'comfortable', // 'comfortable' | 'compact'
  accentId: 'system',
  customAccent: '',
  navCollapsed: false,
  navWidth: null, // px override when expanded; null = breakpoint default
  inspectorWidth: null,
  toolsDock: false, // ultrawide third column for Tools
  pinnedPanels: [], // panel ids that stay open alongside others
  disabledPanels: [], // panel ids hidden from navigation
  tourDone: false
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULTS,
      ...parsed,
      pinnedPanels: Array.isArray(parsed?.pinnedPanels) ? parsed.pinnedPanels : [],
      disabledPanels: Array.isArray(parsed?.disabledPanels) ? parsed.disabledPanels : [],
      tourDone: !!parsed?.tourDone
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      density: state.density,
      accentId: state.accentId,
      customAccent: state.customAccent,
      navCollapsed: !!state.navCollapsed,
      navWidth: state.navWidth,
      inspectorWidth: state.inspectorWidth,
      toolsDock: !!state.toolsDock,
      pinnedPanels: state.pinnedPanels || [],
      disabledPanels: state.disabledPanels || [],
      tourDone: !!state.tourDone
    }))
  } catch { /* ignore quota */ }
}

const state = reactive(load())

watch(state, () => save(state), { deep: true })

export function useUiPrefs() {
  const densityClass = computed(() =>
    state.density === 'compact' ? 'density-compact' : 'density-comfortable'
  )

  const accentColor = computed(() => {
    if (state.accentId === 'custom' && /^#[0-9a-fA-F]{6}$/.test(state.customAccent || '')) {
      return state.customAccent
    }
    const preset = ACCENT_PRESETS.find((p) => p.id === state.accentId)
    return preset?.color || ACCENT_PRESETS[0].color
  })

  function setDensity(v) {
    state.density = v === 'compact' ? 'compact' : 'comfortable'
  }

  function setAccent(id, customHex) {
    if (id === 'custom') {
      state.accentId = 'custom'
      if (customHex) state.customAccent = customHex
    } else {
      state.accentId = id || 'system'
    }
  }

  function setNavCollapsed(v) {
    state.navCollapsed = !!v
  }

  function setToolsDock(v) {
    state.toolsDock = !!v
  }

  function togglePinned(id) {
    const i = state.pinnedPanels.indexOf(id)
    if (i >= 0) state.pinnedPanels.splice(i, 1)
    else state.pinnedPanels.push(id)
  }

  function isPinned(id) {
    return state.pinnedPanels.includes(id)
  }

  function isPanelEnabled(id) {
    return !state.disabledPanels.includes(id)
  }

  function setPanelEnabled(id, enabled) {
    const i = state.disabledPanels.indexOf(id)
    if (enabled) {
      if (i >= 0) state.disabledPanels.splice(i, 1)
    } else if (i < 0) {
      state.disabledPanels.push(id)
    }
  }

  function setTourDone(v) {
    state.tourDone = !!v
  }

  function resetLayout() {
    state.navCollapsed = DEFAULTS.navCollapsed
    state.navWidth = DEFAULTS.navWidth
    state.inspectorWidth = DEFAULTS.inspectorWidth
    state.toolsDock = DEFAULTS.toolsDock
    state.pinnedPanels = []
    state.disabledPanels = []
  }

  function applyAccentToDocument(el) {
    const root = el || document.documentElement
    const c = accentColor.value
    root.style.setProperty('--fluent-accent', c)
    root.style.setProperty('--fluent-accent-hover', shade(c, 12))
    root.style.setProperty('--ring', c)
    root.style.setProperty('--primary', c)
    // Legacy aliases used by canvas/panels
    root.style.setProperty('--accent', c)
    root.style.setProperty('--accent-2', shade(c, 12))
  }

  return {
    prefs: state,
    densityClass,
    accentColor,
    setDensity,
    setAccent,
    setNavCollapsed,
    setToolsDock,
    togglePinned,
    isPinned,
    isPanelEnabled,
    setPanelEnabled,
    setTourDone,
    resetLayout,
    applyAccentToDocument,
    ACCENT_PRESETS,
    TOGGLEABLE_PANELS
  }
}

/** Lighten (+) / darken (−) a #rrggbb color by percent. */
function shade(hex, percent) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return hex
  const n = parseInt(m[1], 16)
  let r = (n >> 16) & 0xff
  let g = (n >> 8) & 0xff
  let b = n & 0xff
  const t = percent < 0 ? 0 : 255
  const p = Math.abs(percent) / 100
  r = Math.round((t - r) * p) + r
  g = Math.round((t - g) * p) + g
  b = Math.round((t - b) * p) + b
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}
