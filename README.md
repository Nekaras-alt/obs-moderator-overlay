# OBS Moderator Overlay

A remote-controlled overlay system for OBS Studio. A moderator (you, or a
trusted mod) arranges pictures, GIFs, video, audio and YouTube clips on a
1920×1080 stage from a web UI; OBS displays the result via a **Browser Source**.
Everything the moderator does syncs live to OBS over WebSocket — including
video/audio transport (play/pause/seek), which mirrors to the stream.

> **Status:** Core editor through M5 is implemented. The moderator can drag-drop
> and transform all media types (image/GIF/video/audio/YouTube), sync media
> transport to OBS, read OBS-native source boundaries, and use presets + trash.
> This README documents what runs today and how to set it up.

---

## Quick start (on the OBS machine)

1. Install [Node.js 18+](https://nodejs.org) (v20+ recommended).
2. Double-click **`start.bat`**, or in a terminal:
   ```cmd
   npm install
   npm run build
   node server\index.js
   ```
3. The console prints a **PIN** and an **OBS Browser Source URL**. The editor
   opens automatically at `http://localhost:8090/`.
4. In OBS: **Sources → add Browser**, set it to the printed `/obs?t=...` URL,
   width **1920**, height **1080**. Check "Refresh browser when scene becomes
   active" if you like.
5. Open the editor, enter the PIN, add a layer, drag it — watch it move live
   in OBS. That's the sync proof.

## Remote moderator via Tailscale

You and your moderator are both on Tailscale; your machine is `100.111.250.15`.

- **Moderator (her browser):** open `http://100.111.250.15:8090/` and enter the PIN.
- **OBS Browser Source:** `http://100.111.250.15:8090/obs?t=<viewer-token>`
  (the viewer token is printed in the server console, and also shown in the
  editor's status bar with a Copy button).

The connection is gated by the PIN; the viewer token in the `/obs` URL lets OBS
render read-only without a human login.

> Tailscale traffic is already end-to-end encrypted, so plain HTTP is fine
> inside the tailnet. Don't expose port 8090 to the public internet.

## Where data lives

- `data/scene.json` — the current scene (autosaved every 30 s + on exit).
- `data/scene.bak.json` — last good save (used for crash recovery).
- `data/.secret` — PIN + viewer token (generated on first run; delete to reset).
- `uploads/` — uploaded media files (used from M1 onward).

Crash recovery: on startup the server loads `scene.json`, falling back to
`.bak.json` if the main file is corrupt, then a fresh scene if both are gone.
Deleted layers go to a Trash list (restorable) instead of being destroyed.

## Media transport sync

Play, pause, seek, rewind, and stop commands for **video, audio, and YouTube**
layers are sent through a dedicated **media-ctrl** WebSocket channel. The
server fans each command out to every connected client (editor + OBS) without
persisting it, so:

- The editor preview and the OBS stream always agree on playback state.
- Transport commands never pollute `scene.json` via autosave — they're ephemeral.
- A nonce per command ensures repeat commands (e.g. seek to the same position
  twice) are detected and re-applied by the renderer.

All media starts **paused** in both the editor and OBS — including YouTube
embeds and audio. Nothing autoplays, so the moderator decides exactly when
playback rolls and the two sides never drift apart (the old behavior had OBS
autoplay YouTube muted while the editor's sound-on autoplay was blocked by the
browser, leaving one side "ready" and the other already playing).

YouTube layers automatically **buffer** the opening segment on add (the
`youtube.preload` flag, on by default). This forces the player to fetch the
head of the video once it loads, so the moderator's first Play starts
smoothly instead of stuttering while the stream catches up.

- **VideoControls** — transport bar (play/pause + scrub seek + timecode).
- **YoutubeControls** — same transport bar; YouTube is driven over the embed's
  `postMessage` JSON API (`enablejsapi=1`), translating play/pause/seek into
  `playVideo`/`pauseVideo`/`seekTo`.
- **AudioControls** — play/pause/stop/rewind buttons. The on-stage ♪ audio card
  is rendered to the audience too (read-only progress bar, no controls on the
  stream), and its playback mirrors the moderator's transport.

### YouTube Manager

Every YouTube layer on the stage gets its own **floating control window**
(`YoutubeManager`) in the bottom-left corner of the editor. These windows:

- Appear automatically when a YouTube video is added and disappear when it's
  deleted from the workspace.
- Show live transport (play/pause button + progress strip + timecode) in the
  header for quick access without expanding.
- Expand to full controls (transport bar + URL, start-at, buffer toggle,
  playlist) when clicked.
- Can be **dragged** anywhere by their header, **minimized** to a slim
  progress-only bar, and **collapsed in bulk** via the master "YouTube"
  toolbar button (essential when juggling many clips).
- A ◎ button focuses the corresponding layer on the stage canvas.


## Presets & Trash

**Presets** (Toolbar → 📋 Presets) snapshot the current layer arrangement under
a name and restore it later — handy for "Starting Soon" / "BRB" / "Ending"
setups. Loading a preset replaces the canvas; the previous contents go to Trash
and stay recoverable.

**Trash** (Toolbar → 🗑 Trash) holds every deleted or cleared layer for restore,
with a one-click purge.

## Development

```cmd
npm run dev
```
Runs the Vite dev server (HMR) on :5173 and the Node server on :8090 in
parallel; Vite proxies `/ws`, `/api`, `/uploads` to the server. Edit the Vue
files and the editor hot-reloads; OBS keeps its persistent `/obs` connection.

## Architecture (short version)

- **Authoritative backend** (Node + `ws`) holds the canonical scene. The editor
  sends *ops*; the server validates + writes + broadcasts the full scene to
  every client (editor sessions and OBS). This guarantees all viewers agree.
- **Logical 1920×1080 stage.** Every layer's position is in stage pixels. The
  editor scales the stage to fit the moderator's screen; OBS renders it 1:1.
  Identical coordinates ⇒ identical output.
- **Shared `StageRenderer`.** One Vue component renders the layers; the editor
  wraps it with overlay chrome, OBS uses it bare with a transparent background.
- **Media transport sync.** A dedicated `media-ctrl` WebSocket message type
  carries play/pause/seek commands from the moderator. The server fans them out
  to all clients without persisting, so editor and OBS stay in lock-step.
- **"Show to audience" toggle.** Each layer has `audienceVisible`. The editor
  always shows the layer; OBS shows it only when `audienceVisible` is true —
  this is how a moderator preps something hidden, then reveals it to the stream.

## Roadmap (milestones)

- **M0 ✅** Sync core: backend, PIN auth, autosave/restore/trash, live editor↔OBS.
- **M1 ✅** StageRenderer for all media types, drag-drop + uploads, full transform,
  rich Layers panel (folders, color labels, reorder, search).
- **M2 ✅** Canvas power: grid, snap (grid/center/edges), distance display, rulers,
  guides, wheel-zoom, middle-mouse pan, minimap.
- **M3 ✅** Video (loop/speed/volume/fragment/transport) + YouTube (start-at,
  auto-hide, playlists, preload) + audio transport sync.
- **M5 ✅** OBS integration: read native source boundaries via obs-websocket,
  Safe Area, browser-source rect overlay.
- **Future** Themes, packaging, viewer submissions.
