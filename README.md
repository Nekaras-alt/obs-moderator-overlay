# OBS Moderator Overlay

**Version 1.0** — MIT.

[Русский](#русский) · [English](#english)

---

## Русский

Удалённый оверлей для [OBS Studio](https://obsproject.com/). Вы (или доверенный модератор) раскладываете картинки, GIF, видео, аудио, YouTube, стикеры и браузер-виджеты на сцене **1920×1080**. OBS показывает ту же сцену в эфире через **Browser Source** (или опциональный нативный плагин).

- Редактор в стиле Fluent / WinUI (тёмная/светлая тема, RU/EN)
- Живая синхронизация: перемещение, размер, play/pause/seek
- SoundPad, очередь донатов, помощники Twitch, connector для удалённых модераторов

Лицензия: [LICENSE](LICENSE). Модель угроз: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Пошаговое использование: [docs/USER.md](docs/USER.md).

### Стример (ПК с OBS)

#### Установщик (рекомендуется)

1. Скачайте **OBS-Moderator-Overlay-Setup-1.0.0.exe** из [Releases](../../releases).
2. Установите и запустите **OBS Overlay**.
3. **Первый запуск:** создайте PIN (4–16 букв/цифр). Делитесь PIN только с модераторами.
4. В OBS: добавьте **OMO Overlay** (плагин) **Native** или **Browser (local)**, либо Browser Source 1920×1080 с URL оверлея из приложения. На том же ПК предпочтительно `http://127.0.0.1:8090/obs?t=…`.

**Только плагин (без приложения на ПК стримера):** модератор запускает полную программу как host, копирует **overlay for streamer**, вы вставляете его в плагин **Browser (remote)**. См. [docs/CONNECTOR.md](docs/CONNECTOR.md).

#### Portable

Распакуйте **OBS-Moderator-Overlay-1.0.0-win-x64-portable.zip** и запустите `OBS-Moderator-Overlay-Portable.exe`. Тот же PIN при первом запуске. Установка не нужна.

#### Из исходников

Нужен [Node.js 20+](https://nodejs.org).

```cmd
npm install
npm run build
node server\index.js
```

Или дважды щёлкните `start.bat`. Откройте http://localhost:8090/ и создайте PIN.

### Модератор

**Тот же ПК, что у стримера:** откройте URL редактора, введите **тот же PIN**.

**Удалённый редактор (классика):** стример поднимает relay и присылает **join code**. Вы запускаете `--mode=remote`, вводите код, затем PIN.

**Вы — host, у стримера только плагин:** запустите приложение как host, **Start relay**, скопируйте **overlay for streamer**. Стример использует плагин **Browser (remote)**. Вы редактируете локально; он только показывает оверлей.

См. [docs/CONNECTOR.md](docs/CONNECTOR.md).

**Не открывайте** порт **8090** и OBS WebSocket **4455** в публичный интернет. PIN даёт полный доступ к редактору.

Смена PIN: **Настройки → Безопасность**.

### Сборка релиза для GitHub (для мейнтейнеров)

В Windows, из корня репозитория:

```cmd
build-release.bat
```

Результат в `release\github\`:

| Файл | Для чего |
|------|----------|
| `OBS-Moderator-Overlay-Setup-<version>.exe` | NSIS-установщик |
| `OBS-Moderator-Overlay-<version>-win-x64-portable.zip` | Portable (без `.env`) |

Тег `v1.0.0` запускает [.github/workflows/release.yml](.github/workflows/release.yml). Dev portable: `build-portable.bat`. Подробности: [docs/BUILD.md](docs/BUILD.md).

### Данные на диске

- `data/scene.json` — сцена (автосохранение + `.bak` при сбоях)
- `data/.secret` — PIN и viewer token (**никогда не коммитьте**)
- `uploads/` — медиа и кэш эмоутов

Скопируйте [`.env.example`](.env.example) в `.env` для опциональных ключей Twitch / DonationAlerts / Donatex. См. [docs/CREDENTIALS.md](docs/CREDENTIALS.md).

### Возможности (1.0)

- Холст: зона вне сцены, snap, линейки, lock пропорций, панорама Space/СКМ
- Слои: image/GIF/video/audio/YouTube/text/timer/counter/browser/ChatIS
- Стикеры (7TV / BTTV / FFZ), SoundPad, пресеты, корзина
- Синхронизация YouTube timeline (редактор ↔ OBS)
- Очередь донатов (DonationAlerts / Donatex) при настройке
- Опциональный плагин OBS (`obs-omo-connector/`)

Заметки / research: [docs/HORIZON.md](docs/HORIZON.md).

---

## English

A remote-controlled overlay for [OBS Studio](https://obsproject.com/). You (or a trusted moderator) arrange images, GIFs, video, audio, YouTube, stickers, and browser widgets on a **1920×1080** stage. OBS shows the same scene live via a **Browser Source** (or the optional native plugin).

- Fluent / WinUI-style editor (dark/light, RU/EN)
- Live sync: move, resize, play/pause/seek
- SoundPad, donations queue, Twitch helpers, connector for remote mods

License: [LICENSE](LICENSE). Threat model: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Step-by-step usage: [docs/USER.md](docs/USER.md).

### Streamer (OBS PC)

#### Installer (recommended)

1. Download **OBS-Moderator-Overlay-Setup-1.0.0.exe** from [Releases](../../releases).
2. Install, launch **OBS Overlay**.
3. **First launch:** create a PIN (4–16 letters/digits). Share that PIN only with your mods.
4. In OBS: add **OMO Overlay** (plugin) **Native** or **Browser (local)**, or a Browser Source 1920×1080 with the overlay URL from the app. Prefer `http://127.0.0.1:8090/obs?t=…` on the same PC.

**Plugin only (no app on the streamer PC):** the moderator runs the full program as host, copies **overlay for streamer**, and you paste it into plugin **Browser (remote)**. See [docs/CONNECTOR.md](docs/CONNECTOR.md).

#### Portable

Unzip **OBS-Moderator-Overlay-1.0.0-win-x64-portable.zip** and run `OBS-Moderator-Overlay-Portable.exe`. Same first-launch PIN flow. No install required.

#### From source

Needs [Node.js 20+](https://nodejs.org).

```cmd
npm install
npm run build
node server\index.js
```

Or double-click `start.bat`. Open http://localhost:8090/ and create the PIN.

### Moderator

**Same PC as the streamer:** open the editor URL, enter the **same PIN**.

**Remote editor (classic):** the streamer starts a relay and sends a **join code**. You run `--mode=remote`, enter the code, then the PIN.

**You host, streamer has plugin only:** run the app as host, **Start relay**, copy **overlay for streamer**. The streamer uses plugin **Browser (remote)**. You edit locally; they only display the overlay.

See [docs/CONNECTOR.md](docs/CONNECTOR.md).

Do **not** expose port **8090** or OBS WebSocket **4455** to the public internet. The PIN is full editor access.

Change PIN later: **Settings → Security**.

### Build a GitHub release (maintainers)

On Windows, from the repo root:

```cmd
build-release.bat
```

Produces `release\github\`:

| File | For |
|------|-----|
| `OBS-Moderator-Overlay-Setup-<version>.exe` | NSIS installer |
| `OBS-Moderator-Overlay-<version>-win-x64-portable.zip` | Portable (no `.env`) |

Tag `v1.0.0` to run [.github/workflows/release.yml](.github/workflows/release.yml). Dev portable: `build-portable.bat`. Details: [docs/BUILD.md](docs/BUILD.md).

### Data on disk

- `data/scene.json` — scene (autosave + crash recovery via `.bak`)
- `data/.secret` — PIN + viewer token (**never commit**)
- `uploads/` — media and emote cache

Copy [`.env.example`](.env.example) to `.env` for optional Twitch / DonationAlerts / Donatex keys. See [docs/CREDENTIALS.md](docs/CREDENTIALS.md).

### Features (1.0)

- Canvas: off-stage workspace, snap, rulers, aspect lock, Space/MMB pan
- Layers: image/GIF/video/audio/YouTube/text/timer/counter/browser/ChatIS
- Stickers (7TV / BTTV / FFZ), SoundPad, presets, trash
- YouTube timeline sync (editor ↔ OBS)
- Donations queue (DonationAlerts / Donatex) when configured
- Optional OBS connector plugin (`obs-omo-connector/`)

Horizon / research notes: [docs/HORIZON.md](docs/HORIZON.md).
