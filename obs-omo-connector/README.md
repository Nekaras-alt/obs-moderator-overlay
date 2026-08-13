# OBS OMO Connector plugin

Windows x64 OBS Studio **30+** plugin (v0.5):

- Source **OMO Overlay** — **Mode**: Native (TCP frames), **Browser (local)** (localhost CEF), **Browser (remote)** (moderator host via relay URL / join code)
- Legacy **`omo_overlay_native`** id remains loadable for old scenes but is marked obsolete (hidden from Add Source)
- Dock **OMO Connector** — host status, join code, local/remote overlay URLs, sidecar, frame-bridge (Qt full build only)

## Build

1. Visual Studio 2022 (C++), CMake ≥ 3.28, Qt 5/6 Widgets
2. OBS Studio build tree with `libobs` + `obs-frontend-api` libs

```bat
set OBS_DIR=C:\path\to\obs-studio\build
build-plugin.bat
install-plugin.bat
```

Standalone (no dock, against installed OBS 32.x):

```bat
build-standalone.bat
```

Optional sidecar:

```bat
set SIDECAR_EXE=C:\path\to\OBS-Overlay-Portable.exe
install-plugin.bat
```

## Recommended: Native mode

1. Run host with frame bridge (`host-obs` or `OMO_FRAME_BRIDGE=1`).
2. In OBS add **OMO Overlay** (default Mode = Native).
3. Confirm status shows frames / lag / drops, and dock shows `Frames: on · :8092`.

See [docs/CONNECTOR.md](../docs/CONNECTOR.md) (Phase 4 section).

## Browser (local)

Use when the **OMO program runs on the same PC** as OBS (streamer hosts the scene). Same as the old Browser mode (`mode=browser` in existing scenes).

1. Run the host app on this PC.
2. Source **OMO Overlay** → Mode **Browser (local)**.
3. Or a manual Browser Source: `http://127.0.0.1:8090/obs?t=<viewer-token>`

## Browser (remote)

Use when the **streamer has only this plugin** and the **moderator runs the full program** (scene + media live on the moderator PC).

1. Moderator: Settings → Connector → **Start relay** → **Copy overlay for streamer**.
2. Streamer OBS: **OMO Overlay** → Mode **Browser (remote)**.
3. Paste the full overlay URL, **or** Relay URL (`wss://relay…/connector` or `https://relay…`) plus the join code.
4. Do **not** fall back to localhost — Native still needs a local sidecar.

Remote overlay traffic (page, `/uploads`, WebSocket) goes through the relay. Large videos use relay bandwidth. The moderator app cannot control the streamer’s OBS scenes (port 4455). See [docs/CONNECTOR.md](../docs/CONNECTOR.md).
