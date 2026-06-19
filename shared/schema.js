// shared/schema.js
// Single source of truth for the scene/layer model. Imported by BOTH the
// Node server and the Vue client, so a layer's shape can never drift between
// the moderator's editor and the OBS Browser-Source viewer.

export const STAGE = Object.freeze({ W: 1920, H: 1080 })

export const LAYER_TYPES = ['image', 'gif', 'video', 'audio', 'youtube', 'text', 'emote']

export const COLOR_LABELS = [
  { id: 'none',     color: 'transparent' },
  { id: 'red',      color: '#ff5f57' },
  { id: 'orange',   color: '#febc2e' },
  { id: 'green',    color: '#28c840' },
  { id: 'blue',     color: '#007aff' },
  { id: 'purple',   color: '#af52de' },
  { id: 'gray',     color: '#8e8e93' }
]

// Default per-type transform: media loads centered at 25% of stage width so
// the moderator immediately sees it somewhere sensible on a 1920x1080 stage.
export function defaultTransform(type) {
  const base = { x: 720, y: 390, w: 480, h: 300, rotation: 0, opacity: 1, flipH: false, flipV: false }
  if (type === 'audio') return { ...base, w: 360, h: 96 }
  if (type === 'text') return { x: 560, y: 400, w: 800, h: 200, rotation: 0, opacity: 1, flipH: false, flipV: false }
  // Emotes are typically small & square; drop one centered on the stage.
  if (type === 'emote') return { x: 820, y: 400, w: 280, h: 280, rotation: 0, opacity: 1, flipH: false, flipV: false }
  return base
}

// A fresh, fully-populated layer. Everything has a value so the renderer never
// has to defensively check undefined fields. `order` is assigned by the caller.
export function createLayer(partial = {}) {
  const type = LAYER_TYPES.includes(partial.type) ? partial.type : 'image'
  // Per-type audience default: EVERY new layer starts HIDDEN from the audience
  // (the OBS /obs viewer won't render it) so the moderator can position and
  // review it first, then reveal it with the globe/lock toggle in the layers
  // panel or PropertiesPanel. This applies to all types — image, gif, video,
  // YouTube, audio, text, emote. The moderator sees the layer in the editor
  // regardless; this only gates the live stream output.
  const audienceHiddenByDefault = true
  return {
    id: partial.id || cryptoId(),
    name: partial.name || defaultName(type),
    type,
    src: partial.src || '',
    // Logical pixels relative to a 1920x1080 stage. The editor scales this
    // stage to fit the moderator's screen; OBS renders it 1:1 at 1920x1080.
    transform: { ...defaultTransform(type), ...(partial.transform || {}) },
    order: typeof partial.order === 'number' ? partial.order : 0,
    colorLabel: partial.colorLabel || 'none',
    folder: partial.folder || null,
    locked: !!partial.locked,
    // visible = editor-only visibility (eye icon).
    visible: partial.visible !== false,
    // audienceVisible = whether /obs renders it. This is the core
    // "prepare off-screen, then reveal to audience" toggle.
    audienceVisible: partial.audienceVisible !== undefined
      ? partial.audienceVisible
      : !audienceHiddenByDefault,
    // maintainRatio = keep the media's native aspect ratio inside its box
    // (object-fit: contain) instead of stretching to fill (object-fit: fill).
    // Default true for image/gif/video so media never looks squashed.
    maintainRatio: partial.maintainRatio !== undefined ? partial.maintainRatio : true,
    // ttl = seconds until the object auto-deletes itself. null = permanent.
    ttl: partial.ttl != null ? partial.ttl : null,
    video: {
      loop: false,
      autoplay: true,
      muted: false,
      speed: 1,
      volume: 1,
      fragment: null, // [start, end] seconds, null = whole clip
      ...(partial.video || {})
    },
    youtube: {
      startAt: 0,
      autoHide: false,
      playlist: null,
      queue: [],
      // preload = on load, buffer the opening segment so the moderator's first
      // Play starts smoothly instead of stuttering while the stream catches up.
      // Defaults on for YouTube layers (it's the common case); can be disabled
      // per-layer from the controls.
      preload: true,
      ...(partial.youtube || {})
    },
    audio: {
      volume: 1,
      loop: false,
      // _playing is a transient (non-persisted) signal between the controls
      // and the renderer: set true to play, false to pause.
      ...(partial.audio || {})
    },
    text: {
      content: 'Double-click to edit',
      fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
      fontSize: 48,
      fontColor: '#ffffff',
      bold: false,
      italic: false,
      textAlign: 'center',
      // Outline (text stroke): width 0 = off.
      outlineColor: '#000000',
      outlineWidth: 0,
      // Drop shadow.
      shadow: false,
      shadowColor: '#000000',
      shadowBlur: 6,
      shadowOffsetX: 2,
      shadowOffsetY: 2,
      // Background fill behind the text box.
      bgColor: '#000000',
      bgOpacity: 0, // 0 = fully transparent, 1 = opaque
      borderRadius: 0,
      ...(partial.text || {})
    },
    emote: {
      // Which emote provider the asset came from, so we can re-fetch at
      // different sizes, dedup favorites, or swap variants later.
      provider: '',      // '7tv' | 'bttv' | 'ffz'
      emoteId: '',       // upstream id used in the CDN URL
      animated: false,   // whether the chosen asset is animated (gif/webp)
      ...(partial.emote || {})
    },
    origin: partial.origin || 'editor',
    createdAt: partial.createdAt || Date.now()
  }
}

export function defaultName(type) {
  return ({
    image: 'Image', gif: 'GIF', video: 'Video',
    audio: 'Audio', youtube: 'YouTube',
    text: 'Text', emote: 'Emote'
  })[type] || 'Layer'
}

export function cryptoId() {
  // Works in Node 18+ (crypto.webcrypto) and browsers.
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch (_) { /* fall through */ }
  return 'L' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// Default global scene state. `settings` holds editor toggles that are
// moderator-local in spirit but persisted centrally (grid, snap, theme).
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
      showRulers: false,
      showGuides: false,
      showSafeArea: false,
      showObsBounds: false,
      obsEnabled: false,
      theme: 'dark'
    },
    folders: [],          // [{ id, name, color }]
    presets: [],          // [{ id, name, snapshot }]
    trash: []             // soft-deleted layers for restore
  }
}
