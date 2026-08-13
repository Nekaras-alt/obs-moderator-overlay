// ChatIS (jChat fork) URL builder — mirrors https://chatis.is2511.com/script.js generateURL()
export const CHATIS_BASE = 'https://chatis.is2511.com/v2/'

export const CHATIS_SIZES = [
  { value: '1', label: 'Small' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Large' }
]

export const CHATIS_FONTS = [
  { value: '0', label: '[Custom]' },
  { value: '1', label: 'Baloo Tammudu' },
  { value: '2', label: 'Segoe UI (Chatterino)' },
  { value: '3', label: 'Roboto' },
  { value: '4', label: 'Lato' },
  { value: '5', label: 'Noto Sans' },
  { value: '6', label: 'Source Code Pro' },
  { value: '7', label: 'Impact' },
  { value: '8', label: 'Comfortaa' },
  { value: '9', label: 'Dancing Script' },
  { value: '10', label: 'Indie Flower' },
  { value: '11', label: 'Open Sans' },
  { value: '12', label: 'Alsina (Vsauce)' }
]

export const CHATIS_STROKES = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Thin' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Thick' },
  { value: '4', label: 'Thicker' }
]

export const CHATIS_SHADOWS = [
  { value: '0', label: 'Off' },
  { value: '1', label: 'Small' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Large' }
]

/** Default ChatIS setup form state (matches site defaults). */
export function defaultChatisConfig(channel = '') {
  return {
    channel: String(channel || '').replace(/^#/, '').toLowerCase(),
    size: '2',
    font: '2',
    fontCustom: '',
    stroke: '0',
    shadow: '0',
    emoteScale: '',
    animate: false,
    bots: false,
    fade: false,
    fadeSeconds: 30,
    smallCaps: false,
    nlAfterName: false,
    hideNames: false,
    hideSpecialBadges: false,
    showHomies: false,
    markdown: false,
    botNames: '',
    // Suggested OBS browser size for the generated layer
    width: 400,
    height: 700
  }
}

/**
 * Build overlay URL exactly like ChatIS setup page generateURL().
 * @param {ReturnType<typeof defaultChatisConfig>} cfg
 */
export function buildChatisUrl(cfg = {}) {
  const c = { ...defaultChatisConfig(), ...cfg }
  const channel = String(c.channel || '').trim().replace(/^#/, '')
  if (!channel) return ''

  const u = new URL(CHATIS_BASE)
  u.searchParams.set('channel', channel)
  if (c.animate) u.searchParams.set('animate', 'true')
  if (c.bots) u.searchParams.set('bots', 'true')
  if (c.fade) u.searchParams.set('fade', String(Math.max(1, Number(c.fadeSeconds) || 30)))
  u.searchParams.set('size', String(c.size || '2'))
  u.searchParams.set('font', String(c.font || '2'))
  if (String(c.font) === '0' && c.fontCustom) {
    u.searchParams.set('fontCustom', String(c.fontCustom))
  }
  if (c.hideSpecialBadges) u.searchParams.set('hide_special_badges', 'true')
  if (c.showHomies) u.searchParams.set('show_homies', 'true')
  if (c.stroke && String(c.stroke) !== '0') u.searchParams.set('stroke', String(c.stroke))
  if (c.shadow && String(c.shadow) !== '0') u.searchParams.set('shadow', String(c.shadow))
  const emoteScale = parseFloat(c.emoteScale)
  if (c.emoteScale !== '' && !Number.isNaN(emoteScale) && emoteScale >= 0 && emoteScale <= 3) {
    u.searchParams.set('emoteScale', String(emoteScale))
  }
  if (c.smallCaps) u.searchParams.set('small_caps', 'true')
  if (c.nlAfterName) u.searchParams.set('nl_after_name', 'true')
  if (c.hideNames) u.searchParams.set('hide_names', 'true')
  if (c.markdown) u.searchParams.set('markdown', 'true')
  if (c.botNames && String(c.botNames).trim()) {
    u.searchParams.set('botNames', String(c.botNames).trim())
  }
  return u.toString()
}

/** Alias used by schema / older call sites */
export const buildChatisUrlFromConfig = buildChatisUrl

