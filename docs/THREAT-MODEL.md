# Threat model — remote connector

Scope: pairing a host app with a remote editor, and optionally serving the OBS overlay through the same relay (`/o/:code`) so a streamer can run **plugin only**.

## Assets

- Scene JSON and uploaded media on the **host** PC (streamer in the classic layout, or **moderator** in the plugin-only layout)
- Moderator PIN / viewer token (`data/.secret`)
- Live overlay control (layers, media transport)
- Join code (short-lived pairing secret; also grants **overlay view** via `/o/{code}`)

## Trust boundaries

| Party | Trust |
|-------|--------|
| Streamer host process | Full scene authority when the app runs on the streamer PC |
| Moderator host process | Full scene authority in the plugin-only layout (app on the moderator PC) |
| Moderator remote app | After PIN: edit overlay only — not arbitrary OS access |
| Streamer OBS plugin (Browser remote) | View overlay only (join code); cannot edit without PIN + editor |
| Relay VPS operator | Sees encrypted WSS metadata + multiplexed tunnel bytes; **must not** persist scene; treat as honest-but-curious |
| Public internet | Can attempt join-code guessing / DoS against relay |

## What a moderator can do

- Open the editor UI proxied to host `:8090` after valid join + PIN
- Change overlay layers (same as a local mod session)

## What a join-code holder can do (overlay)

- Load `https://relay/o/{code}/obs` (OBS CEF / plugin Browser remote) and see the live overlay + media
- Cannot open the editor or change layers without PIN

## What a moderator cannot do (by design)

- Own the canonical scene store (it stays on the host machine)
- Reach OBS WebSocket (`4455`) or other LAN services on the *other* PC (host should use **harden** / bind localhost)
- In plugin-only layout: control the streamer’s OBS scenes — only the OMO overlay
- Bypass PIN rate limits once the HTTP tunnel is up

## Relay assumptions

- Relay is a multiplexer ([`relay/server.js`](../relay/server.js)): rooms by join code, TTL, room cap, per-IP rate limit, plus HTTP/WS overlay proxy `/o/:code` (cookie `omo_room` for SPA absolute paths)
- Overlay requests use `ovl-` frame ids and do not take the editor `client` slot
- No scene storage, no payload logs
- Compromise of relay ≈ active MitM on the tunnel while paired — mitigate with short sessions, trusted VPS, TLS, and rotating join codes (`Start relay` again)

## Abuses we mitigate

| Abuse | Mitigation |
|-------|------------|
| Guess join codes | Short alphabet codes + TTL + rate limit on hello/join **and** overlay HTTP |
| Overlay media DoS | `OMO_RELAY_OVERLAY_RATE_MAX`, body size cap, room TTL |
| Two remote overlays, one OBS | Cookie `omo_room` is Path=/ — one overlay source per OBS |
| Relay room exhaustion | `OMO_RELAY_MAX_ROOMS` |
| Stale code reuse after editor leaves | Optional `OMO_RELAY_PAIR_ONCE=1` seals the **editor** slot; overlay `/o/:code` still works until host leaves or TTL |
| Accidental public 8090 | Harden / `OMO_BIND_LOOPBACK` |
| SaaS ToS / license traps | Self-hosted MIT relay; no ngrok/Funnel as product default |

## Out of scope

- Full E2E encryption inside the mux frame beyond TLS to the relay
- Browser-only moderator without remote Electron (deferred)
- Native plugin-only (no sidecar / frame bridge on the OBS PC)
- Protecting a malicious moderator who already knows the PIN
