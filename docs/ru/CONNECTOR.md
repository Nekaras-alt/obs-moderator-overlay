# OMO Connector

[English](../CONNECTOR.md)

Удалённый оверлей для OBS Moderator Overlay. В **Настройки → Connector** каждый транспорт — спойлер (по приоритету). Несколько клиентов могут быть подняты сразу; **активный** — первый, кто отвечает на живой probe.

OMO **не** поставляет Tailscale, Headscale, NetBird, ZeroTier, Radmin VPN, Porthole, WireGuard или cloudflared. Их ставите вы сами и принимаете их правила.

## Спойлеры в настройках (приоритет)

1. **Tailscale** — mesh IP `:8090` → плагин Browser (remote). См. [TAILSCALE.md](TAILSCALE.md).
2. **Headscale + клиент Tailscale** — тот же клиент, свой control URL. См. [HEADSCALE.md](HEADSCALE.md).
3. **NetBird**
4. **ZeroTier**
5. **Radmin VPN**
6. **Porthole** — шаринг TCP `8090` через Steam; стример открывает `http://127.0.0.1:8090/obs?t=…`. См. [PORTHOLE.md](PORTHOLE.md).
7. **WireGuard** — вставьте `.conf` в спойлер.
8. **Cloudflare Tunnel** — `cloudflared` на `localhost:8090`; сохраните публичный hostname.
9. **Ваш WSS relay** — join code, Start/Stop, URL оверлея через `relay/` на VPS.

**Дополнительно:** harden / bind localhost, Native frames. Harden делает mesh IP **не live** (так и должно: удалённый OBS не достучится до `:8090`). Для **Porthole** Harden можно оставить **вкл**.

Скопируйте URL оверлея **этого** спойлера в плагин стримера **Browser (remote)**. Viewer token — из `/api/viewer-token` (status bar / Настройки).

Две схемы host:

- **Классика:** власть над сценой на **ПК стримера** (полное приложение или sidecar `host-obs`). Модераторы входят через relay + PIN.
- **Стример только с плагином:** власть над сценой на **ПК модератора** (полное приложение). OBS стримера — плагин **Browser (remote)** и URL оверлея из активного спойлера.

## Ваш WSS relay (без mesh)

1. Разверните [`relay/`](../../relay/) на VPS с TLS (`wss://…/connector`).
2. Настройки → Connector → **Your WSS relay** → вставьте URL → Save → **Start relay**.
3. Скопируйте **join code** (модератору) или **URL оверлея** (стримеру только с плагином).
4. Модератор: remote-сборка Electron → код → PIN host.

Оба пира делают только **исходящие** соединения. Проброс портов дома не нужен.

Профиль Auto (**Auto (best live)**) предпочитает **живой mesh** вашему relay, если оба подняты. `preferredProfile: relay` + `OMO_CONNECTOR_AUTO=1` всё равно стартует WSS relay при загрузке.

---

## Личный деплой за ~15 минут

### 1. VPS + DNS

- Недорогой VPS с публичным IP (EU и/или RU при dual-home).
- DNS `A`/`AAAA`, например `relay.yourdomain` → VPS.

### 2. Relay с TLS (Docker)

На VPS скопируйте папку `relay/`, затем:

```bash
cd relay
export RELAY_DOMAIN=relay.yourdomain
docker compose up -d
```

Проверка: `https://relay.yourdomain/health` → JSON `ok: true`.

Без Docker:

```bash
cd relay && npm install && npm start   # :8787
# Перед ним Caddy/nginx TLS → wss://relay.yourdomain/connector
```

Опционально второй VPS для RU: то же с `relay-ru.yourdomain`.

### 3. Конфиг host-приложения

Env (рекомендуется):

```env
OMO_RELAY_URLS=wss://relay.yourdomain/connector
# dual-home:
# OMO_RELAY_URLS=wss://relay-eu.yourdomain/connector,wss://relay-ru.yourdomain/connector
OMO_PREFERRED_PROFILE=relay
OMO_CONNECTOR_AUTO=1
OMO_BIND_LOOPBACK=1
OMO_HARDEN=1
```

Или Настройки → Connector → **Your WSS relay** → URL → **Save relay URLs** → **Start relay**.

Пример: [`server/connector/connector.example.json`](../../server/connector/connector.example.json) → скопируйте в `data/connector.json`.

### 4. Модератор

```bash
npm run electron:remote
# или portable: OBS-Overlay-Portable.exe --mode=remote
```

Join code → PIN из консоли/tray host.

### 5. Smoke-check

```bash
cd relay && npm run test:e2e
```

---

## Режимы

| Режим | Как запускать | Стример | Модератор |
|-------|---------------|---------|-----------|
| **Host-full** | Portable / `electron .` (по умолчанию) | Полный editor + сервер | Remote-сборка через relay |
| **Host-obs** | `npm run electron:host-obs` | Трей + сервер; плагин OBS | Remote editor через relay |
| **Remote** | `npm run electron:remote` | — | Join code → локальный proxy → PIN |

## Профили транспорта

Спойлеры в настройках — источник истины (тот же порядок, что live rank):

`tailscale → headscale → netbird → zerotier → radmin → wireguard → cloudflare → relay`

**Active** = первый успешный probe (`GET :8090/api/health` на mesh IP, или relay `connected`, или сохранённый hostname Cloudflare). OMO не гасит остальные туннели.

