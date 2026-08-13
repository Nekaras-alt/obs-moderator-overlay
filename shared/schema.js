// shared/schema.js
// Single source of truth for the scene/layer model.
import { buildChatisUrl as buildChatisUrlFromConfig, defaultChatisConfig } from './chatis.js'

/** Multi Browser Source — several widget URLs + optional exclusive queue. */
export function defaultMultiBrowserConfig(partial = {}) {
  const urls = Array.isArray(partial.urls)
    ? partial.urls.map((u) => String(u || '').trim()).filter(Boolean)
    : []
  return {
    refreshKey: 0,
    width: 800,
    height: 600,
    queueEnabled: true,
    idleMs: 900,
    minHoldMs: 2500,
    maxHoldMs: 60000,
    ...partial,
    urls
  }
}

export const STAGE = Object.freeze({ W: 1920, H: 1080 })

export const LAYER_TYPES = [
  'image', 'gif', 'video', 'audio', 'youtube', 'text', 'emote',
  'browser', 'chatis', 'multiBrowser', 'timer', 'counter'
]

export const COLOR_LABELS = [
  { id: 'none',     color: 'transparent' },
  { id: 'red',      color: '#ff5f57' },
  { id: 'orange',   color: '#febc2e' },
  { id: 'green',    color: '#28c840' },
  { id: 'blue',     color: '#007aff' },
  { id: 'purple',   color: '#af52de' },
  { id: 'gray',     color: '#8e8e93' }
]

/** OBS-like Browser Source defaults. */
export function defaultBrowserConfig(partial = {}) {
  return {
    url: '',
    width: 800,
    height: 600,
    customCss: '',
    /**
     * When true AND the layer is gateway-proxied (XFO hosts / custom CSS),
     * volume/mute are forced via injected script. Direct embeds cannot
     * control cross-origin iframe audio (same limitation as a plain HTML iframe).
     */
    controlAudioViaObs: false,
    volume: 1,
    muted: false,
    refreshKey: 0,
    shutdownWhenNotVisible: false,
    refreshWhenActive: false,
    /** 'chatis' when created from ChatIS wizard */
    source: '',
    chatisConfig: null,
    ...partial
  }
}

export function defaultTransform(type) {
  const base = { x: 720, y: 390, w: 480, h: 300, rotation: 0, opacity: 1, flipH: false, flipV: false }
  if (type === 'audio') return { ...base, w: 360, h: 96 }
  if (type === 'text' || type === 'timer' || type === 'counter') {
    return { x: 560, y: 400, w: 800, h: 200, rotation: 0, opacity: 1, flipH: false, flipV: false }
  }
  if (type === 'emote') return { x: 820, y: 400, w: 280, h: 280, rotation: 0, opacity: 1, flipH: false, flipV: false }
  if (type === 'browser') return { x: 560, y: 240, w: 800, h: 600, rotation: 0, opacity: 1, flipH: false, flipV: false }
  if (type === 'chatis') return { x: 40, y: 200, w: 400, h: 700, rotation: 0, opacity: 1, flipH: false, flipV: false }
  if (type === 'multiBrowser') return { x: 560, y: 240, w: 800, h: 600, rotation: 0, opacity: 1, flipH: false, flipV: false }
  return base
}

/** @deprecated prefer buildChatisUrlFromConfig — kept for older call sites */
export function buildChatisUrl(channel, params = {}) {
  if (channel && typeof channel === 'object') return buildChatisUrlFromConfig(channel)
  return buildChatisUrlFromConfig({ ...defaultChatisConfig(channel), ...params, channel })
}

export { buildChatisUrlFromConfig, defaultChatisConfig }

