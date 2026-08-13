/**
 * verify-packaged.mjs
 *
 * After electron-builder, assert that every runtime file under
 * server/ | electron/ | shared/ is present in
 * release/win-unpacked/resources/app/, plus structural product invariants.
 *
 * New modules in those trees are picked up automatically — no bat edits.
 * Client Vue is covered by dist/assets (vite already succeeded).
 *
 * Env:
 *   BUILD_STAMP — optional; if set, shared/build-info.json must match.
 *   OMO_ROOT    — optional repo root (default: cwd / parent of scripts).
 *
 * Exit 0 = ok, 1 = fail.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.OMO_ROOT
  ? path.resolve(process.env.OMO_ROOT)
  : path.resolve(__dirname, '..')

const APP = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app')
const RESOURCES = path.join(ROOT, 'release', 'win-unpacked', 'resources')

const SCAN_DIRS = ['server', 'electron', 'shared']
const EXT_OK = new Set(['.js', '.cjs', '.mjs', '.json'])

/** Mirror package.json build.files excludes (plus scrapers / secrets). */
function shouldSkip(relPosix) {
  const base = path.posix.basename(relPosix)
  const lower = relPosix.toLowerCase()
  if (base === '.env' || base.startsWith('.env.')) return true
  if (lower.includes('/release/')) return true
  if (base.endsWith('.md')) return true
  if (base.includes('scraped')) return true
  if (base.includes('-raw.') || base.endsWith('-raw.txt')) return true
  if (lower.includes('scrape-') && lower.includes('/scripts/')) return true
  if (base.startsWith('debug-') && base.endsWith('.log')) return true
  if (base === 'package-lock.json') return true
  return false
}

function walkFiles(absDir, prefix, out) {
  if (!fs.existsSync(absDir)) return
  for (const name of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, name.name)
    const rel = path.posix.join(prefix, name.name.replace(/\\/g, '/'))
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === '.git') continue
      walkFiles(abs, rel, out)
      continue
    }
    if (!name.isFile()) continue
    const ext = path.extname(name.name).toLowerCase()
    if (!EXT_OK.has(ext)) continue
    if (shouldSkip(rel)) continue
    out.push(rel)
  }
}

function fail(msg) {
  console.error('[verify-packaged][error]', msg)
  process.exitCode = 1
}

function ok(msg) {
  console.log('[verify-packaged]', msg)
}

function main() {
  console.log('=== verify-packaged ===')
  console.log('root:', ROOT)
  console.log('app: ', APP)

  if (!fs.existsSync(APP)) {
    fail('release/win-unpacked/resources/app missing — run electron-builder first (portable leaves win-unpacked).')
    return
  }

  const expected = []
  for (const dir of SCAN_DIRS) {
    walkFiles(path.join(ROOT, dir), dir, expected)
  }
  expected.sort()

  const missing = []
  for (const rel of expected) {
    const packed = path.join(APP, ...rel.split('/'))
    if (!fs.existsSync(packed)) missing.push(rel)
  }

  ok(`runtime files scanned: ${expected.length}`)
  if (missing.length) {
    fail(`${missing.length} file(s) missing from packaged app:`)
    for (const m of missing.slice(0, 40)) console.error('  -', m)
    if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`)
  } else {
    ok(`${expected.length} files checked, 0 missing`)
  }

  // --- Structural invariants -------------------------------------------------
  const distHtml = path.join(APP, 'dist', 'index.html')
  if (!fs.existsSync(distHtml)) fail('dist/index.html missing in packaged app')
  else ok('dist/index.html: ok')

  const assetsDir = path.join(APP, 'dist', 'assets')
  if (!fs.existsSync(assetsDir)) {
    fail('dist/assets missing in packaged app')
  } else {
    const assets = fs.readdirSync(assetsDir)
    const js = assets.filter((f) => f.endsWith('.js'))
    const css = assets.filter((f) => f.endsWith('.css'))
    if (!js.length) fail('no .js in dist/assets')
    else ok(`dist/assets js: ${js.length}`)
    if (!css.length) fail('no .css in dist/assets')
    else ok(`dist/assets css: ${css.length}`)
  }

  const buildInfoApp = path.join(APP, 'shared', 'build-info.json')
  if (!fs.existsSync(buildInfoApp)) {
    fail('shared/build-info.json missing in packaged app')
  } else {
    try {
      const info = JSON.parse(fs.readFileSync(buildInfoApp, 'utf8'))
      ok(`build-info: ${JSON.stringify(info)}`)
      const stamp = process.env.BUILD_STAMP
      if (stamp && info.buildStamp && String(info.buildStamp) !== String(stamp)) {
        fail(`buildStamp mismatch: packaged=${info.buildStamp} expected=${stamp}`)
      }
    } catch (e) {
      fail('shared/build-info.json invalid JSON: ' + e.message)
    }
  }

  const iconAppIco = path.join(APP, 'build', 'icon.ico')
  const iconResIco = path.join(RESOURCES, 'build', 'icon.ico')
  const iconAppPng = path.join(APP, 'build', 'icon.png')
  const iconResPng = path.join(RESOURCES, 'build', 'icon.png')
  if (!fs.existsSync(iconAppIco) && !fs.existsSync(iconResIco)) {
    fail('icon.ico missing (app/build or resources/build)')
  } else ok('icon.ico: ok')
  if (!fs.existsSync(iconAppPng) && !fs.existsSync(iconResPng)) {
    fail('icon.png missing (app/build or resources/build)')
  } else ok('icon.png: ok')

  const dataDir = path.join(RESOURCES, 'data')
  const uploadsDir = path.join(RESOURCES, 'uploads')
  if (!fs.existsSync(dataDir)) fail('resources/data seed missing')
  else ok('resources/data: ok')
  if (!fs.existsSync(uploadsDir)) fail('resources/uploads seed missing')
  else ok('resources/uploads: ok')

  const voices = path.join(APP, 'server', 'jeetbot-voices.json')
  if (!fs.existsSync(voices)) {
    fail('server/jeetbot-voices.json missing')
  } else {
    try {
      const arr = JSON.parse(fs.readFileSync(voices, 'utf8'))
      if (!Array.isArray(arr)) fail('jeetbot-voices.json is not an array')
      else if (arr.length < 100) fail(`jeetbot-voices.json too small: ${arr.length}`)
      else ok(`jeetbot voices: ${arr.length}`)
    } catch (e) {
      fail('jeetbot-voices.json invalid: ' + e.message)
    }
  }

  if (process.exitCode) {
    console.error('[verify-packaged] FAILED')
    process.exit(1)
  }
  console.log('[verify-packaged] OK')
}

main()
