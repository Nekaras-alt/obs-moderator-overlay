# Учётные данные / окружение для OBS Moderator Overlay

[English](../CREDENTIALS.md)

Скопируйте в локальный `.env` (в git не попадает). Реальные секреты **не** коммитьте.
Сервер подхватывает `.env` при старте.

## DonationAlerts (живой Centrifugo)

1. Создайте приложение: https://www.donationalerts.com/application/clients
2. Redirect URI точно:
   `http://localhost:8090/api/donations/oauth/da/callback`
3. Env:
```
DA_CLIENT_ID=...
DA_CLIENT_SECRET=...
DA_REDIRECT_URI=http://localhost:8090/api/donations/oauth/da/callback
```
4. В приложении: Донаты → включить очередь → Connect DonationAlerts.

## Twitch (Pastes + Jeetbot)

Консоль Twitch **отклоняет `http://`**. Для регистрации укажите фиктивный HTTPS URL — подключение идёт через **Device Code** (локальный HTTPS не нужен).

1. https://dev.twitch.tv/console/apps → Register
2. **OAuth Redirect URL:** точно `https://localhost` → **Добавить** (Add)
3. Имя, например: `OBS Moderator Overlay`
4. Category: Application Integration (или ближайшее)
5. Client type: Confidential или Public (Device Code работает для обоих)
6. Create → Manage → **New Secret**
7. Env:
```
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_REDIRECT_URI=https://localhost
```
8. В приложении: Twitch Pastes → **Connect Twitch** → страница активации → введите код.

Scopes: `user:write:chat`, `user:read:chat`.

## Spotify

Используются **локальные медиа-клавиши** ОС на ПК стримера (Windows `VK_MEDIA_*` / macOS / playerctl).
Spotify Premium и OAuth Client ID **не** нужны — достаточно запущенного десктопного Spotify.

## Donatex.GG

JWT + SignalR hub `https://donatex.gg/api/controls-hub` (`ReceiveDonation`).
```
DONATEX_API_TOKEN=...
DONATEX_WIDGET_URL=https://donatex.gg/widgets/donations/<id>
DONATEX_AI_WIDGET_URL=https://donatex.gg/widgets/ai-assistant/<id>
```
Опциональный webhook: `POST /api/donations/hooks/donatex` с заголовком `x-donatex-secret`.

## OBS WebSocket

```
OBS_HOST=localhost:4455
OBS_PASSWORD=
```

Оставьте `OBS_PASSWORD` пустым, если в OBS → WebSocket аутентификация выключена.

## Опционально

```
PORT=8090
UPLOAD_MAX_BYTES=209715200
```
