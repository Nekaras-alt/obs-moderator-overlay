// LAN / mesh address detection for StatusBar, Connector transports, and banners.
import os from 'node:os'

function ipv4Parts(ip) {
  if (!ip || typeof ip !== 'string') return null
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return parts
}

/** Tailscale / NetBird CGNAT: 100.64.0.0/10 */
export function isCgnatIp(ip) {
  const parts = ipv4Parts(ip)
  if (!parts) return false
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

export function isTailscaleIp(ip) {
  return isCgnatIp(ip)
}

/** Radmin VPN (Hamachi-family): 26.0.0.0/8 */
export function isRadminVpnIp(ip) {
  const parts = ipv4Parts(ip)
  return !!(parts && parts[0] === 26)
}

/**
 * Tag a NIC by name + subnet. Name wins when CGNAT is shared by Tailscale/NetBird.
 * @returns {string[]}
 */
export function tagAdapter(name, ip) {
  const n = String(name || '').toLowerCase()
  if (n.includes('tailscale')) return ['tailscale']
  if (n.includes('netbird') || /^wt\d+$/i.test(String(name || '').trim()) || n === 'wt0') return ['netbird']
  if (n.includes('zerotier')) return ['zerotier']
  if (n.includes('radmin') || isRadminVpnIp(ip)) return ['radmin']
  if (n.includes('wireguard') || /^wg(\d+)?$/.test(n) || n === 'omo0' || n.startsWith('omo0')) return ['wireguard']
  if (isCgnatIp(ip)) return ['cgnat']
  return []
}

export function listExternalIpv4() {
  const addrs = []
  try {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        const family = net.family === 'IPv4' || net.family === 4
        if (!family || net.internal) continue
        addrs.push({
          address: net.address,
          name,
          tags: tagAdapter(name, net.address),
          tailscale: isCgnatIp(net.address)
        })
      }
    }
  } catch (_) { /* ignore */ }
  return addrs
}

export function collectNetworkInfo(port = 8090) {
  const addrs = listExternalIpv4()
  const tailscaleIp = addrs.find((a) => a.tags.includes('tailscale') || a.tags.includes('cgnat'))?.address || null
  const lanIp = addrs.find((a) => !a.tags.includes('tailscale') && !a.tags.includes('cgnat'))?.address || addrs[0]?.address || null
  const hostname = (() => { try { return os.hostname() } catch (_) { return null } })()
  const magicDns = tailscaleIp && hostname ? `${hostname}` : null
  const preferredHost = tailscaleIp || lanIp || 'localhost'

  return {
    ip: preferredHost,
    lanIp: lanIp || null,
    tailscaleIp,
    magicDns,
    isTailscale: !!tailscaleIp,
    port: Number(port) || 8090,
    preferredHost,
    addresses: addrs.map((a) => a.address),
    adapters: addrs.map((a) => ({
      address: a.address,
      name: a.name,
      tags: a.tags
    }))
  }
}

export function detectLanIp() {
  return collectNetworkInfo().ip === 'localhost' ? null : collectNetworkInfo().ip
}
