# Porthole (шаринг порта через Steam)

[English](../PORTHOLE.md)

[Porthole - Local Port Sharing](https://store.steampowered.com/app/4963920/Porthole__Local_Port_Sharing/) — бесплатная утилита в Steam: форвардит **только выбранные порты** друзьям. Это **не** VPN: mesh-IP нет. Гость видит сервис на своём `127.0.0.1`.

OMO **не** поставляет Porthole. Ставьте из Steam на оба ПК (Steam должен быть залогинен).

## Когда использовать

- Модератор держит полный host OMO (власть над сценой).
- У стримера OBS + плагин **OMO Overlay** (**Browser remote**).
- Удобнее Steam-друзья / share-код, чем Tailscale или Radmin.

## Настройка

1. Установите Porthole на ПК **модератора** и **стримера**.
2. OMO на ПК модератора оставьте открытым (TCP **8090**).
3. В Porthole у модератора: лобби → раздать порты → **tcp 8090** на **`127.0.0.1`** (не адрес Tailscale `100.x`).
4. Отправьте share-код или инвайт в Steam стримеру.
5. Стример входит и делает **approve** TCP 8090 → порт на **его** `127.0.0.1:8090`.
6. Настройки → Connector → **Porthole** → скопировать URL оверлея (`http://127.0.0.1:8090/obs?t=…`).
7. OBS стримера → OMO Overlay → **Browser (remote)** → вставить → OK.

HTTP и WebSocket на одном TCP-порте; достаточно шарить **8090**.

## Harden

**Harden / bind localhost можно оставить ВКЛ.** Porthole на хосте ходит в локальный порт OMO. Для Tailscale mesh Harden как раз выключают — здесь наоборот.

## Кто какой адрес видит

| Роль | Адрес |
|------|--------|
| Модератор (цель шаринга в Porthole) | `127.0.0.1:8090` на хосте |
| Стример (URL в OBS) | `http://127.0.0.1:8090/obs?t=…` у гостя после approve |

Отдельного «IP модератора для OBS» нет.

## Заметки

- Porthole не становится **live/active** в Connector (иначе localhost украл бы active у Tailscale). Ссылку всегда берите из спойлера **Porthole**.
- Нужен актуальный `?t=`; копируйте из Connector.
- См. также [CONNECTOR.md](CONNECTOR.md) и [TAILSCALE.md](TAILSCALE.md).