`preferredProfile: auto` / **Auto (best live)** использует этот rank (живой mesh выше вашего WSS relay). `preferredProfile: relay` всегда стартует relay.

**Не** открывайте OBS WebSocket (`4455`) и публичный `8090`. **Не** используйте Tailscale Funnel / ngrok как продуктовый путь. **Не** бандлите чужие VPN/tunnel EXE.

---

## Поток host / мод (relay)

1. Запустите host (harden/bind localhost рекомендуется **если** WSS relay или Cloudflare на localhost).
2. Настройки → Connector → **Your WSS relay** (или mesh-спойлер) → шаги → скопируйте URL оверлея.
3. Скопируйте **join code** из спойлера relay для удалённого редактора.
4. Remote-сборка модератора → код → PIN.

Менеджер **прощупывает** relay по RTT; **multiHome** регистрирует тот же код на каждом здоровом relay; **failover** roughly раз в 10 с выбирает самый здоровый session.

---

## Self-host для других стримеров (OSS)

При публикации на GitHub:

- Каждый стример (или сообщество) крутит **свой** `relay/` — SaaS не обязателен.
- Пустой список relay по умолчанию; документируйте `OMO_RELAY_URLS` / Настройки.
- Позже опционально: community EU/RU defaults только как *опциональный* список — не жёсткая зависимость.
- Лицензия: приложение + relay — **MIT** (см. корневой `LICENSE`). Не тащите AGPL-туннели внутрь приложения. Ops-инструменты на VPS (frp/rathole Apache-2.0) ок, если не бандлятся в Electron.

Модель угроз: [THREAT-MODEL.md](THREAT-MODEL.md).

---

## WireGuard / Headscale

Только для опытных — см. ниже и связанные доки.

### WireGuard

1. Вставьте клиентский `.conf` в Настройки → Connector → **WireGuard** → Save WG profile (`data/wireguard/omo.conf`).
2. Импортируйте в WireGuard for Windows (или `wg-quick`).
3. Direct URL на IP туннеля (обычно `10.x`).

### Headscale

Свой coordination вместо SaaS Tailscale: [HEADSCALE.md](HEADSCALE.md). ACL TCP **8090**.

---

## Плагин OBS

Папка: [`obs-omo-connector/`](../../obs-omo-connector/). Три режима источника:

| Режим | Кто запускает приложение | Как оверлей попадает в OBS |
|-------|--------------------------|----------------------------|
| **Native** | Тот же ПК, что OBS | TCP-кадры `:8092` (sidecar / frame bridge) |
| **Browser (local)** | Тот же ПК, что OBS | Вложенный CEF → `http://127.0.0.1:8090/obs?t=…` (`mode=browser`, старые сцены остаются) |
| **Browser (remote)** | Только ПК модератора | Вложенный CEF → `https://relay/o/{joinCode}/obs` |

Установщик: **OBS-OMO-Connector-Plugin-Setup-*.exe** → `Program Files\obs-studio\obs-plugins\64bit\` (от администратора).

### Стример только с плагином (Browser remote)

1. Модератор запускает host-приложение (harden / bind localhost — нормально).
2. Настройки → Connector → скопировать **overlay for streamer** из **live** спойлера (mesh `http://<ip>:8090/obs?t=…` или relay `https://relay…/o/{code}/obs`).
3. Стример ставит только плагин, добавляет **OMO Overlay**, режим **Browser (remote)**, вставляет URL или код + relay.
4. HTML оверлея, `/uploads` и `/ws` проксирует relay по исходящему WSS host (`/o/:code`). Join code — секрет просмотра (TTL); **для правок всё ещё нужен PIN**. Overlay HTTP **не** занимает слот редактора `client` на relay.

Ограничения: Native не работает «только плагин» (нет локального frame bridge). Крупные медиа идут через VPS. Программа модератора **не** видит WebSocket OBS стримера (`4455`) — только оверлей OMO. **Не** открывайте `:8090` в интернет.

Два remote-оверлея OMO в одном OBS с разными join code могут делить cookie relay (`omo_room`); используйте один источник оверлея на OBS.

## Native-композитор

Electron frame-bridge → Native-источник OBS на `:8092`. Нужно host-приложение (или sidecar) на **том же ПК**, что OBS. Browser (local) остаётся CEF-запасным вариантом на этом ПК.

## Чеклист для РФ

- Два relay (EU + RU); задайте `OMO_RELAY_URLS`.
- Включите **multiHome** + **failover**.
- `preferredRegion: ru`, когда RTT близки.
- **harden** / `OMO_HARDEN=1` → bind только `127.0.0.1`.
- Прощупайте relay перед эфиром; никогда не открывайте 8090/4455 публично.

## Безопасность (кратко)

- PIN + rate limit после поднятия туннеля.
- Join code истекает с TTL комнаты (по умолчанию 1 ч). У кого есть код, может **смотреть** оверлей через `/o/{code}` (не править).
- Relay **не** хранит сцену — только мультиплексирует кадры; без логов payload. Overlay HTTP/WS идёт тем же host-туннелем (`ovl-` frames), не слотом editor client.
- Публичные ручки relay: `OMO_RELAY_MAX_ROOMS`, `OMO_RELAY_RATE_*`, `OMO_RELAY_OVERLAY_RATE_MAX`, `OMO_RELAY_PAIR_ONCE=1` (закрыть после ухода первого **editor**; оверлей ещё работает).
- `/api/obs-plugin/info` — **только 127.0.0.1**.
