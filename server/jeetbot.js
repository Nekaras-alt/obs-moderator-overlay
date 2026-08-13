// Jeetbot TTS — primary path: Twitch chat-bridge (!!!#voice text).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sendTwitchChatAsDefault } from './twitch-oauth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadVoices() {
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, 'jeetbot-voices.json'), 'utf8'))
    if (Array.isArray(raw) && raw.length) {
      return raw.map((v) => ({
        id: String(v.id || '').toLowerCase(),
        name: decodeUnicodeEscapes(v.name || v.id || ''),
        group: decodeUnicodeEscapes(v.group || v.category || 'Other')
      })).filter((v) => v.id)
    }
  } catch (_) { /* fall through */ }
  return [
    { id: 'aidar', name: 'Aidar', group: 'Basic' },
    { id: 'baya', name: 'Baya', group: 'Basic' },
    { id: 'kseniya', name: 'Kseniya', group: 'Basic' },
    { id: 'xenia', name: 'Xenia', group: 'Basic' },
    { id: 'eugene', name: 'Eugene', group: 'Basic' }
  ]
}

/** Fix names stored as literal \\uXXXX sequences from MDX scrape. */
function decodeUnicodeEscapes(s) {
  s = String(s || '')
  if (!s.includes('\\u')) return s
  try {
    return JSON.parse(`"${s.replace(/"/g, '\\"')}"`)
  } catch (_) {
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  }
}

export const JEETBOT_VOICES = loadVoices()

export function mountJeetbotRoutes(app, requireModerator, getChannel) {
  app.get('/api/jeetbot/voices', (req, res) => {
    if (!requireModerator(req, res)) return
    const q = String(req.query.q || '').toLowerCase()
    let list = JEETBOT_VOICES
    if (q) {
      list = list.filter((v) =>
        v.id.includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.group.toLowerCase().includes(q)
      )
    }
    res.json({ ok: true, voices: list, mode: 'chat-bridge', total: JEETBOT_VOICES.length })
  })

  app.post('/api/jeetbot/speak', async (req, res) => {
    if (!requireModerator(req, res)) return
    const text = String(req.body?.text || '').trim()
    const voice = String(req.body?.voice || 'baya').replace(/[^a-z0-9_]/gi, '')
    const channel = String(req.body?.channel || getChannel?.() || '').trim()
    if (!text) return res.status(400).json({ ok: false, error: 'text required' })
    if (!channel) return res.status(400).json({ ok: false, error: 'channel required (settings.twitchChannel)' })
    const msg = `!!!#${voice} ${text}`.slice(0, 500)
    try {
      await sendTwitchChatAsDefault(msg, channel)
      res.json({ ok: true, mode: 'chat-bridge', message: msg })
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message, hint: 'Connect Twitch OAuth and ensure Jeetbot dock is running on the streamer PC' })
    }
  })
}
