# OMO Connector

Remote overlay for OBS Moderator Overlay. In **Settings → Connector** each transport is a spoiler (priority order). Several clients can be up at once; **active** is the first that answers a live probe.

OMO does **not** ship Tailscale, Headscale, NetBird, ZeroTier, Radmin VPN, WireGuard, or cloudflared. You install those yourself and accept their terms.

## Settings spoilers (priority)

1. **Tailscale** — mesh IP `:8090` → plugin Browser (remote). See [TAILSCALE.md](TAILSCALE.md).
2. **Headscale + Tailscale client** — same client, your control URL. See [HEADSCALE.md](HEADSCALE.md).
3. **NetBird**
4. **ZeroTier**
5. **Radmin VPN**
6. **WireGuard** — paste `.conf` in the spoiler.
7. **Cloudflare Tunnel** — `cloudflared` to `localhost:8090`; save the public hostname.
8. **Your WSS relay** — join code, Start/Stop, overlay URL via `relay/` on a VPS.

**Advanced:** harden / bind localhost, Native frames. Harden makes mesh IPs **not live** (correct: remote OBS cannot hit `:8090`).

Copy **this spoiler’s** overlay URL into the streamer plugin **Browser (remote)**. Viewer token comes from `/api/viewer-token` (status bar / Settings).

Two host layouts:

- **Classic:** scene authority on the **streamer PC** (full app or `host-obs` sidecar). Moderators join via relay + PIN.
- **Plugin-only streamer:** scene authority on the **moderator PC** (full app). Streamer OBS uses plugin **Browser (remote)** and the overlay URL from the active spoiler.

## Your WSS relay (no mesh)

1. Deploy [`relay/`](../relay/) on a VPS with TLS (`wss://…/connector`).
2. Settings → Connector → **Your WSS relay** → paste URLs → Save → **Start relay**.
3. Copy **join code** (moderator) or **overlay URL** (plugin-only streamer).
4. Moderator: remote Electron build → enter code → host **PIN**.

Both peers only make **outbound** connections. Home PCs need no port forward.

Auto profile (**Auto (best live)**) prefers a **live mesh** over your relay if both are up. `preferredProfile: relay` + `OMO_CONNECTOR_AUTO=1` still starts the WSS relay on boot.

---

## Personal deploy in ~15 minutes

### 1. VPS + DNS

- Cheap VPS with a public IP (EU and/or RU if you need dual-home).
- DNS `A`/`AAAA` for e.g. `relay.yourdomain` → VPS.

### 2. Relay with TLS (Docker)

On the VPS, copy the `relay/` folder, then:

```bash
cd relay
export RELAY_DOMAIN=relay.yourdomain
docker compose up -d
```

Health: `https://relay.yourdomain/health` → JSON `ok: true`.

Without Docker:

```bash
cd relay && npm install && npm start   # :8787
# Put Caddy/nginx TLS in front → wss://relay.yourdomain/connector
```

Optional second VPS for RU: repeat with `relay-ru.yourdomain`.

### 3. Host app config

Env (recommended):

```env
OMO_RELAY_URLS=wss://relay.yourdomain/connector
# dual-home:
# OMO_RELAY_URLS=wss://relay-eu.yourdomain/connector,wss://relay-ru.yourdomain/connector
OMO_PREFERRED_PROFILE=relay
OMO_CONNECTOR_AUTO=1
OMO_BIND_LOOPBACK=1
OMO_HARDEN=1
```

Or Settings → Connector → **Your WSS relay** → paste URLs → **Save relay URLs** → **Start relay**.

Example file: [`server/connector/connector.example.json`](../server/connector/connector.example.json) → copy to `data/connector.json`.

### 4. Moderator

```bash
npm run electron:remote
# or portable: OBS-Overlay-Portable.exe --mode=remote
```

Enter join code → PIN from host console/tray.

### 5. Smoke check

```bash
cd relay && npm run test:e2e
```

---

## Modes

| Mode | How to run | Streamer | Moderator |
|------|------------|----------|-----------|
| **Host-full** | Portable / `electron .` (default) | Full editor + server | Remote build via relay |
| **Host-obs** | `npm run electron:host-obs` | Tray + server; OBS plugin | Remote editor via relay |
| **Remote** | `npm run electron:remote` | — | Join code → local proxy → PIN |

## Transport profiles

Settings spoilers are the source of truth (same order as live rank):

`tailscale → headscale → netbird → zerotier → radmin → wireguard → cloudflare → relay`

**Active** = first with a successful probe (`GET :8090/api/health` on the mesh IP, or relay `connected`, or saved Cloudflare hostname). OMO does not stop other tunnels.

`preferredProfile: auto` / **Auto (best live)** uses that rank (mesh live above your WSS relay). `preferredProfile: relay` always starts the relay.

