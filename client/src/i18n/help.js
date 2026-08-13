/** In-app handbook copy. Kept out of i18n/index.js because it is long. */

const en = {
  topics: [
    {
      id: 'canvas',
      title: 'Canvas and layers',
      body: [
        'The big middle area is the canvas. That picture is what viewers see in OBS (1920×1080).',
        'On the left, Layers is the list of everything on the canvas. Click a name to select it. Drag a name to change order (top of the list = in front).',
        'Mouse wheel zooms toward the cursor. Hold Space and drag, or use the middle mouse button, to pan. Ctrl+0 fits the canvas. Ctrl+1 is 100%.',
        'Drop image/video files onto the canvas, or use Media at the top.'
      ]
    },
    {
      id: 'inspector',
      title: 'Inspector',
      body: [
        'The right column is the Inspector. It shows settings for the selected layer: size, opacity, text, volume, and so on.',
        'If the window is narrow, open Inspector from the top bar.',
        'Nothing selected = almost empty Inspector. Click a layer first.'
      ]
    },
    {
      id: 'media',
      title: 'Media, text, browser',
      body: [
        'Top bar → Media: add files, a URL, a text layer, a timer, a counter, a Browser source, or ChatIS chat.',
        'Text: click the layer, then type in the Inspector.',
        'Browser: a webpage inside the overlay (alerts, widgets). You paste an https:// address.',
        'Save (top right) writes the scene. Ctrl+S also saves.'
      ]
    },
    {
      id: 'obs',
      title: 'OBS and the plugin',
      body: [
        'Bottom bar → OBS Source copies a localhost link. On the SAME PC as this program, add a Browser Source in OBS (1920×1080) and paste it.',
        'Or add the OMO Overlay plugin source. Native = this program paints frames. Browser (local) = this PC. Browser (remote) = only a link, no program on the streamer PC.',
        'If the overlay is black: this program must stay open, and the link must include the token (?t=…).'
      ]
    },
    {
      id: 'connector',
      title: 'Connector (streamer on another PC)',
      body: [
        'Settings (bottom bar health badge, or nav) → Connector.',
        'Beginners: Tailscale or Radmin VPN on both PCs, then Copy the link, then OBS → OMO Overlay → Browser (remote) → paste.',
        'Your own server (relay) is only if you have a wss:// address. Green “live” means that path already works.',
        'Do not port-forward 8090 or OBS 4455 to the internet.'
      ]
    },
    {
      id: 'pin',
      title: 'PIN and moderators',
      body: [
        'The PIN is created on first launch. Share it only with people who may edit the overlay.',
        'Change it in Settings → Security. That does not kick anyone out immediately.',
        'A remote moderator uses a join code from Connector (relay) and then the PIN. The join code alone cannot edit, only view the overlay.'
      ]
    },
    {
      id: 'soundpad',
      title: 'SoundPad',
      body: [
        'Left Tools → SoundPad. Put sounds in slots 1–10.',
        'While this window is focused, F1–F10 play those slots. Shift+F1–F10 previews.',
        'This is why Help is not on F1.'
      ]
    },
    {
      id: 'perform',
      title: 'Perform mode',
      body: [
        'Perform (top bar, or F11) hides the editor chrome so you can click SoundPad during stream.',
        'Esc leaves Perform mode. The canvas stays visible.'
      ]
    }
  ],
  faq: [
    {
      id: 'blank',
      q: 'OBS shows a black / empty overlay',
      a: 'Keep this program open. Paste the full link (with ?t=). Size 1920×1080. If the streamer is on another PC, use Connector and Browser (remote), not localhost.'
    },
    {
      id: 'where-url',
      q: 'Where do I copy the OBS link?',
      a: 'Bottom status bar: OBS Source (same PC). For a streamer with only the plugin: Connector → Copy the link, or Streamer overlay on the status bar when a remote path is live.'
    },
    {
      id: 'pin',
      q: 'I forgot the PIN',
      a: 'You cannot recover it from the app. Close the app and delete the AppData folder (see the user guide) to create a new PIN. The overlay token also changes — update OBS.'
    },
    {
      id: 'plugin',
      q: 'Plugin or normal Browser Source?',
      a: 'Both work. Browser Source is enough on the same PC. The plugin adds Native frames and Browser (remote) for a streamer who does not run this program.'
    },
    {
      id: 'remote',
      q: 'How does a remote moderator join?',
      a: 'You start a relay in Connector, copy the join code, they open the remote build, enter the code, then the PIN.'
    },
    {
      id: 'tailscale',
      q: 'Tailscale or my own server?',
      a: 'No server of your own → Tailscale or Radmin VPN. You have a VPS with wss:// → Your own server (relay) in Connector.'
    },
    {
      id: 'harden',
      q: 'What is Harden?',
      a: 'It locks the program to this computer only (localhost). Use it with a relay or Cloudflare. Leave it off for Tailscale / Radmin, or OBS on the other PC cannot reach you.'
    },
    {
      id: 'fkeys',
      q: 'F1–F10 do not open Help',
      a: 'Those keys play SoundPad. Open Help with the ? button in the top bar, Ctrl+Shift+/, or Ctrl+K → Handbook.'
    }
  ]
}

