# Porthole (Steam port share)

[Porthole - Local Port Sharing](https://store.steampowered.com/app/4963920/Porthole__Local_Port_Sharing/) is a free Steam utility that forwards **only the ports you pick** to Steam friends. It is **not** a VPN: there is no mesh IP. Guests reach the shared service on their own `127.0.0.1`.

OMO does **not** ship Porthole. Install it from Steam on both PCs (Steam must stay logged in).

## When to use

- Moderator runs the full OMO host (scene authority).
- Streamer has OBS + **OMO Overlay** plugin only (**Browser remote**).
- You prefer Steam friends / share codes over Tailscale or Radmin.

## Setup

1. Install Porthole on **moderator** and **streamer** PCs.
2. Keep OMO open on the moderator PC (TCP **8090**).
3. In Porthole on the moderator PC: lobby → share ports → **tcp 8090** at **`127.0.0.1`** (do **not** share a Tailscale `100.x` address).
4. Send the share code or Steam invite to the streamer.
5. Streamer joins and **approves** TCP 8090 → binds on **their** `127.0.0.1:8090`.
6. Settings → Connector → **Porthole** → copy overlay URL (`http://127.0.0.1:8090/obs?t=…`).
7. Streamer OBS → OMO Overlay → **Browser (remote)** → paste → OK.

HTTP and WebSocket use the same TCP port; sharing **8090** is enough.

## Harden

**Harden / bind localhost may stay ON.** Porthole on the host forwards into the local OMO port. That is the opposite of Tailscale mesh (which needs Harden off).

## Who uses which address

| Role | Address |
|------|---------|
| Moderator (Porthole share target) | `127.0.0.1:8090` on the host |
| Streamer (OBS overlay URL) | `http://127.0.0.1:8090/obs?t=…` on the guest after approve |

There is no separate “moderator IP” for the streamer to type into OBS.

## Notes

- Porthole never becomes the Connector **live/active** transport (localhost health would steal active from Tailscale). Always copy the link from the **Porthole** spoiler.
- Viewer token (`?t=`) is still required; copy from Connector so the token is current.
- See also [CONNECTOR.md](CONNECTOR.md) and [TAILSCALE.md](TAILSCALE.md).
