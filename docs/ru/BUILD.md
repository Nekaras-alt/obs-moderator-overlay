# Сборка OBS Moderator Overlay

[English / исходник](../BUILD.md)

Инструкция по сборке на **Windows** (основная платформа проекта).

## Требования

| Компонент | Зачем |
|-----------|--------|
| [Node.js 20+](https://nodejs.org) (LTS) + npm в `PATH` | UI, сервер, Electron |
| Git (желательно) | клон репозитория |
| Visual Studio 2022 (C++), CMake ≥ 3.28, Qt 5/6 | **только** для OBS-плагина |
| OBS Studio 30+ build/SDK (`OBS_DIR`) | **только** для OBS-плагина |

```cmd
node -v
npm -v
```

---

## 1. Первый запуск (зависимости)

В корне репозитория:

```cmd
cd path\to\OBS-Moderator-Overlay
npm install
```

Для relay (отдельный VPS-сервис):

```cmd
cd relay
npm install
cd ..
```

---

## 2. Режим разработки (HMR)

Два процесса: Vite `:5173` + сервер `:8090`.

```cmd
npm run free-ports
npm run dev
```

- Редактор: http://localhost:5173/ (проксирует API/WS на 8090)
- Или сразу прод-сборка клиента и сервер: см. §3

Остановить: `Ctrl+C`. Порты можно освободить: `npm run free-ports`.

---

## 3. Production без Electron (только Node)

Собрать Vue-клиент в `dist/` и поднять Express:

```cmd
npm run build
npm start
```

Эквивалент одной командой:

```cmd
npm run serve
```

- Редактор: http://localhost:8090/
- OBS Browser Source: URL из консоли / status bar (`/obs?t=…`)
- При **первом** запуске приложение просит **создать PIN** (не печатает случайный). Потом PIN в консоли / tray.

---

## 4. Electron (локально, без инсталлятора)

Сначала нужен `dist/`:

```cmd
npm run build
npm run electron
```

Или одной командой (сборка + запуск):

```cmd
npm run electron:dev
```

### Автообновление (electron-updater)

Упакованные Electron-сборки вызывают `checkForUpdates` при готовности (только лог + balloon в трее; без авто-скачивания). Если `electron-updater` нет в `node_modules`, проверка пропускается с записью в консоль. Для реальных обновлений публикуйте релизы через electron-builder + GitHub/generic feed.

### Режимы запуска

| Режим | Команда | Назначение |
|-------|---------|------------|
| **host** (стример) | `npm run electron` | Полный editor + сервер |
| **remote** (мод) | `npm run electron:remote` | Join code → proxy → PIN |
| **host-obs** | `npm run electron:host-obs` | Без окна editor, tray + frame bridge |

Через флаги:

```cmd
electron . --mode=host
electron . --mode=remote
electron . --mode=host-obs
```

Полезные переменные окружения (рядом с exe или в `.env`):

```env
PORT=8090
OMO_FRAME_BRIDGE=1
OMO_FRAME_PORT=8092
OMO_RELAY_URLS=wss://relay-eu.example/connector,wss://relay-ru.example/connector
OMO_HARDEN=1
OMO_CONNECTOR_AUTO=1
OBS_HOST=127.0.0.1:4455
OBS_PASSWORD=
```

---

## 5. Сборка релиза для GitHub (NSIS + zip)

Канон для публичных файлов:

```cmd
build-release.bat
```

Артефакты: `release\github\` — Setup.exe и portable `.zip` **без** `.env`.

Dev portable (без установщика):

```cmd
build-portable.bat
```

**Полная сборка (portable + OBS-плагин + sidecar):**

```cmd
set OBS_DIR=C:\path\to\obs-studio\build
build-full.bat
```

Или сохраните путь в `obs-omo-connector\OBS_DIR.txt` (см. `OBS_DIR.txt.example`).

| Флаг | Действие |
|------|----------|
| `/skip-plugin` | только portable (+ `release\full` с docs/relay) |
| `/no-install` | не копировать плагин в `Program Files\obs-studio\obs-plugins` |
| `/plugin-full` | собрать плагин через `OBS_DIR` + VS CMake (не standalone) |
| `/nopause` | без `pause` в конце |

По умолчанию плагин собирается через **`obs-omo-connector\build-standalone.bat`** (нужны `deps\obs-studio` + установленный OBS).

Лог каждого прогона: `release\logs\full-build-*.log`.

Результат полной сборки:

- `release\portable\` — exe + папка `omo-connector\`
- `release\omo-plugin\` — DLL + layout для Program Files
- `release\full\` — готовый пакет «приложение + плагин + relay + доки» (удобно заархивировать)

Он делает: free-ports → `npm install` → иконки / build-info → `vite build` → `electron-builder --win portable` → **`npm run verify:packaged`**.

### Что входит в сборку автоматически (не правь bat под каждую фичу)

| Меняешь | Как попадает в exe |
|---------|-------------------|
| Vue / CSS / i18n в `client/` | `vite build` → `dist/**` |
| `server/`, `electron/`, `shared/` | globs в `package.json` → `build.files` |
| Новый runtime-файл **вне** этих папок | добавь путь в `package.json` `build.files` |

После упаковки [`scripts/verify-packaged.mjs`](../../scripts/verify-packaged.mjs) сравнивает дерево `server|electron|shared` с `release\win-unpacked\resources\app` и падает, если чего-то нет. UI-файлы поимённо не перечисляются — достаточно свежего `dist/assets`.

Повторная проверка вручную:

```cmd
npm run verify:packaged
```

Вручную только portable:

```cmd
npm install
npm run dist:portable
```

### Куда кладётся результат

- `release\portable\` или `release\` — файл вида **`OBS-Overlay-Portable-*.exe`**
- Рядом может появиться шаблон `.env`

Запуск: двойной клик по exe (не держите параллельно `npm run dev` на тех же портах).

NSIS/обычный win-дистрибутив:

```cmd
npm run dist
```

Артефакты смотрите в папке `release\`.

### Билды под роли

| Кому | Что отдать | Как запускать |
|------|------------|---------------|
| Стример (полный UI) | portable exe | как есть |
| Стример (только OBS sidecar) | тот же exe | ярлык с `--mode=host-obs` или `OMO_MODE=host-obs` |
| Модератор (удалённо через relay) | тот же exe | `--mode=remote` |

---

## 6. Relay (VPS)

На сервере с публичным HTTPS/`wss`:

```cmd
cd relay
npm install
set PORT=8787
npm start
```

Перед приложением — Caddy/nginx с TLS, путь `/connector`.  
В приложении: `OMO_RELAY_URLS=wss://ваш-домен/connector`  
Подробнее: [CONNECTOR.md](CONNECTOR.md).

---

## 7. OBS-плагин (опционально)

Нужен **собранный OBS Studio** (или SDK) с `libobs` и `obs-frontend-api`.

```cmd
cd obs-omo-connector
set OBS_DIR=C:\path\to\obs-studio\build
build-plugin.bat
```

Установка в OBS (нужны права администратора):

```cmd
set SIDECAR_EXE=C:\path\to\OBS-Overlay-Portable-xxxx.exe
install-plugin.bat
```

Или отдельный Setup: `build-plugin-installer.bat` → `release\github\OBS-OMO-Connector-Plugin-Setup-*.exe`.

Плагин попадёт в:

`C:\Program Files\obs-studio\obs-plugins\64bit\omo-connector.dll`  
и locale в `C:\Program Files\obs-studio\data\obs-plugins\omo-connector\locale\`

Перезапустите OBS → источник **OMO Overlay**, режимы Native / Browser (local) / Browser (remote).

См. [obs-omo-connector/README.md](../../obs-omo-connector/README.md).

---

## 8. Быстрый чеклист «всё с нуля»

```cmd
:: 1) Зависимости
npm install

:: 2) Portable для стримера
build-portable.bat

:: 3) (Опционально) Relay на VPS
cd relay && npm install && npm start

:: 4) (Опционально) OBS plugin
cd obs-omo-connector
set OBS_DIR=C:\obs-studio\build
build-plugin.bat
install-plugin.bat
```

---

## Частые проблемы

| Симптом | Что сделать |
|---------|-------------|
| `EADDRINUSE` / порт 8090 занят | `npm run free-ports`, закрыть старый Electron/node |
| Пустой/старый UI в portable | Пересобрать `build-portable.bat`, не смешивать с `npm run dev` |
| Нет иконки в tray | Должен существовать `build\icon.ico` (бат генерирует через `build\gen-icon.cjs`) |
| Плагин не собирается | Проверить `OBS_DIR`, Qt, VS 2022 x64 |
| Native source чёрный | Включить frame bridge (`host-obs` или `OMO_FRAME_BRIDGE=1`), смотреть dock «Frames: on» |

---

## Связанные документы

- [CONNECTOR.md](CONNECTOR.md) — Tailscale / Relay / WireGuard / Native frames  
- [TAILSCALE.md](TAILSCALE.md) — ACL  
- [HEADSCALE.md](HEADSCALE.md) — свой mesh  
- [OBS-PREVIEW.md](OBS-PREVIEW.md) — preview bounds  