const ru = {
  topics: [
    {
      id: 'canvas',
      title: 'Холст и слои',
      body: [
        'Большая середина — холст. Эта картинка уходит в OBS зрителю (1920×1080).',
        'Слева Layers — список всего на холсте. Клик по имени выбирает слой. Перетаскивание меняет порядок (выше в списке = ближе к зрителю).',
        'Колесо мыши приближает к курсору. Пробел + перетаскивание или средняя кнопка — сдвиг. Ctrl+0 вписать холст. Ctrl+1 — 100%.',
        'Файлы можно бросить на холст или добавить через Media сверху.'
      ]
    },
    {
      id: 'inspector',
      title: 'Inspector',
      body: [
        'Правая колонка — Inspector. Там настройки выбранного слоя: размер, прозрачность, текст, громкость.',
        'Если окно узкое, Inspector открывается кнопкой в верхней панели.',
        'Ничего не выбрано — Inspector почти пустой. Сначала кликните слой.'
      ]
    },
    {
      id: 'media',
      title: 'Медиа, текст, браузер',
      body: [
        'Верхняя панель → Media: файлы, ссылка, текст, таймер, счётчик, Browser, чат ChatIS.',
        'Текст: выберите слой и пишите в Inspector.',
        'Browser — страница внутри оверлея (виджеты, алерты). Нужен адрес https://.',
        'Save справа вверху сохраняет сцену. Ctrl+S тоже.'
      ]
    },
    {
      id: 'obs',
      title: 'OBS и плагин',
      body: [
        'Нижняя полоса → OBS Source копирует ссылку localhost. На ТОМ ЖЕ ПК, что и эта программа, в OBS добавьте Browser Source 1920×1080 и вставьте её.',
        'Или источник плагина OMO Overlay. Native — кадры рисует эта программа. Browser (local) — этот ПК. Browser (remote) — только ссылка, без программы у стримера.',
        'Чёрный экран: программа должна быть открыта, в ссылке должен быть токен (?t=…).'
      ]
    },
    {
      id: 'connector',
      title: 'Коннектор (стример на другом ПК)',
      body: [
        'Настройки (бейдж внизу или пункт в меню) → Коннектор.',
        'Новичкам: Tailscale или Radmin VPN на оба компьютера, затем «Скопировать ссылку», в OBS у стримера OMO Overlay → Browser (remote) → вставить.',
        '«Свой сервер (relay)» — только если есть адрес wss://. Зелёная метка live = этот путь уже работает.',
        'Не открывайте в интернет порты 8090 и OBS 4455.'
      ]
    },
    {
      id: 'pin',
      title: 'PIN и модераторы',
      body: [
        'PIN задаётся при первом запуске. Его дают только тем, кто может править оверлей.',
        'Смена: Настройки → Безопасность. Сразу никого не выкидывает.',
        'Удалённый модератор: код из Коннектора (relay), потом PIN. Один код без PIN сцену не правит — только показывает картинку.'
      ]
    },
    {
      id: 'soundpad',
      title: 'SoundPad',
      body: [
        'Слева Tools → SoundPad. Звуки в слоты 1–10.',
        'Пока это окно в фокусе, F1–F10 играют слоты. Shift+F1–F10 — превью.',
        'Поэтому справка не на F1.'
      ]
    },
    {
      id: 'perform',
      title: 'Режим Perform',
      body: [
        'Perform (верхняя панель или F11) прячет панели, чтобы нажимать SoundPad во время стрима.',
        'Esc выходит из Perform. Холст остаётся на экране.'
      ]
    }
  ],
  faq: [
    {
      id: 'blank',
      q: 'В OBS чёрный / пустой оверлей',
      a: 'Не закрывайте эту программу. Вставьте полную ссылку (с ?t=). Размер 1920×1080. Если стример на другом ПК — Коннектор и Browser (remote), не localhost.'
    },
    {
      id: 'where-url',
      q: 'Где взять ссылку для OBS?',
      a: 'Нижняя полоса: OBS Source (тот же ПК). Для стримера только с плагином: Коннектор → «Скопировать ссылку», или Streamer overlay внизу, когда путь live.'
    },
    {
      id: 'pin',
      q: 'Забыл PIN',
      a: 'Из программы его не восстановить. Закройте приложение и удалите папку AppData (см. руководство), чтобы задать новый PIN. Токен оверлея тоже сменится — обновите OBS.'
    },
    {
      id: 'plugin',
      q: 'Плагин или обычный Browser Source?',
      a: 'Работают оба. На одном ПК хватает Browser Source. Плагин даёт Native-кадры и Browser (remote), если у стримера нет этой программы.'
    },
    {
      id: 'remote',
      q: 'Как заходит удалённый модератор?',
      a: 'В Коннекторе запускаете relay, копируете код. Он открывает remote-сборку, вводит код, затем PIN.'
    },
    {
      id: 'tailscale',
      q: 'Tailscale или свой сервер?',
      a: 'Нет своего сервера — Tailscale или Radmin VPN. Есть VPS с wss:// — пункт «Свой сервер (relay)» в Коннекторе.'
    },
    {
      id: 'harden',
      q: 'Что такое Harden?',
      a: 'Программа слушает только этот компьютер (localhost). Нужен для relay или Cloudflare. Для Tailscale / Radmin выключите, иначе OBS на другом ПК до вас не достучится.'
    },
    {
      id: 'fkeys',
      q: 'F1–F10 не открывают справку',
      a: 'Эти клавиши играют SoundPad. Справка: кнопка «?» сверху, Ctrl+Shift+/, или Ctrl+K → Справочник.'
    }
  ]
}

export function helpContent(locale) {
  return locale === 'ru' ? ru : en
}
