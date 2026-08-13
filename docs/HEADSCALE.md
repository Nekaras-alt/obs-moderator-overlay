# Headscale (self-hosted Tailscale coordination)

Use when Tailscale SaaS control plane is blocked or you want full control of the mesh.
OMO still speaks plain HTTP to `host:8090` over the Headscale CGNAT (`100.64.0.0/10`) — same as Tailscale.

## Setup sketch

1. Deploy Headscale on a VPS you control (EU or RU cloud).
2. Point both streamer and moderator clients at your Headscale URL (`headscale` / Tailscale-compatible clients).
3. Save the URL in **Settings → Connector → Headscale** (or `OMO_HEADSCALE_URL` / `data/connector.json`).
4. ACL: allow **only TCP 8090** from moderator → streamer (mirror [TAILSCALE.md](TAILSCALE.md)).

Example policy idea:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:moderator"],
      "dst": ["tag:streamer:8090"]
    }
  ]
}
```

## With OMO harden mode

When `harden` / `OMO_HARDEN=1` / `bindHostOnly` is on, the app listens on `127.0.0.1` only.
Then Headscale alone is **not** enough unless you also:

- keep `bindHostOnly: false` for Direct/Headscale access, **or**
- use **Relay** / WireGuard path for remote mods while OBS stays on localhost.

Recommended RU setup: **harden + outbound WSS relay (EU+RU)**; Headscale optional for LAN-like direct when the mesh works.

## Docs

- [CONNECTOR.md](CONNECTOR.md) — transport profiles
- [TAILSCALE.md](TAILSCALE.md) — ACL pattern
