// test/sync.mjs — end-to-end sync check using the ws EventEmitter API.
import WebSocket from 'ws'

const BASE = 'http://localhost:8090'
let step = 0
const log = (m) => console.log(`[step ${++step}] ${m}`)

// Hard overall timeout so the script can never hang the runner.
const guard = setTimeout(() => {
  console.log('FAIL: script watchdog tripped (hung)')
  process.exit(1)
}, 15000)
guard.unref?.()

const vt = await fetch(BASE + '/api/viewer-token').then((r) => r.json())
const mod = await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pin: '6918' })
}).then((r) => r.json())
log('got viewer token + moderator session')

// Create a ws and capture the FIRST 'scene' message it ever sees, so the
// initial scene (sent on connect) is never missed due to a listener-race.
function openWithFirstScene(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:8090/ws?t=${token}`)
    let firstResolved = false
    ws.on('message', (raw) => {
      if (firstResolved) return
      let m; try { m = JSON.parse(raw.toString()) } catch { return }
      if (m.type === 'scene') {
        firstResolved = true
        resolve({ ws, firstScene: m.scene })
      }
    })
    ws.once('error', reject)
  })
}
function open(token) { return openWithFirstScene(token).then((r) => r.ws) }
// Wait for the next 'scene' message on ws, with a per-call timeout.
function nextScene(ws, label, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`nextScene(${label}) timed out`)), timeoutMs)
    const h = (raw) => {
      let m
      try { m = JSON.parse(raw.toString()) } catch { return }
      if (m.type === 'scene') { clearTimeout(t); ws.off('message', h); resolve(m.scene) }
    }
    ws.on('message', h)
  })
}
const send = (ws, o) => ws.send(JSON.stringify(o))

let failures = 0
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`); if (!cond) failures++ }

const obsR = await openWithFirstScene(vt.token)
const edR = await openWithFirstScene(mod.token)
const obs = obsR.ws
const editor = edR.ws
log('connected viewer (obs) + editor (moderator)')

// Workspace-agnostic: both clients must see the SAME initial scene (consistency),
// not necessarily an empty one — the moderator may have real layers saved.
check('OBS and editor agree on initial layer count', obsR.firstScene.layers.length === edR.firstScene.layers.length)
check('OBS and editor agree on layer ids',
  JSON.stringify(obsR.firstScene.layers.map((l) => l.id)) === JSON.stringify(edR.firstScene.layers.map((l) => l.id)))
check('trash array present on boot (crash-restore store)', Array.isArray(edR.firstScene.trash))
const beforeCount = edR.firstScene.layers.length
log(`both received consistent initial scene (${beforeCount} layers)`)

// 1. addLayer from editor -> both should get the echo.
const obsP1 = nextScene(obs, 'obs-after-add')
const edP1 = nextScene(editor, 'editor-after-add')
send(editor, { type: 'op', ref: 1, op: { kind: 'addLayer', layer: {
  id: 't1', name: 'Test', type: 'image', src: 'x',
  transform: { x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, flipH: false, flipV: false },
  order: 0, colorLabel: 'none', folder: null, locked: false, visible: true,
  audienceVisible: true, timeline: {}, video: {}, youtube: {}, audio: {},
  origin: 'editor', queueMeta: null, createdAt: Date.now()
} } })
const [added1, added2] = await Promise.all([obsP1, edP1])
check('OBS saw the new layer (+1)', added1.layers.length === beforeCount + 1)
check('editor got its own echo (+1)', added2.layers.length === beforeCount + 1)
const t1fromObs = added1.layers.find((l) => l.id === 't1')
const t1fromEd = added2.layers.find((l) => l.id === 't1')
check('new layer present on OBS side', !!t1fromObs)
check('new layer present on editor side', !!t1fromEd)
log('addLayer propagated to both')

// 2. move it -> both echo.
const obsP2 = nextScene(obs, 'obs-after-move')
const edP2 = nextScene(editor, 'editor-after-move')
send(editor, { type: 'op', ref: 2, op: { kind: 'updateLayer', id: 't1', patch: {
  transform: { x: 500, y: 500, w: 100, h: 100, rotation: 0, opacity: 1, flipH: false, flipV: false }
} } })
const [moved1, moved2] = await Promise.all([obsP2, edP2])
check('OBS saw the move (x=500)', moved1.layers.find((l) => l.id === 't1').transform.x === 500)
check('editor saw the move (x=500)', moved2.layers.find((l) => l.id === 't1').transform.x === 500)
log('updateLayer propagated to both')

// 3. hide from audience.
const obsP3 = nextScene(obs, 'obs-after-hide')
send(editor, { type: 'op', ref: 3, op: { kind: 'updateLayer', id: 't1', patch: { audienceVisible: false } } })
const hidden = await obsP3
check('audienceVisible=false stored on OBS side', hidden.layers.find((l) => l.id === 't1').audienceVisible === false)
log('audience toggle propagated')

// 4. viewer cannot author (read-only): sending an op yields NO op-result.
const viewerOpEcho = await new Promise((resolve) => {
  const t = setTimeout(() => { ws_off(); resolve('silence') }, 1200)
  const h = (raw) => {
    let m; try { m = JSON.parse(raw.toString()) } catch { return }
    if (m.type === 'op-result') { clearTimeout(t); ws_off(); resolve(m.result) }
  }
  const ws_off = () => obs.off('message', h)
  obs.on('message', h)
  send(obs, { type: 'op', ref: 99, op: { kind: 'addLayer', layer: { id: 'hack' } } })
})
check('viewer ops are ignored (no op-result)', viewerOpEcho === 'silence')
log('viewer is correctly read-only')

// 5. delete -> editor echoes (this is what hung before the broadcast fix).
const edP5 = nextScene(editor, 'editor-after-delete')
send(editor, { type: 'op', ref: 4, op: { kind: 'deleteLayer', id: 't1' } })
const afterDel = await edP5
check('editor saw delete (back to baseline)', afterDel.layers.length === beforeCount)
check('deleted layer went to trash', afterDel.trash.some((t) => t.id === 't1'))
log('deleteLayer propagated to editor (layer moved to trash)')

obs.close()
editor.close()
clearTimeout(guard)
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
