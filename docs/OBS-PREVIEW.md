# OBS Preview (MJPEG + optional WHEP)

Moderators can open **Panels → OBS Preview** to watch the current OBS Program
(or Preview layout target) inside the editor.

## Default: MJPEG screenshots

No extra software. While the preview window is open, the server asks OBS for
JPEG frames via `GetSourceScreenshot` (~4 FPS, width 960).

| Env | Default | Meaning |
|-----|---------|---------|
| `OBS_PREVIEW_FPS` | `4` | Frames per second (1–10) |
| `OBS_PREVIEW_WIDTH` | `960` | Max width |
| `OBS_PREVIEW_QUALITY` | `40` | JPEG quality |

The loop **stops** when nobody has the preview open (saves CPU).

OBS WebSocket stays on `127.0.0.1:4455`. Moderators only talk to the app on
Tailscale port **8090**.

## Faster path: MediaMTX + OBS WHIP (optional)

For lower latency, run [MediaMTX](https://github.com/bluenviron/mediamtx) on
the streamer PC and point OBS **WHIP Output** at it. Then set:

```env
OBS_PREVIEW_WHEP_URL=http://127.0.0.1:8889/obs-preview/whep
```

### Suggested MediaMTX snippet

```yml
paths:
  obs-preview:
    source: publisher
```

1. Start MediaMTX on the streamer machine.
2. In OBS: add WHIP Output → `http://127.0.0.1:8889/obs-preview/whip` (check MediaMTX docs for exact WHIP path).
3. Set `OBS_PREVIEW_WHEP_URL` to the matching WHEP URL.
4. Restart the overlay server. OBS Preview prefers WHEP; if it fails, it falls back to MJPEG.

### Tailscale note

If moderators cannot reach `127.0.0.1` on the streamer box, either:

- Proxy WHEP through the app later, or
- Put the streamer’s Tailscale IP in `OBS_PREVIEW_WHEP_URL` and open that port in Tailscale ACL (in addition to 8090). Prefer keeping ACL minimal — MJPEG on 8090 needs no extra ports.

## Layout bounds

**View → OBS bounds** draws live source rectangles on the canvas (rotation,
names, groups). They update from obs-websocket events and do **not** appear in
the OBS Browser Source overlay sent to viewers.
