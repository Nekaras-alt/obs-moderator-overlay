#!/usr/bin/env node
/**
 * Free local Vite/server ports before `npm run dev`.
 * Stale node/electron processes otherwise cause EADDRINUSE and kill concurrently.
 */
import { execSync } from 'node:child_process'
import process from 'node:process'

const PORTS = (process.env.DEV_PORTS || '8090,5173,5174')
  .split(',')
  .map((s) => Number(String(s).trim()))
  .filter((n) => Number.isFinite(n) && n > 0)

function pidsOnPortWin(port) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    return [...new Set(String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => n > 0))]
  } catch {
    return []
  }
}

function pidsOnPortUnix(port) {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return [...new Set(String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => n > 0))]
  } catch {
    return []
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGTERM')
      try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    }
    return true
  } catch {
    return false
  }
}

const isWin = process.platform === 'win32'
let killed = 0
for (const port of PORTS) {
  const pids = isWin ? pidsOnPortWin(port) : pidsOnPortUnix(port)
  for (const pid of pids) {
    if (pid === process.pid) continue
    const ok = killPid(pid)
    console.log(`[free-ports] port ${port}: ${ok ? 'killed' : 'failed'} pid ${pid}`)
    if (ok) killed++
  }
}
if (!killed) console.log('[free-ports] nothing listening on', PORTS.join(', '))
