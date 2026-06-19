// client/src/features/media.js
// Client-side helpers: classify a dropped/pasted item, upload files, and
// detect YouTube URLs so they become youtube-type layers.

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg']
const GIF_EXT = ['gif']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv', 'm4v']
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']

export function extOf(name) {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

export function isYouTube(url) {
  return /(?:youtube\.com|youtu\.be)/i.test(String(url))
}

// Classify a filename or URL into a layer type, or null if unsupported.
export function classify(nameOrUrl) {
  const s = String(nameOrUrl)
  if (isYouTube(s)) return 'youtube'
  const ext = extOf(s)
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (GIF_EXT.includes(ext)) return 'gif'
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  return null
}

// Upload one File via POST /api/upload. Resolves { url, type, name }.
export async function uploadFile(file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/upload', { method: 'POST', body: fd })
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Upload failed')
  return json
}

// Build a partial layer from a URL string (typed by classify()).
export function layerFromUrl(url) {
  const type = classify(url)
  if (!type) return null
  return { type, src: url, name: defaultName(type, url) }
}

export function defaultName(type, src) {
  if (type === 'youtube') return 'YouTube'
  const base = String(src).split('/').pop()?.split('?')[0] || type
  return base.length > 28 ? base.slice(0, 25) + '…' : base
}
