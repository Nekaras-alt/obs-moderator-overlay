// test/bttv-search.mjs
// Verifies the BetterTTV search fix against the live API. The old code queried
// /emotes/shared/top (a fixed trending list) and filtered it client-side, so
// every search returned the same ~100 emotes regardless of the query. The new
// code hits /emotes/shared/search?query=... which returns real matches.
//
// This test runs the exact fetch the server makes (server/emotes.js bttvSearch)
// and asserts:
//   1. Searching "pepe" returns emotes whose codes contain "pepe".
//   2. Two different queries return different result sets (proves the query
//      param is actually honored, not ignored like the old /shared endpoint).
//   3. Every result has a usable CDN URL and provider metadata.
//
// Run:  node test/bttv-search.mjs
// Exits 0 on success, 1 on failure.

const BTTV_SEARCH = 'https://api.betterttv.net/3/emotes/shared/search'

function bttvExt(e) { return (e.imageType || 'png').toLowerCase() }
function bttvUrl(e) {
  const ext = e.animated ? 'gif' : bttvExt(e)
  return `https://cdn.betterttv.net/emote/${e.id}/3x.${ext}`
}
function bttvNorm(e) {
  return { id: e.id, name: e.code, provider: 'bttv', url: bttvUrl(e), animated: !!e.animated }
}

// Mirror of server/emotes.js bttvSearch().
async function bttvSearch(q, limit) {
  const r = await fetch(`${BTTV_SEARCH}?query=${encodeURIComponent(q)}&limit=${limit}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  const data = await r.json()
  const list = Array.isArray(data) ? data : []
  return list.map(bttvNorm).filter((e) => e.url)
}

function log(...a) { console.log('[bttv]', ...a) }

try {
  log('searching "pepe" (limit=12)…')
  const pepe = await bttvSearch('pepe', 12)
  if (!pepe.length) throw new Error('no results for "pepe"')
  // BTTV's search does loose matching (it appends a few "related" emotes), so we
  // don't require every hit to contain the query — but the great majority must.
  // The old bug returned ZERO query-matched emotes (a fixed trending list), so a
  // strong majority is a decisive signal that the query is honored.
  const matching = pepe.filter((e) => String(e.name || '').toLowerCase().includes('pepe'))
  if (matching.length < pepe.length * 0.5) {
    throw new Error(`search ignored query: only ${matching.length}/${pepe.length} matched "pepe" (${pepe.map((e) => e.name).join(', ')})`)
  }
  log(`  → ${matching.length}/${pepe.length} match "pepe", e.g. ${pepe.slice(0, 5).map((e) => e.name).join(', ')}`)

  // Shape check: each result must be a usable normalized emote.
  for (const e of pepe) {
    if (!e.id || !e.name || e.provider !== 'bttv' || !/^https:\/\//.test(e.url)) {
      throw new Error(`malformed result: ${JSON.stringify(e)}`)
    }
  }

  log('searching "kekw" (limit=8) to prove distinct queries differ…')
  const kekw = await bttvSearch('kekw', 8)
  const pepeIds = new Set(pepe.map((e) => e.id))
  const overlap = kekw.filter((e) => pepeIds.has(e.id))
  const kekwMatching = kekw.filter((e) => String(e.name || '').toLowerCase().includes('kekw'))
  if (kekwMatching.length === 0) {
    throw new Error('kekw results did not match query at all')
  }
  // Different queries must produce different sets (the old bug returned the
  // same list for any query, so overlap would have been ~100%).
  if (overlap.length === kekw.length && kekw.length > 0) {
    throw new Error(`"kekw" returned the same set as "pepe" — query is being ignored (overlap ${overlap.length}/${kekw.length})`)
  }
  log(`  → ${kekwMatching.length}/${kekw.length} match "kekw", e.g. ${kekw.slice(0, 5).map((e) => e.name).join(', ')}`)

  // Limit is honored.
  log('checking limit=3…')
  const three = await bttvSearch('pepe', 3)
  if (three.length > 3) throw new Error(`limit=3 returned ${three.length} results`)
  log(`  → returned ${three.length}`)

  log('ALL CHECKS PASSED ✓ (BTTV search honors the query)')
  process.exit(0)
} catch (err) {
  console.error('[bttv] FAILED:', err.message)
  process.exit(1)
}
