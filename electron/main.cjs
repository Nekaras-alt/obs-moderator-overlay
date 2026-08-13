// electron/main.js
// Electron main process: starts the Express server in-process, opens a
// BrowserWindow pointing at it, and adds a system tray icon.
//
// Startup: show splash immediately, then start server in parallel and navigate
// to the editor once /api/hello responds.

const { app, BrowserWindow, Tray, Menu, clipboard, nativeImage, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')

// @microsoft/signalr can throw from transport.onclose when a handshake fails
// while still Connecting — Electron would otherwise show a fatal dialog.
function isBenignSignalRNoise(err) {
  const msg = String(err?.message || err || '')
  return (
    msg.includes('HttpConnection.stopConnection') ||
    msg.includes('Error parsing handshake response') ||
    (msg.includes('stopConnection') && msg.includes('connecting state'))
  )
}
process.on('uncaughtException', (err) => {
  if (isBenignSignalRNoise(err)) {
    console.warn('[electron] ignored SignalR teardown race:', err?.message || err)
    return
  }
  console.error('[electron] uncaughtException:', err)
  try {
    dialog.showErrorBox(
      'A JavaScript error occurred in the main process',
      String(err?.stack || err?.message || err)
    )
  } catch (_) { /* ignore */ }
})
process.on('unhandledRejection', (reason) => {
  if (isBenignSignalRNoise(reason)) {
    console.warn('[electron] ignored SignalR rejection:', reason?.message || reason)
    return
  }
  console.error('[electron] unhandledRejection:', reason)
})

let serverStarted = false
let serverPort = Number(process.env.PORT) || 8090
let viewerToken = ''
let pin = ''
let expectedBuildStamp = 'unknown'
let editorNavigated = false
let joinCode = ''
let relayPaired = false
let relayConnected = false
let frameBridge = null

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const HAS_DIST = fs.existsSync(DIST)
const SPLASH_HTML = path.join(__dirname, 'splash.html')

/** host | remote | host-obs — from env or CLI --mode= */
function resolveAppMode() {
  const fromEnv = String(process.env.OMO_MODE || '').toLowerCase()
  if (fromEnv === 'remote' || fromEnv === 'host-obs' || fromEnv === 'host') return fromEnv
  const arg = process.argv.find((a) => a.startsWith('--mode='))
  if (arg) {
    const v = arg.slice('--mode='.length).toLowerCase()
    if (v === 'remote' || v === 'host-obs' || v === 'host') return v
  }
  return 'host'
}
const APP_MODE = resolveAppMode()
process.env.OMO_MODE = APP_MODE

function readPackagedBuildStamp() {
  try {
    const p = path.join(ROOT, 'shared', 'build-info.json')
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      return j.buildStamp || 'unknown'
    }
  } catch (_) {}
  return 'unknown'
}

function portFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0')
  })
}

async function findFreePort(start) {
  for (let p = start; p < start + 20; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await portFree(p)) return p
  }
  return start
}

