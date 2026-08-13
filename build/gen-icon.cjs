// Generate a proper multi-size ICO file from a 256x256 PNG.
// ICO format: header + directory entries + image data.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 256

// Create raw RGBA pixel data — blue gradient with white "O" ring
const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4
    const t = y / SIZE
    pixels[idx] = Math.round(59 + (30 - 59) * t)
    pixels[idx + 1] = Math.round(130 + (64 - 130) * t)
    pixels[idx + 2] = Math.round(246 + (175 - 246) * t)
    pixels[idx + 3] = 255
  }
}
// White ring
const cx = 128, cy = 128, rOut = 70, rIn = 45
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx, dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist <= rOut && dist >= rIn) {
      const idx = (y * SIZE + x) * 4
      pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255
    }
  }
}

// Encode PNG
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const rawData = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0
    rgba.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const compressed = zlib.deflateSync(rawData)
  function crc32(buf) {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i]
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }
    return ~crc
  }
  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii')
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(data.length, 0)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0)
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
  }
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))])
}

// Generate PNG
const png = encodePNG(SIZE, SIZE, pixels)
fs.writeFileSync(path.join(__dirname, 'icon.png'), png)
console.log('PNG:', png.length, 'bytes')

// Generate ICO — single 256x256 PNG entry
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)

const dirEntry = Buffer.alloc(16)
dirEntry[0] = 0   // width: 0 = 256
dirEntry[1] = 0   // height: 0 = 256
dirEntry[2] = 0   // colorCount
dirEntry[3] = 0   // reserved
dirEntry.writeUInt16LE(1, 4)
dirEntry.writeUInt16LE(32, 6)
dirEntry.writeUInt32LE(png.length, 8)
dirEntry.writeUInt32LE(22, 12)

const ico = Buffer.concat([icoHeader, dirEntry, png])
fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico)
console.log('ICO:', ico.length, 'bytes')
