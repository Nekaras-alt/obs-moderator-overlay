# Tailscale ACL для OBS Moderator Overlay

[English](../TAILSCALE.md)

Откройте модераторам **только TCP 8090**. **Не** используйте Tailscale Funnel для этого приложения.

Relay / WireGuard / dual-mode Electron — см. **[CONNECTOR.md](CONNECTOR.md)**.

## Рекомендуемый ACL

```json
{
  "tagOwners": {
    "tag:streamer": ["autogroup:admin"],
    "tag:moderator": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:moderator"],
      "dst": ["tag:streamer:8090"]
    },
    {
      "action": "accept",
      "src": ["tag:streamer"],
      "dst": ["tag:streamer:*"]
    }
  ]
}
```

## Чеклист

1. Тег машины стримера `tag:streamer`, устройства мода — `tag:moderator`.
2. Брандмауэр Windows: входящий 8090 только на интерфейсе Tailscale.
3. OBS WebSocket на `127.0.0.1:4455` (никогда `0.0.0.0`).
4. Модератор открывает `http://100.x.x.x:8090/` и вводит PIN из консоли сервера.
5. Browser Source OBS (или источник плагина **OMO Overlay**) на ПК стримера: `http://localhost:8090/obs?t=<viewer-token>`.
6. Мульти-алерты донатов: `http://localhost:8090/multi-alerts?t=<viewer-token>`.
7. Живые границы + превью: подключите OBS в Настройках / OBS Sources; **Вид → Границы OBS**; опционально **Панели → OBS Preview** (см. [OBS-PREVIEW.md](OBS-PREVIEW.md)).

## Альтернативы

| Инструмент | Когда |
|------------|--------|
| **OMO WSS Relay** | Tailscale заблокирован/нестабилен (особенно RU) — [CONNECTOR.md](CONNECTOR.md) |
| **Porthole** | Друзья Steam / share-код; стример на localhost — [PORTHOLE.md](PORTHOLE.md) |
| Headscale | Свой control plane Tailscale — [HEADSCALE.md](HEADSCALE.md) |
| WireGuard к VPS | Альтернатива mesh; профиль в Настройки → Connector |
| Cloudflare Tunnel + Access | У мода нет Tailscale; нужен OTP (в РФ может быть недоступен) |
| ngrok | Только короткие демо |
| RustDesk / RDP | Никогда для доступа «только к оверлею» |