async function startRemoteBootstrap() {
  if (serverStarted) return
  serverStarted = true
  expectedBuildStamp = readPackagedBuildStamp()
  serverPort = Number(process.env.OMO_REMOTE_BOOTSTRAP_PORT) || 18091
  process.env.OMO_REMOTE_BOOTSTRAP_PORT = String(serverPort)
  try {
    const bootPath = path.join(__dirname, '..', 'server', 'remote-bootstrap.js')
    const bootUrl = 'file:///' + bootPath.replace(/\\/g, '/')
    await import(bootUrl)
  } catch (err) {
    console.error('[electron] remote bootstrap failed:', err)
    dialog.showErrorBox('Remote mode failed', String(err?.message || err))
    return
  }
  for (let i = 0; i < 20; i++) {
    try {
      const hello = await fetch(`http://127.0.0.1:${serverPort}/api/hello`).then((r) => r.json())
      if (hello?.ok) return
    } catch (_) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  dialog.showErrorBox('Remote bootstrap not ready', 'Could not reach join page')
}

async function startServer() {
  if (serverStarted) return
  serverStarted = true

  expectedBuildStamp = readPackagedBuildStamp()

  if (HAS_DIST) process.env.NODE_ENV = 'production'

  const userData = app.getPath('userData')
  const dataDir = path.join(userData, 'data')
  const uploadsDir = path.join(userData, 'uploads')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(uploadsDir, { recursive: true })

  const secretFile = path.join(dataDir, '.secret')
  // Never copy a bundled .secret into userData — public releases must not ship a PIN.
  // First-run PIN is created via /api/setup when needsSetup() is true.
  if (!fs.existsSync(secretFile)) {
    const bundledData = path.join(process.resourcesPath || ROOT, 'data')
    const bundledScene = path.join(bundledData, 'scene.json')
    if (fs.existsSync(bundledScene)) {
      fs.copyFileSync(bundledScene, path.join(dataDir, 'scene.json'))
    }
  }

  process.env.OMO_DATA_DIR = dataDir
  process.env.OMO_UPLOADS_DIR = uploadsDir

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || ''
  const exeDir = path.dirname(app.getPath('exe'))
  const envCandidates = [
    process.env.OMO_ENV_FILE,
    portableDir ? path.join(portableDir, '.env') : null,
    path.join(exeDir, '.env'),
    path.join(userData, '.env'),
    path.join(ROOT, '.env'),
    path.join(process.resourcesPath || ROOT, '.env')
  ].filter(Boolean)
  for (const envFile of envCandidates) {
    if (fs.existsSync(envFile)) {
      process.env.OMO_ENV_FILE = envFile
      console.log('[electron] Using env file:', envFile)
      break
    }
  }

  const free = await portFree(serverPort)
  let skipServerImport = false
  if (!free) {
    try {
      const hello = await fetch(`http://127.0.0.1:${serverPort}/api/hello`).then((r) => r.json())
      if (hello?.buildStamp && hello.buildStamp === expectedBuildStamp) {
        console.log('[electron] Reusing already-running matching build on', serverPort)
        process.env.PORT = String(serverPort)
        skipServerImport = true
      } else {
        const alt = await findFreePort(serverPort + 1)
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['Use free port ' + alt, 'Quit'],
          defaultId: 0,
          title: 'Port ' + serverPort + ' busy',
          message: 'Port ' + serverPort + ' is already in use by another app (or an OLD Overlay build).',
          detail: 'Running UI against that port would show outdated code.\n\nExpected build: ' +
            expectedBuildStamp + '\nFound on :' + serverPort + ': ' + (hello?.buildStamp || 'unknown/non-OMO') +
            '\n\nClose the other instance, or continue on port ' + alt + '.'
        })
        if (choice !== 0) {
          app.quit()
          return
        }
        serverPort = alt
        process.env.PORT = String(alt)
      }
    } catch (_) {
      const alt = await findFreePort(serverPort + 1)
      serverPort = alt
      process.env.PORT = String(alt)
      console.log('[electron] Port busy; switching to', alt)
    }
  } else {
    process.env.PORT = String(serverPort)
  }

  if (!skipServerImport) {
    try {
      const serverPath = path.join(__dirname, '..', 'server', 'index.js')
      const serverUrl = 'file:///' + serverPath.replace(/\\/g, '/')
      await import(serverUrl)
    } catch (err) {
      console.error('[electron] Failed to start server:', err)
      dialog.showErrorBox('Server failed', String(err?.message || err))
      return
    }
  }

  let matched = false
  for (let i = 0; i < 15; i++) {
    try {
      const hello = await fetch(`http://127.0.0.1:${serverPort}/api/hello`).then((r) => r.json())
      if (hello?.ok) {
        console.log('[electron] hello buildStamp=', hello.buildStamp, 'expected=', expectedBuildStamp)
        matched = true
        break
      }
    } catch (_) {
      await new Promise(r => setTimeout(r, 150))
    }
  }
  if (!matched) {
    dialog.showErrorBox('Server not ready', 'Could not reach http://localhost:' + serverPort + '/api/hello')
    return
  }

  try {
    const secretFile2 = path.join(dataDir, '.secret')
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(secretFile2)) break
      await new Promise(r => setTimeout(r, 100))
    }
    if (fs.existsSync(secretFile2)) {
      const secret = JSON.parse(fs.readFileSync(secretFile2, 'utf8'))
      pin = secret.pin || ''
      viewerToken = secret.viewerToken || ''
      if (pin) console.log('[electron] PIN loaded')
      else console.log('[electron] PIN not set yet (first-run setup)')
      updateTrayMenu()
    }
  } catch (_) { /* best effort */ }
}

let mainWindow = null
let tray = null

