// server/media.js
// Upload endpoint for media files. Validates type against the supported set
// and a configurable max size, stores under /uploads, returns a URL the
// editor can drop straight into a layer's src.

import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')

const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 200 * 1024 * 1024 // 200 MB default

// Supported extensions per layer type. Moderator uploads are trusted but
// still type-checked.
const EXT_BY_TYPE = {
  image: ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg'],
  gif: ['.gif'],
  video: ['.mp4', '.webm', '.mov', '.mkv', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']
}
const ALL_EXT = new Set(Object.values(EXT_BY_TYPE).flat())

function typeForExt(ext) {
  for (const [type, exts] of Object.entries(EXT_BY_TYPE)) if (exts.includes(ext)) return type
  return null
}

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const id = crypto.randomBytes(12).toString('hex')
    cb(null, id + ext)
  }
})

export const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (!ALL_EXT.has(ext)) return cb(new Error('Unsupported file type: ' + ext))
    cb(null, true)
  }
})

// Mount on an express app: POST /api/upload -> { url, type, name }
export function mountUploadRoute(app) {
  app.post('/api/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? `File too large (max ${Math.round(MAX_BYTES / 1048576)} MB)`
          : err.message
        return res.status(400).json({ ok: false, error: msg })
      }
      if (!req.file) return res.status(400).json({ ok: false, error: 'No file' })
      const ext = path.extname(req.file.originalname).toLowerCase()
      const type = typeForExt(ext) || 'image'
      res.json({
        ok: true,
        url: '/uploads/' + req.file.filename,
        type,
        name: req.file.originalname,
        bytes: req.file.size
      })
    })
  })
}

export { typeForExt, ALL_EXT }
