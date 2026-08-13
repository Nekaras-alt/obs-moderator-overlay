// Spotify control — local OS media keys (no Premium / Web API required).
// Moderators hit the panel; the streamer's PC injects VK_MEDIA_* key events
// into Windows (PowerShell) or macOS (osascript). Linux uses playerctl when present.
import './config/env.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'

const execFileAsync = promisify(execFile)
const platform = os.platform()

const VK = {
  next: 0xB0,
  previous: 0xB1,
  stop: 0xB2,
  playpause: 0xB3,
  mute: 0xAD,
  voldown: 0xAE,
  volup: 0xAF
}

async function sendMediaKeyWin(vk) {
  const ps = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class OmoMedia {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Tap(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, 2, UIntPtr.Zero);
  }
}
"@
[OmoMedia]::Tap(${vk})
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    windowsHide: true,
    timeout: 8000
  })
}

async function sendMediaKeyMac(action) {
  const map = {
    playpause: 'playpause',
    next: 'next track',
    previous: 'previous track',
    stop: 'stop',
    volup: 'volume up',
    voldown: 'volume down',
    mute: 'volume mute'
  }
  const cmd = map[action] || 'playpause'
  await execFileAsync('osascript', ['-e', `tell application "System Events" to ${cmd}`], { timeout: 8000 })
}

async function sendMediaKeyLinux(action) {
  const map = {
    playpause: 'play-pause',
    next: 'next',
    previous: 'previous',
    stop: 'stop',
    volup: 'volume-up',
    voldown: 'volume-down',
    mute: 'volume-mute'
  }
  const cmd = map[action] || 'play-pause'
  await execFileAsync('playerctl', [cmd], { timeout: 8000 })
}

export async function sendLocalMedia(action) {
  const a = String(action || '').toLowerCase()
  if (platform === 'win32') {
    const vk = VK[a] ?? VK.playpause
    await sendMediaKeyWin(vk)
    return { ok: true, via: 'win-media-keys', action: a }
  }
  if (platform === 'darwin') {
    await sendMediaKeyMac(a)
    return { ok: true, via: 'osascript', action: a }
  }
  try {
    await sendMediaKeyLinux(a)
    return { ok: true, via: 'playerctl', action: a }
  } catch (err) {
    throw new Error('Linux media control needs playerctl: ' + err.message)
  }
}

export function mountSpotifyRoutes(app, requireModerator) {
  app.get('/api/spotify/status', async (req, res) => {
    if (!requireModerator(req, res)) return
    res.json({
      ok: true,
      mode: 'local-media-keys',
      configured: true,
      connected: true,
      premiumRequired: false,
      platform,
      hint: 'Controls the desktop Spotify (or any media app) on the streamer PC via OS media keys. No Premium needed.'
    })
  })

  app.post('/api/spotify/control', async (req, res) => {
    if (!requireModerator(req, res)) return
    let action = String(req.body?.action || '').toLowerCase()
    if (action === 'play' || action === 'pause') action = 'playpause'
    if (action === 'volume') {
      const v = Number(req.body?.value)
      // Relative nudge — no absolute volume API via media keys
      action = v < 50 ? 'voldown' : 'volup'
    }
    const allowed = new Set(['playpause', 'next', 'previous', 'stop', 'volup', 'voldown', 'mute'])
    if (!allowed.has(action)) {
      return res.status(400).json({ ok: false, error: 'unknown action' })
    }
    try {
      const result = await sendLocalMedia(action)
      res.json({ ok: true, ...result })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  // Legacy OAuth endpoints — disabled (Premium Web API not used).
  app.get('/api/spotify/oauth/start', (req, res) => {
    if (!requireModerator(req, res)) return
    res.status(410).json({ ok: false, error: 'Spotify OAuth removed — use local media keys (no Premium).' })
  })
  app.get('/api/spotify/now-playing', (req, res) => {
    if (!requireModerator(req, res)) return
    res.json({ ok: true, playing: null, mode: 'local-media-keys' })
  })
  app.get('/api/spotify/search', (req, res) => {
    if (!requireModerator(req, res)) return
    res.json({ ok: true, tracks: [], mode: 'local-media-keys' })
  })
  app.post('/api/spotify/play', async (req, res) => {
    if (!requireModerator(req, res)) return
    try {
      res.json(await sendLocalMedia('playpause'))
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })
}