function resolveAppIconPath() {
  const candidates = []
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'build', 'icon.ico'))
    candidates.push(path.join(process.resourcesPath, 'build', 'icon.png'))
    candidates.push(path.join(process.resourcesPath, 'icon.ico'))
    candidates.push(path.join(process.resourcesPath, 'icon.png'))
  }
  try {
    const appPath = app.getAppPath()
    candidates.push(path.join(appPath, 'build', 'icon.ico'))
    candidates.push(path.join(appPath, 'build', 'icon.png'))
  } catch (_) { /* app may not be ready */ }
  candidates.push(path.join(ROOT, 'build', 'icon.ico'))
  candidates.push(path.join(ROOT, 'build', 'icon.png'))
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function loadAppIcon(forTray = false) {
  const iconPath = resolveAppIconPath()
  if (!iconPath) return nativeImage.createEmpty()
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return nativeImage.createEmpty()
  if (forTray && process.platform === 'win32') {
    try {
      icon = icon.resize({ width: 16, height: 16 })
    } catch (_) { /* keep original */ }
  }
  return icon
}

function trayLocale() {
  try {
    const loc = (app.getLocale && app.getLocale()) || process.env.LANG || ''
    return String(loc).toLowerCase().startsWith('ru') ? 'ru' : 'en'
  } catch (_) {
    return 'en'
  }
}

function trayLabels() {
  const ru = trayLocale() === 'ru'
  return {
    showEditor: ru ? 'Показать редактор' : 'Show Editor',
    copyObs: ru ? 'Копировать OBS URL' : 'Copy OBS URL',
    copyEditor: ru ? 'Копировать URL редактора' : 'Copy Editor URL',
    copyJoin: ru ? 'Копировать join code' : 'Copy join code',
    startRelay: ru ? 'Старт Relay' : 'Start Relay',
    relayUnreachable: ru
      ? 'Relay недоступен — задайте URL в Settings → Connector'
      : 'Relay unreachable — set URLs in Settings → Connector',
    waitingMod: ru ? 'Ожидание модератора' : 'Waiting for moderator',
    paired: ru ? 'Модератор подключён' : 'Moderator paired',
    frameOn: ru ? 'Frame bridge: вкл' : 'Frame bridge: on',
    frameOff: ru ? 'Frame bridge: выкл' : 'Frame bridge: off',
    quit: ru ? 'Выход' : 'Quit'
  }
}

function shouldStartFrameBridge() {
  if (APP_MODE === 'remote') return false
  if (process.env.OMO_FRAME_BRIDGE === '0') return false
  if (process.env.OMO_FRAME_BRIDGE === '1') return true
  // Default ON for host + host-obs so OMO Overlay (Native) works out of the box
  return APP_MODE === 'host' || APP_MODE === 'host-obs'
}

async function startFrameBridgeIfNeeded() {
  if (!shouldStartFrameBridge()) return null
  if (!viewerToken) {
    console.warn('[electron] frame-bridge skipped: no viewer token yet')
    return null
  }
  try {
    const { createFrameBridge } = require('./frame-bridge.cjs')
    frameBridge = createFrameBridge({
      getObsUrl: () => `http://127.0.0.1:${serverPort}/obs?t=${viewerToken}`
    })
    globalThis.__omoFrameBridge = frameBridge
    globalThis.__omoStartFrameBridge = async () => {
      process.env.OMO_FRAME_BRIDGE = '1'
      return startFrameBridgeIfNeeded()
    }
    globalThis.__omoStopFrameBridge = () => stopFrameBridge()
    await frameBridge.start()
    console.log('[electron] frame-bridge status', frameBridge.status())
    return frameBridge
  } catch (err) {
    console.error('[electron] frame-bridge failed:', err)
    return null
  }
}

async function stopFrameBridge() {
  try {
    if (frameBridge) await frameBridge.stop()
  } catch (_) { /* ignore */ }
  try {
    const { resetFrameBridge } = require('./frame-bridge.cjs')
    resetFrameBridge()
  } catch (_) { /* ignore */ }
  frameBridge = null
  globalThis.__omoFrameBridge = null
}

function editorUrl() {
  // Prefer 127.0.0.1 — `localhost` can resolve to ::1 while the server binds IPv4 only.
  if (APP_MODE === 'remote') return `http://127.0.0.1:${serverPort}/`
  if (HAS_DIST) return `http://127.0.0.1:${serverPort}/`
  return 'http://127.0.0.1:5173/'
}

function focusOrRecreateMainWindow() {
  if (app.isQuitting) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
    return
  }
  editorNavigated = false
  createWindow()
  if (serverStarted) navigateToEditor()
}

