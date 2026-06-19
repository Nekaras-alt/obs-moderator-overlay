// client/src/features/dnd.js
// Composable: handles drag-over/drop of files + URLs and the preload-gate
// confirmation dialog. Used by both the Toolbar (narrow strip drop zone) and
// EditorView (full-shell drop zone) so the upload logic lives in one place.

import { ref, computed } from 'vue'
import { useSceneStore } from '../stores/scene.js'
import { uploadFile, layerFromUrl, classify } from './media.js'

// Per-type thresholds that trigger a confirmation before upload.
const PRELOAD_THRESHOLDS = {
  video: 500 * 1024 * 1024,   // 500 MB
  gif:   200 * 1024 * 1024,   // 200 MB
  audio: 100 * 1024 * 1024    // 100 MB
}
const PRELOAD_TOTAL = 500 * 1024 * 1024  // 500 MB total for a batch

function humanSize(bytes) {
  if (!bytes) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}

export function useDnd() {
  const scene = useSceneStore()

  const dragOver = ref(false)
  const dontAskPreload = ref(false)
  const preloadOpen = ref(false)
  const preloadPending = ref([])
  const preloadTotal = computed(() => preloadPending.value.reduce((s, f) => s + (f.size || 0), 0))

  // Called by drag-over / drag-leave handlers on whatever element uses this.
  function onDragOver(e) { e.preventDefault(); dragOver.value = true }
  function onDragLeave(e) { e.preventDefault(); dragOver.value = false }

  async function onDrop(e) {
    dragOver.value = false
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length) { addFiles(files); return }
    // Dropped text (e.g. a URL dragged from another browser tab).
    const text = e.dataTransfer?.getData('text')
    if (text) addUrl(text)
  }

  // Programmatic file add (used by the file-picker button in Toolbar).
  async function addFilesFromInput(files) {
    const filtered = files.filter(Boolean)
    if (!filtered.length) return
    await addFiles(filtered)
  }

  async function addFiles(files) {
    const filtered = files.filter(Boolean)
    if (!filtered.length) return
    const big = filtered.filter((f) => {
      const type = classify(f.name) || 'image'
      const thresh = PRELOAD_THRESHOLDS[type]
      return thresh && f.size >= thresh
    })
    const total = filtered.reduce((s, f) => s + (f.size || 0), 0)
    if (!dontAskPreload.value && (big.length || total >= PRELOAD_TOTAL)) {
      preloadPending.value = filtered
      preloadOpen.value = true
      return // wait for confirm/cancel
    }
    await runUpload(filtered)
  }

  async function runUpload(files) {
    for (const f of files) {
      try {
        const res = await uploadFile(f)
        await scene.addLayer({ type: res.type, src: res.url, name: res.name })
      } catch (err) {
        console.error('upload failed', err)
        alert('Upload failed: ' + err.message)
      }
    }
  }

  function confirmPreload() {
    preloadOpen.value = false
    const files = preloadPending.value.slice()
    preloadPending.value = []
    runUpload(files)
  }
  function cancelPreload() {
    preloadOpen.value = false
    preloadPending.value = []
  }

  function addUrl(url) {
    if (!classify(url)) { alert('Unsupported URL. Use an image/video/audio link or a YouTube URL.'); return }
    const partial = layerFromUrl(url)
    if (partial) scene.addLayer(partial)
  }

  return {
    dragOver,
    preloadOpen,
    preloadPending,
    preloadTotal,
    dontAskPreload,
    humanSize,
    onDragOver,
    onDragLeave,
    onDrop,
    addFilesFromInput,
    addUrl,
    confirmPreload,
    cancelPreload
  }
}
