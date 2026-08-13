# Headscale (свой control plane Tailscale)

[English](../HEADSCALE.md)

Используйте, когда SaaS Tailscale недоступен или нужен полный контроль mesh.
OMO по-прежнему ходит обычным HTTP на `host:8090` через CGNAT Headscale (`100.64.0.0/10`) — как у Tailscale.

## Набросок настройки

1. Разверните Headscale на своём VPS (облако EU или RU).
2. Направьте клиенты стримера и модератора на URL Headscale (`headscale` / совместимые с Tailscale клиенты).
3. Сохраните URL в **Настройки → Connector → Headscale** (или `OMO_HEADSCALE_URL` / `data/connector.json`).
4. ACL: разрешите **только TCP 8090** от модератора к стримеру (как в [TAILSCALE.md](TAILSCALE.md)).

Пример политики:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:moderator"],
      "dst": ["tag:streamer:8090"]
    }
  ]
}
```

## С режимом harden в OMO

При `harden` / `OMO_HARDEN=1` / `bindHostOnly` приложение слушает только `127.0.0.1`.
Тогда одного Headscale **мало**, если не:

- оставить `bindHostOnly: false` для прямого/Headscale доступа, **или**
- использовать **Relay** / WireGuard для удалённых модов, а OBS держать на localhost.

Рекомендуемая схема для РФ: **harden + исходящий WSS relay (EU+RU)**; Headscale — по желанию для «как в LAN», когда mesh работает.

## Документы

- [CONNECTOR.md](CONNECTOR.md) — профили транспорта
- [TAILSCALE.md](TAILSCALE.md) — шаблон ACL