function navigateToEditor() {
  if (!mainWindow || mainWindow.isDestroyed() || editorNavigated) return
  editorNavigated = true
  const url = editorUrl()
  console.log('[electron] loading editor:', url)
  mainWindow.loadURL(url)
}

function createWindow() {
  const stamp = expectedBuildStamp && expectedBuildStamp !== 'unknown' ? ' · ' + expectedBuildStamp : ''
  const windowIcon = loadAppIcon(false)
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'OBS Moderator Overlay' + stamp,
    icon: windowIcon.isEmpty() ? undefined : windowIcon,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#202225',
      symbolColor: '#e9eaed',
      height: 36
    },
    backgroundColor: '#1b1c1f',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    // Event-based fallback if ready-to-show already fired before paint.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  })

  // Splash first — editor URL loads after server is ready.
  if (fs.existsSync(SPLASH_HTML)) {
    mainWindow.loadFile(SPLASH_HTML)
  } else {
    mainWindow.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="margin:0;background:#1b1c1f;color:#e9eaed;font-family:Segoe UI,sans-serif;display:flex;height:100vh;align-items:center;justify-content:center">Starting…</body>'
    ))
  }

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    console.log('[electron] did-fail-load:', errorCode, errorDesc, validatedURL)
    if (editorNavigated && (errorCode === -102 || errorCode === -3)) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(editorUrl())
      }, 400)
    }
  })

  let editorLoaded = false
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow?.webContents?.getURL?.() || ''
    if ((url.includes('127.0.0.1') || url.includes('localhost')) && !url.includes('splash')) {
      editorLoaded = true
      console.log('[electron] page loaded OK')
    }
  })
  const blockTopNav = (e, _url, kind) => {
    if (!editorLoaded) return
    e.preventDefault()
    console.log('[electron] blocked top ' + kind)
  }
  mainWindow.webContents.on('will-navigate', (e, url) => blockTopNav(e, url, 'will-navigate'))
  mainWindow.webContents.on('will-redirect', (e, url) => blockTopNav(e, url, 'will-redirect'))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTwitchChatPopout(url)) {
      openTwitchChatWindow(url)
      return { action: 'deny' }
    }
    try {
      const u = new URL(String(url || ''))
      if (u.pathname.startsWith('/docs/')) return { action: 'deny' }
    } catch (_) {}
    return { action: 'allow', overrideBrowserWindowOptions: { width: 480, height: 720 } }
  })

  if (!HAS_DIST) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('close', () => {
    app.isQuitting = true
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function isTwitchChatPopout(url) {
  try {
    const u = new URL(String(url || ''))
    if (!/\.twitch\.tv$/i.test(u.hostname) && u.hostname.toLowerCase() !== 'twitch.tv') return false
    return /\/popout\/[^/]+\/chat/i.test(u.pathname)
  } catch (_) {
    return false
  }
}

const chatWindows = new Map()

/** CDN URLs — fetched in main and executed as source (Twitch CSP blocks <script src>). */
const EMOTE_SCRIPT_URLS = [
  'https://cdn.betterttv.net/betterttv.js',
  'https://cdn.frankerfacez.com/static/script.min.js'
]

const emoteScriptCache = new Map()

async function fetchEmoteScript(url) {
  if (emoteScriptCache.has(url)) return emoteScriptCache.get(url)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 OBS-Moderator-Overlay' }
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const text = await res.text()
    emoteScriptCache.set(url, text)
    return text
  } catch (err) {
    console.warn('[electron] emote script fetch failed', url, err.message)
    return ''
  }
}

async function injectTwitchEmotes(wc) {
  if (!wc || wc.isDestroyed()) return

  try {
    await wc.executeJavaScript(`(() => {
      try {
        var key = 'bttv_settings';
        var settings = {};
        try { settings = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { settings = {}; }
        var flags = Number(settings.emotes || 0) || 0;
        settings.emotes = flags | 16;
        settings['7tv'] = true;
        settings.seventv = true;
        localStorage.setItem(key, JSON.stringify(settings));
      } catch (e) {}
      if (!window.__omoEmoteScripts) window.__omoEmoteScripts = {};
      return true;
    })()`)
  } catch (_) {}

  for (const url of EMOTE_SCRIPT_URLS) {
    try {
      const done = await wc.executeJavaScript(
        `!!(window.__omoEmoteScripts && window.__omoEmoteScripts[${JSON.stringify(url)}])`
      )
      if (done) continue
    } catch (_) {}

    const src = await fetchEmoteScript(url)
    if (!src) continue
    try {
      await wc.executeJavaScript(src)
      await wc.executeJavaScript(
        `(window.__omoEmoteScripts=window.__omoEmoteScripts||{},window.__omoEmoteScripts[${JSON.stringify(url)}]=true,true)`
      )
      console.log('[electron] injected emote script', url)
    } catch (err) {
      console.warn('[electron] emote inject failed', url, err.message)
    }
  }
}

function scheduleEmoteInject(wc) {
  if (!wc || wc.__omoEmoteScheduled) return
  wc.__omoEmoteScheduled = true
  const run = () => { injectTwitchEmotes(wc).catch(() => {}) }
  wc.on('did-finish-load', () => {
    run()
    setTimeout(run, 2500)
    setTimeout(run, 6000)
  })
  wc.on('dom-ready', () => setTimeout(run, 800))
}

function openTwitchChatWindow(url) {
  let key = url
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/popout\/([^/]+)\/chat/i)
    key = (m && m[1] ? m[1] : url).toLowerCase()
  } catch (_) {}

  const existing = chatWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    existing.loadURL(url).catch(() => {})
    return existing
  }

  const win = new BrowserWindow({
    width: 420,
    height: 800,
    minWidth: 320,
    minHeight: 480,
    title: 'Twitch Chat',
    backgroundColor: '#0e0e10',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  chatWindows.set(key, win)
  win.on('closed', () => {
    if (chatWindows.get(key) === win) chatWindows.delete(key)
  })
  scheduleEmoteInject(win.webContents)
  win.loadURL(url).catch((err) => console.warn('[electron] chat load failed', err.message))
  return win
}

function quitApp() {
  app.isQuitting = true
  try { tray?.destroy() } catch (_) { /* ignore */ }
  tray = null
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
    return
  }
  app.quit()
  setTimeout(() => {
    try { app.exit(0) } catch (_) { process.exit(0) }
  }, 400)
}