Do **not** expose OBS WebSocket (`4455`) or public `8090`. Do **not** use Tailscale Funnel / ngrok as the product path. Do **not** bundle third-party VPN/tunnel EXEs.

---

## Host / mod flow (relay)

1. Start host app (harden/bind localhost recommended **if** you use WSS relay or Cloudflare to localhost).
2. Settings → Connector → open **Your WSS relay** (or a mesh spoiler) → follow the steps → copy overlay URL.
3. Copy **join code** from the relay spoiler for a remote editor.
4. Moderator remote build → code → PIN.

Manager **probes** relays by RTT; **multiHome** registers the same code on every healthy relay; **failover** promotes the healthiest session ~every 10s.

---

## Self-host for other streamers (OSS)

When publishing on GitHub:

- Each streamer (or community) runs their **own** `relay/` — no SaaS required.
- Ship **empty** default relay list; document `OMO_RELAY_URLS` / Settings.
- Optional later: community EU/RU defaults as an *optional* list only — never a hard dependency.
- License: application + relay intended **MIT** (see root `LICENSE`). Do not ship AGPL tunnel stacks inside the app. Ops-only tools on a VPS (frp/rathole Apache-2.0) are fine if not bundled into Electron.

Threat model: [THREAT-MODEL.md](THREAT-MODEL.md).

---

## WireGuard / Headscale

Power-user only — see sections below and linked docs.

### WireGuard

1. Paste client `.conf` in Settings → Connector → **WireGuard** spoiler → Save WG profile (`data/wireguard/omo.conf`).
2. Import into WireGuard for Windows (or `wg-quick`).
3. Use Direct URL on the tunnel IP (usually `10.x`).

### Headscale

Self-host coordination instead of Tailscale SaaS: [HEADSCALE.md](HEADSCALE.md). ACL TCP **8090**.

---

## OBS plugin

Folder: [`obs-omo-connector/`](../obs-omo-connector/). Three source modes:

| Mode | Who runs the app | How overlay reaches OBS |
|------|------------------|-------------------------|
| **Native** | Same PC as OBS | TCP frames `:8092` (sidecar / frame bridge) |
| **Browser (local)** | Same PC as OBS | Nested CEF → `http://127.0.0.1:8090/obs?t=…` (`mode=browser`, old scenes keep this) |
| **Browser (remote)** | Moderator PC only | Nested CEF → `https://relay/o/{joinCode}/obs` |

### Plugin-only streamer (Browser remote)

1. Moderator starts the host app (harden / bind localhost is fine).
2. Settings → Connector → copy **overlay for streamer** from the **live** spoiler (mesh `http://<ip>:8090/obs?t=…` or relay `https://relay…/o/{code}/obs`).
3. Streamer installs the plugin only, adds **OMO Overlay**, Mode **Browser (remote)**, pastes the URL or code + relay.
4. Overlay HTML, `/uploads`, and `/ws` are proxied by the relay over the host’s outbound WSS (`/o/:code`). Join code is the view secret (TTL); **PIN is still required to edit**. Overlay HTTP does **not** occupy the relay’s editor `client` slot.

Limits: Native does not work plugin-only (no local frame bridge). Large media files traverse the VPS. The moderator program does **not** see the streamer’s OBS WebSocket (`4455`) — only the OMO overlay. Do **not** expose `:8090` to the internet.

Two OMO remote overlays in one OBS with different join codes may share the relay cookie (`omo_room`); use one overlay source per OBS.

## Native compositor

Electron frame-bridge → OBS Native source on `:8092`. Requires the host app (or sidecar) on the **same PC** as OBS. Browser (local) remains the CEF fallback on that PC.

## Russia checklist

- Deploy **two** relays (EU + RU); set `OMO_RELAY_URLS`.
- Enable **multiHome** + **failover**.
- `preferredRegion: ru` when RTT is similar.
- **harden** / `OMO_HARDEN=1` → bind `127.0.0.1` only.
- Probe relays before going live; never open 8090/4455 publicly.

## Security (summary)

- PIN + rate limit after the tunnel is up.
- Join codes expire with room TTL (default 1h). Anyone with the code can **view** the overlay via `/o/{code}` (not edit).
- Relay stores **no** scene data — multiplexes frames only; no payload logging. Overlay HTTP/WS uses the same host tunnel (`ovl-` frames), not the editor client slot.
- Public relay knobs: `OMO_RELAY_MAX_ROOMS`, `OMO_RELAY_RATE_*`, `OMO_RELAY_OVERLAY_RATE_MAX`, `OMO_RELAY_PAIR_ONCE=1` (seal after first **editor** client leaves; overlay still works).
- `/api/obs-plugin/info` is **127.0.0.1 only**.
