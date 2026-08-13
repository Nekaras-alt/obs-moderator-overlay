import fs from 'fs'

const p = 'server/jeetbot-voices.json'
const voices = JSON.parse(fs.readFileSync(p, 'utf8'))

function decodeEscapes(s) {
  s = String(s || '')
  if (!s.includes('\\u')) return s
  // Names were stored as literal backslash-u sequences: \u041f...
  try {
    return JSON.parse(`"${s.replace(/\\/g, '\\').replace(/"/g, '\\"')}"`.replace(/\\\\u/g, '\\u'))
  } catch (_) {
    /* fall through */
  }
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

let n = 0
for (const v of voices) {
  const name = decodeEscapes(v.name)
  const group = decodeEscapes(v.group)
  if (name !== v.name || group !== v.group) n++
  v.name = name
  v.group = group
}

fs.writeFileSync(p, JSON.stringify(voices, null, 2) + '\n')
console.log('decoded entries', n)
console.log(voices.find((x) => x.id === 'shrek_bread'))
console.log(voices.filter((x) => /Поттер|Potter/i.test(x.group)).slice(0, 3))