function createTray() {
  const icon = loadAppIcon(true)
  if (icon.isEmpty()) {
    console.warn('[electron] No tray icon found under build/icon.ico|png — using empty image')
  }

  tray = new Tray(icon)
  updateTrayMenu()

  tray.setToolTip('OBS Moderator Overlay')
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) mainWindow.hide()
      else {
        mainWindow.show()
        mainWindow.focus()
      }
      return
    }
    focusOrRecreateMainWindow()
  })
}

/** Optional electron-updater: no-op when the package is not installed. */
function setupAutoUpdater() {
  let autoUpdater
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (_) {
    console.log('[electron] electron-updater not installed — skipping update check')
    return
  }
  try {
    autoUpdater.autoDownload = false
    autoUpdater.on('update-available', (info) => {
      const ver = info?.version || '?'
      console.log('[electron] update available:', ver)
      try {
        tray?.displayBalloon?.({
          title: 'Update available',
          content: `Version ${ver} is available`
        })
      } catch (_) { /* balloon optional */ }
    })
    autoUpdater.on('update-not-available', () => {
      console.log('[electron] no updates available')
    })
    autoUpdater.on('error', (err) => {
      console.log('[electron] updater error:', err?.message || err)
    })
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[electron] checkForUpdates failed:', err?.message || err)
    })
  } catch (err) {
    console.log('[electron] updater setup failed:', err?.message || err)
  }
}

async function refreshConnectorTrayInfo() {
  if (APP_MODE === 'remote') return
  try {
    const st = await fetch(`http://127.0.0.1:${serverPort}/api/connector/status`).then((r) => r.json())
    joinCode = st.relay?.joinCode || joinCode || ''
    relayPaired = !!st.relay?.paired
    relayConnected = !!(st.relay?.host?.connected || st.relay?.hosts?.some((h) => h.connected))
  } catch (_) { /* ignore */ }
}

