import { createServer } from 'node:http'
import express from 'express'
import { mountEmoteRoutes } from '../server/emotes.js'

const app = express()
mountEmoteRoutes(app, () => true)

const srv = app.listen(0, async () => {
  const port = srv.address().port
  const base = `http://127.0.0.1:${port}`
  for (const cat of ['TOP', 'TRENDING_DAY', 'TRENDING_WEEK', 'NEW']) {
    const r = await fetch(`${base}/api/emotes/catalog?provider=7tv&category=${cat}&limit=5`)
    const j = await r.json()
    console.log(cat, j.ok, (j.results || []).slice(0, 3).map((e) => e.name))
  }
  srv.close()
})
