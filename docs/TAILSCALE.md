# Tailscale ACL for OBS Moderator Overlay

Expose **only TCP port 8090** to moderators. Do **not** use Tailscale Funnel for this app.

For relay / WireGuard / dual-mode Electron setups, see **[CONNECTOR.md](CONNECTOR.md)**.

## Recommended ACL

```json
{
  "tagOwners": {
    "tag:streamer": ["autogroup:admin"],
    "tag:moderator": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:moderator"],
      "dst": ["tag:streamer:8090"]
    },
    {
      "action": "accept",
      "src": ["tag:streamer"],
      "dst": ["tag:streamer:*"]
    }
  ]
}
```

## Checklist

1. Tag the streamer machine `tag:streamer` and the mod device `tag:moderator`.
2. Windows Firewall: allow inbound 8090 on the Tailscale interface only.
3. OBS WebSocket stays on `127.0.0.1:4455` (never `0.0.0.0`).
4. Moderator opens `http://100.x.x.x:8090/` and enters the PIN from the server console.
5. OBS Browser Source (or **OMO Overlay** plugin source) uses `http://localhost:8090/obs?t=<viewer-token>` on the streamer PC.
6. Multi-donation alerts: `http://localhost:8090/multi-alerts?t=<viewer-token>`.
7. OBS live bounds + preview: connect OBS in Settings / OBS Sources; enable **View → OBS bounds**; optional **Panels → OBS Preview** (see [OBS-PREVIEW.md](OBS-PREVIEW.md)).

## Alternatives

| Tool | When |
|------|------|
| **OMO WSS Relay** | Tailscale blocked/unstable (esp. RU) — see [CONNECTOR.md](CONNECTOR.md) |
| **Porthole** | Steam friends / share code; streamer uses localhost — [PORTHOLE.md](PORTHOLE.md) |
| Headscale | Self-hosted Tailscale coordination — [HEADSCALE.md](HEADSCALE.md) |
| WireGuard to VPS | Mesh alternative; import profile in Settings → Connector |
| Cloudflare Tunnel + Access | Mod has no Tailscale; need OTP (may be blocked in RU) |
| ngrok | Short demos only |
| RustDesk / RDP | Never for overlay-only access |
