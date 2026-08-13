# Credentials / environment for OBS Moderator Overlay

Copy to a local `.env` (gitignored). Never commit real secrets.
Server loads `.env` automatically on start.

## DonationAlerts (live Centrifugo)
1. Create app: https://www.donationalerts.com/application/clients
2. Redirect URI exactly:
   `http://localhost:8090/api/donations/oauth/da/callback`
3. Env:
```
DA_CLIENT_ID=...
DA_CLIENT_SECRET=...
DA_REDIRECT_URI=http://localhost:8090/api/donations/oauth/da/callback
```
4. In the app: Donations → Enable queue → Connect DonationAlerts.

## Twitch (Pastes + Jeetbot)
Twitch Console **rejects `http://`**. For registration use a dummy HTTPS URL — we connect via **Device Code** (no local HTTPS server).

1. https://dev.twitch.tv/console/apps → Register
2. **OAuth Redirect URL:** type exactly `https://localhost` → press **Добавить** (Add)
3. Name: e.g. `OBS Moderator Overlay`
4. Category: Application Integration (or closest)
5. Client type: Confidential (or Public — Device Code works for both)
6. Create → Manage → **New Secret**
7. Env:
```
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_REDIRECT_URI=https://localhost
```
8. In the app: Twitch Pastes → **Connect Twitch** → open activate page → enter the code.

Scopes: `user:write:chat`, `user:read:chat`.


## Spotify
Uses **local OS media keys** on the streamer PC (Windows `VK_MEDIA_*` / macOS / playerctl).
No Spotify Premium and no OAuth Client ID required — just keep the desktop Spotify app running.

## Donatex.GG
Uses JWT + SignalR hub `https://donatex.gg/api/controls-hub` (`ReceiveDonation`).
```
DONATEX_API_TOKEN=...
DONATEX_WIDGET_URL=https://donatex.gg/widgets/donations/<id>
DONATEX_AI_WIDGET_URL=https://donatex.gg/widgets/ai-assistant/<id>
```
Optional webhook fallback: `POST /api/donations/hooks/donatex` with header `x-donatex-secret`.

## OBS WebSocket
```
OBS_HOST=localhost:4455
OBS_PASSWORD=
```
Leave `OBS_PASSWORD` empty if OBS → WebSocket has authentication disabled.

## Optional
```
PORT=8090
UPLOAD_MAX_BYTES=209715200
```
