import fs from 'fs'

const text = fs.readFileSync('tmp-chunk-364.js', 'utf8')
const start = text.indexOf('S=[{id:')
if (start < 0) {
  console.error('voice array not found')
  process.exit(1)
}
// Find matching end of array — naive: look for }],x= or }], followed by assign
let i = start + 2 // at [
let depth = 0
let end = -1
for (; i < text.length; i++) {
  const c = text[i]
  if (c === '[') depth++
  else if (c === ']') {
    depth--
    if (depth === 0) {
      end = i + 1
      break
    }
  }
}
const arrSrc = text.slice(start + 2, end) // includes [...]
console.log('array len', arrSrc.length)

// Convert JS object literals to JSON-ish: quote keys, keep strings
// The array uses unquoted keys: {id:"aidar",name:"Aidar",...}
let jsonish = arrSrc
  .replace(/([{,])(\w+):/g, '$1"$2":')
  // remove trailing commas before } ]
  .replace(/,(\s*[}\]])/g, '$1')

try {
  const raw = JSON.parse(jsonish)
  const list = raw.map((v) => ({
    id: String(v.id || '').toLowerCase(),
    name: String(v.name || v.id || ''),
    group: String(v.category || 'Other'),
    tags: Array.isArray(v.tags) ? v.tags.map(String) : []
  })).filter((v) => v.id)
  list.sort((a, b) => a.group.localeCompare(b.group, 'ru') || a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id))
  fs.writeFileSync('server/jeetbot-voices.json', JSON.stringify(list, null, 2))
  console.log('wrote', list.length, 'voices')
  console.log('groups', [...new Set(list.map((v) => v.group))].slice(0, 30))
} catch (e) {
  console.error('parse fail', e.message)
  fs.writeFileSync('tmp-voices-raw.js', arrSrc.slice(0, 5000))
  // Fallback: regex objects
  const voices = []
  const re = /\{id:"([^"]+)",name:"([^"]+)",command:"!tts [^"]+",audioSrc:"[^"]*",category:"((?:\\.|[^"\\])*)"/g
  let m
  while ((m = re.exec(arrSrc))) {
    voices.push({
      id: m[1].toLowerCase(),
      name: m[2],
      group: JSON.parse('"' + m[3] + '"')
    })
  }
  console.log('regex fallback', voices.length)
  fs.writeFileSync('server/jeetbot-voices.json', JSON.stringify(voices, null, 2))
}