function updateTrayMenu() {
  const obsUrl = `http://localhost:${serverPort}/obs?t=${viewerToken}`
  const L = trayLabels()
  const items = []
  if (APP_MODE !== 'host-obs') {
    items.push({ label: L.showEditor, click: () => { mainWindow?.show(); mainWindow?.focus() } })
    items.push({ type: 'separator' })
  }
  if (APP_MODE !== 'remote') {
    if (pin) items.push({ label: `PIN: ${pin}`, enabled: false })
    else items.push({ label: 'PIN: (create in app)', enabled: false })
    if (joinCode) {
      items.push({ label: `Join: ${joinCode}`, enabled: false })
      if (relayPaired) items.push({ label: L.paired, enabled: false })
      else if (relayConnected) items.push({ label: L.waitingMod, enabled: false })
    }
    items.push({ label: L.copyObs, click: () => clipboard.writeText(obsUrl) })
    items.push({ label: L.copyEditor, click: () => clipboard.writeText(`http://localhost:${serverPort}/`) })
    items.push({
      label: L.copyJoin,
      enabled: !!joinCode,
      click: () => clipboard.writeText(joinCode)
    })
    items.push({
      label: L.startRelay,
      click: async () => {
        try {
          const st = await fetch(`http://127.0.0.1:${serverPort}/api/connector/host/start`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: 'Bearer ' + (process.env.OMO_ADMIN_TOKEN || '')
            },
            body: '{}'
          }).then((r) => r.json())
          joinCode = st.relay?.joinCode || ''
          relayPaired = !!st.relay?.paired
          relayConnected = !!(st.relay?.host?.connected || st.relay?.hosts?.some((h) => h.connected))
          if (!st.ok) {
            dialog.showErrorBox('OMO Relay', st.error || L.relayUnreachable)
            await refreshConnectorTrayInfo()
          }
          updateTrayMenu()
        } catch (err) {
          dialog.showErrorBox('OMO Relay', err?.message || L.relayUnreachable)
          await refreshConnectorTrayInfo()
          updateTrayMenu()
        }
      }
    })
    const fbOn = !!(frameBridge && frameBridge.status().enabled)
    items.push({
      label: fbOn ? L.frameOn : L.frameOff,
      click: async () => {
        try {
          if (fbOn) await stopFrameBridge()
          else {
            process.env.OMO_FRAME_BRIDGE = '1'
            await startFrameBridgeIfNeeded()
          }
        } catch (_) { /* ignore */ }
        updateTrayMenu()
      }
    })
  } else {
    items.push({ label: 'Mode: remote', enabled: false })
  }
  items.push({ type: 'separator' })
  items.push({ label: L.quit, click: () => quitApp() })
  tray?.setContextMenu(Menu.buildFromTemplate(items))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusOrRecreateMainWindow()
  })

  app.whenReady().then(async () => {
    expectedBuildStamp = readPackagedBuildStamp()
    console.log('[electron] mode=', APP_MODE)

    // Prefetch emote CDNs so first chat open injects faster.
    Promise.all(EMOTE_SCRIPT_URLS.map((u) => fetchEmoteScript(u))).catch(() => {})

    // Renderer can ask main to open chat (backup if window.open is blocked).
    ipcMain.handle('omo:open-twitch-chat', (_e, payload) => {
      const ch = String(payload?.channel || '').trim().replace(/^#/, '').toLowerCase()
      if (!ch) return { ok: false, error: 'channel required' }
      const url = `https://www.twitch.tv/popout/${encodeURIComponent(ch)}/chat?popout=`
      openTwitchChatWindow(url)
      return { ok: true, url }
    })

    if (APP_MODE === 'host-obs') {
      // Headless host for OBS plugin sidecar: no editor window.
      createTray()
      setupAutoUpdater()
      try {
        await startServer()
        await refreshConnectorTrayInfo()
        await startFrameBridgeIfNeeded()
        updateTrayMenu()
      } catch (err) {
        console.error('[electron] host-obs startup failed:', err)
        dialog.showErrorBox('Host-OBS failed', String(err?.message || err))
      }
      setInterval(() => { refreshConnectorTrayInfo().then(updateTrayMenu) }, 5000)
      return
    }

    createWindow()
    createTray()
    setupAutoUpdater()

    try {
      if (APP_MODE === 'remote') {
        await startRemoteBootstrap()
        navigateToEditor()
      } else {
        await startServer()
        navigateToEditor()
        await refreshConnectorTrayInfo()
        await startFrameBridgeIfNeeded()
      }
    } catch (err) {
      console.error('[electron] startup failed:', err)
      dialog.showErrorBox('Startup failed', String(err?.message || err))
    }

    setTimeout(updateTrayMenu, 1000)
  })

  app.on('before-quit', () => {
    app.isQuitting = true
    stopFrameBridge()
    try { tray?.destroy() } catch (_) { /* ignore */ }
    tray = null
  })

  app.on('window-all-closed', () => {
    app.isQuitting = true
    try { tray?.destroy() } catch (_) { /* ignore */ }
    tray = null
    app.quit()
    setTimeout(() => {
      try { app.exit(0) } catch (_) { process.exit(0) }
    }, 400)
  })
}
