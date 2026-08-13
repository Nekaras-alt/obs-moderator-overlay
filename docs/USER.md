# User guide (1.0)

## Roles

| Who | App mode | What they do |
|-----|----------|----------------|
| Streamer (classic) | default **host** | Runs the server on the OBS PC, creates PIN, Native or Browser (local) plugin |
| Streamer (plugin only) | — | OBS + OMO plugin **Browser (remote)**; pastes overlay URL from the moderator |
| Moderator (host for plugin-only) | default **host** | Runs the program; scene + media live here; copies overlay URL for the streamer |
| Moderator (local) | same host URL | Enters PIN, edits the overlay |
| Moderator (remote editor) | `--mode=remote` | Join code → then PIN (classic: host is on the streamer PC) |
| OBS-only sidecar | `--mode=host-obs` | Tray + overlay frames, no editor window |

## First PIN

On the **first** start (empty profile) there is no PIN until the streamer types one (and confirms it). Tokens for the OBS Browser Source are created automatically.

After the PIN, a short **tour** highlights Layers, the canvas, Inspector, and the rest. Skip it anytime. Open the handbook later with the **?** button in the top bar (`Ctrl+Shift+/`). Replay the tour from the handbook.

- Share the PIN with trusted mods only.
- Change it in **Settings → Security** without deleting `data/.secret`.
- Deleting `data/.secret` resets setup (new viewer token → update the OBS Browser Source URL).

Installed Windows builds keep the PIN under the Electron profile (survives **reinstall** of Setup.exe unless you uninstall with “delete app data”, or wipe the folder yourself):

- `%APPDATA%\obs-moderator-overlay\`
- or `%APPDATA%\OBS Moderator Overlay\`

“Install for all users” only changes `Program Files` vs per-user install dir — the PIN is still **per Windows user** in AppData, not in Program Files.

To re-test the welcome / Create PIN screen:

1. Quit the app completely (tray too).
2. Uninstall OBS Moderator Overlay (new builds remove AppData on uninstall), **or** delete the AppData folder above.
3. Launch again.

Do **not** put a real `.secret` into `build/portable-seed` or public zips.

## OBS OMO Connector plugin

`build-release.bat` can bundle `omo-connector.dll` when `deps\obs-studio` is present. The NSIS Setup shows a checkbox **Install OBS OMO Connector plugin** (default on). If checked, files go to:

`%AppData%\obs-studio\plugins\omo-connector\`

Restart OBS, then add source **OMO Overlay**. Modes:

- **Native** — local program / sidecar paints frames (`:8092`).
- **Browser (local)** — local program; nested CEF to `127.0.0.1:8090` (old `mode=browser` scenes stay here).
- **Browser (remote)** — no program on the streamer PC; paste the moderator’s overlay URL or join code + relay.

A plain OBS Browser Source still works without the plugin (`http://127.0.0.1:8090/obs?t=…` on the host PC).

## OBS Browser Source

1. Width **1920**, height **1080**.
2. **Same PC as the app:** URL from the app after PIN setup (`/obs?t=…`), localhost.
3. **Plugin-only streamer:** moderator copies **overlay URL** from Settings → Connector (live spoiler). Mesh: `http://<ip>:8090/obs?t=…`. Own relay: `https://relay…/o/{code}/obs`. Streamer uses plugin **Browser (remote)**.
4. Optional: “Refresh browser when scene becomes active”.

Native overlay and plugin modes: [obs-omo-connector/README.md](../obs-omo-connector/README.md). Remote pairing: [CONNECTOR.md](CONNECTOR.md).

## Canvas cheatsheet

- Wheel: zoom toward cursor
- Space + drag or middle mouse: pan
- Ctrl+0 Fit, Ctrl+1 100%
- Shift + move: lock axis; Alt + move: ignore snap
- Right-click media: Aspect ratio

## Remote mods

See [CONNECTOR.md](CONNECTOR.md). Settings → Connector lists Tailscale, Headscale, NetBird, ZeroTier, Radmin VPN, WireGuard, Cloudflare Tunnel, and your WSS relay. OMO does not bundle those clients. Never port-forward 8090/4455.

## Optional integrations

Twitch, DonationAlerts, Donatex: [CREDENTIALS.md](CREDENTIALS.md).