export function createLayer(partial = {}) {
  const type = LAYER_TYPES.includes(partial.type) ? partial.type : 'image'
  const audienceHiddenByDefault = true
  const chatisDefaults = {
    channel: '',
    chatisParams: {},
    url: '',
    width: 400,
    height: 700,
    customCss: '',
    volume: 0,
    refreshKey: 0
  }

  const browser = defaultBrowserConfig({ ...(partial.browser || {}) })
  const transform = { ...defaultTransform(type), ...(partial.transform || {}) }
  if (type === 'browser') {
    if (browser.width) transform.w = Number(browser.width) || transform.w
    if (browser.height) transform.h = Number(browser.height) || transform.h
  }
  if (type === 'multiBrowser') {
    const mb = defaultMultiBrowserConfig(partial.multiBrowser || {})
    if (mb.width) transform.w = Number(mb.width) || transform.w
    if (mb.height) transform.h = Number(mb.height) || transform.h
  }

  return {
    id: partial.id || cryptoId(),
    name: partial.name || defaultName(type),
    type,
    src: partial.src || '',
    transform,
    order: typeof partial.order === 'number' ? partial.order : 0,
    colorLabel: partial.colorLabel || 'none',
    folder: partial.folder || null,
    locked: !!partial.locked,
    visible: partial.visible !== false,
    audienceVisible: partial.audienceVisible !== undefined
      ? partial.audienceVisible
      : !audienceHiddenByDefault,
    maintainRatio: partial.maintainRatio !== undefined
      ? partial.maintainRatio
      : (type === 'browser' || type === 'chatis' || type === 'multiBrowser' ? false : true),
    ttl: partial.ttl != null ? partial.ttl : null,
    video: {
      loop: false, autoplay: true, muted: false, speed: 1, volume: 1, fragment: null,
      ...(partial.video || {})
    },
    youtube: {
      startAt: 0,
      autoHide: false,
      playlist: null,
      queue: [],
      preload: true,
      // serverClock | moderatorMaster | legacy
      syncMode: 'serverClock',
      // muted (editor silent) | sound (editor hears local embed)
      previewAudio: 'muted',
      ...(partial.youtube || {})
    },
    audio: { volume: 1, loop: false, ...(partial.audio || {}) },
    text: {
      content: 'Double-click to edit',
      fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
      fontSize: 48, fontColor: '#ffffff', bold: false, italic: false, textAlign: 'center',
      outlineColor: '#000000', outlineWidth: 0,
      shadow: false, shadowColor: '#000000', shadowBlur: 6, shadowOffsetX: 2, shadowOffsetY: 2,
      bgColor: '#000000', bgOpacity: 0, borderRadius: 0,
      ...(partial.text || {})
    },
    emote: {
      provider: '', emoteId: '', animated: false,
      ...(partial.emote || {})
    },
    timerSeconds: typeof partial.timerSeconds === 'number' ? partial.timerSeconds : 300,
    timerEndsAt: partial.timerEndsAt != null ? partial.timerEndsAt : null,
    counterValue: typeof partial.counterValue === 'number' ? partial.counterValue : 0,
    browser,
    chatis: {
      ...chatisDefaults,
      ...(partial.chatis || {}),
      url: (partial.chatis && partial.chatis.url)
        || buildChatisUrlFromConfig({
          ...defaultChatisConfig(partial.chatis?.channel || partial.channel || ''),
          ...(partial.chatis?.chatisParams || {})
        })
    },
    multiBrowser: defaultMultiBrowserConfig(partial.multiBrowser || {
      urls: Array.isArray(partial.urls) ? partial.urls : []
    }),
    origin: partial.origin || 'editor',
    createdAt: partial.createdAt || Date.now()
  }
}

/**
 * Create a Browser Source layer from a ChatIS config (wizard output).
 */
export function createBrowserLayerFromChatis(cfg) {
  const config = { ...defaultChatisConfig(), ...cfg }
  const url = buildChatisUrlFromConfig(config)
  const w = Number(config.width) || 400
  const h = Number(config.height) || 700
  return createLayer({
    type: 'browser',
    name: 'ChatIS — ' + (config.channel || 'chat'),
    browser: defaultBrowserConfig({
      url,
      width: w,
      height: h,
      customCss: '',
      controlAudioViaObs: false,
      volume: 1,
      muted: false,
      source: 'chatis',
      chatisConfig: config
    }),
    transform: { ...defaultTransform('browser'), x: 40, y: 200, w, h },
    maintainRatio: false
  })
}

export function defaultName(type) {
  return ({
    image: 'Image', gif: 'GIF', video: 'Video',
    audio: 'Audio', youtube: 'YouTube',
    text: 'Text', emote: 'Emote',
    browser: 'Browser Source', chatis: 'ChatIS', multiBrowser: 'Multi Browser Source',
    timer: 'Timer', counter: 'Counter'
  })[type] || 'Layer'
}

export function cryptoId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch (_) { /* fall through */ }
  return 'L' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export const SOUNDPAD_SLOTS = 10
export function emptySoundpad() {
  return Array.from({ length: SOUNDPAD_SLOTS }, () => ({
    name: '',
    src: '',
    volume: 0.7,
    color: '#3b82f6'
  }))
}

export function createInitialScene() {
  return {
    version: 1,
    layers: [],
    settings: {
      gridEnabled: false,
      gridSize: 40,
      snapToGrid: false,
      snapToCenter: false,
      snapToEdges: false,
      showDistances: false,
      showEdgePixels: false,
      showRulers: false,
      showSafeArea: false,
      showObsBounds: false,
      showOffstageHatch: true,
      obsEnabled: false,
      obsOverlaySourceName: '',
      theme: 'dark',
      soundpadMasterVolume: 0.5,
      soundpadCompressor: false,
      twitchChannel: '',
      performMode: false,
      donations: {
        enabled: false,
        defaultDurationMs: 8000,
        blockedWords: [],
        autoSkipBlocked: true
      }
    },
    folders: [],
    presets: [],
    trash: [],
    soundpad: emptySoundpad()
  }
}
