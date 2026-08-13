# OMO Connector Relay

Outbound WSS multiplex for host ↔ remote moderator, plus **public overlay HTTP/WS** at `/o/:code` for streamer OBS plugin **Browser (remote)**. **No scene storage.**

Primary remote path for OBS Moderator Overlay (join code). See [docs/CONNECTOR.md](../docs/CONNECTOR.md) and [docs/THREAT-MODEL.md](../docs/THREAT-MODEL.md).

## Quick start

```bash
npm install
npm start
# listen :8787 path /connector
```

Put TLS (Caddy/nginx) in front so clients use `wss://your.domain/connector` and OBS CEF uses `https://your.domain/o/{joinCode}/obs`.

### Docker + Caddy (recommended personal deploy)

```bash
export RELAY_DOMAIN=relay.yourdomain
docker compose up -d
```

App config: `OMO_RELAY_URLS=wss://relay.yourdomain/connector`

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8787` | Listen port |
| `OMO_RELAY_PATH` | `/connector` | WebSocket path |
| `OMO_RELAY_TTL_MS` | `3600000` | Room TTL (1h) |
| `OMO_RELAY_MAX_ROOMS` | `500` | Concurrent room cap |
| `OMO_RELAY_RATE_WINDOW_MS` | `60000` | Rate-limit window |
| `OMO_RELAY_RATE_MAX` | `30` | hello/join attempts per IP per window |
| `OMO_RELAY_OVERLAY_RATE_MAX` | `300` | overlay HTTP requests per IP per window |
| `OMO_RELAY_PAIR_ONCE` | `0` | `1` = seal room after first **editor** client disconnects (public relays); overlay proxy still works |

Health: `GET /health` → `{ ok, rooms, maxRooms, overlay: '/o/:code', … }`.

Overlay: `GET /o/{joinCode}/obs` (and `/uploads`, `/ws` via cookie `omo_room`). Join code holders can **view** the overlay; editing still needs PIN + editor client.

## Test

```bash
npm run test:e2e
```

## License

MIT (same as the main project).
