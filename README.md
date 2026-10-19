# IMSEL Tools

Публичный сайт онлайн-инструментов IMSEL VPN: **imsel-tools.imsel.dev**.

Инструменты:
- **Routing Builder** — визуальный конструктор профилей маршрутизации; собирает
  ссылки `imsel://routing/{add|onadd}/<base64>` и QR-коды, импортирует
  существующие ссылки, Base64 и JSON.
- **Base64 Encode / Decode** — кодирование и толерантное декодирование Base64
  (UTF-8, URL-safe, без padding).
- **Deep Link Generator** — справочник URL-схем приложения и анализатор ссылок.

Всё вычисляется в браузере; сервер только отдаёт статику.

## Архитектура

Сайт не имеет клиентской сборки: `tool/build.py` (только стандартная
библиотека Python) рендерит страницы из `src/templates/*.html` и переводов
`src/i18n/<lang>.json` в `public/<lang>/…`. QR-библиотека вендорена
(`src/js/vendor/qrcode.js`, MIT). Внешних CDN и шрифтов нет.

Логика профиля маршрутизации (`src/js/profile.js`) — порт внешнего формата
обмена (PascalCase JSON, строковые булевы, Base64 в ссылке). Golden-векторы
в `tool/test.mjs` фиксируют парсинг ссылок так, чтобы ссылки, собранные
сайтом, гарантированно импортировались приложением.

## Локальная разработка

```text
python tool/validate.py      # паритет переводов, запрещённые токены, ссылки
node tool/test.mjs           # тесты ядра (codec + профиль + QR)
python tool/build.py         # рендер в public/
python -m http.server 8765 --directory public
```

## Деплой

- **GitLab Pages** (основной домен `imsel-tools.imsel.dev`): job `pages` в
  `.gitlab-ci.yml` на ветке по умолчанию.
- **GitHub Pages** (зеркало): workflow `.github/workflows/pages.yml`.

Один hostname указывает только на один хостинг. `imsel-tools.imsel.dev`
обслуживает GitLab Pages; зеркало доступно по техническому домену
`imsel-vpn.github.io/imsel-tools/` и при необходимости переключается
DNS-записью. До верификации домена сайт GitLab отвечает на временном
адресе вида `imsel-tools-<hash>.gitlab.io`.

### Настройка домена

1. GitLab: Settings → Pages → New Domain → `imsel-tools.imsel.dev`.
   В Cloudflare добавить TXT
   `_gitlab-pages-verification-code.imsel-tools.imsel.dev =
   gitlab-pages-verification-code=<код из UI>` → Retry verification.
   Для поддомена включить DNS-only (без прокси), чтобы выпустился
   сертификат Let's Encrypt; после выпуска можно вернуть прокси с режимом
   SSL/TLS Full. Access control выключить (сайт публичный).
2. GitHub (зеркало): Custom domain НЕ привязывать — иначе технический
   адрес зеркала начинает редиректить на домен GitLab. При необходимости
   отдельного домена зеркала использовать другой поддомен, например
   `gh-tools.imsel.dev` → `CNAME imsel-vpn.github.io`.
3. HTTPS: включить force HTTPS в GitLab после выпуска сертификата.

## Добавление инструмента

1. Создать `src/templates/<tool>.html` (секции используют `{{t:...}}`,
   `$ROOT$` — префикс к `assets/`).
2. Добавить переводы в `src/i18n/ru.json` и `en.json` (паритет проверяет
   валидатор), включая `<tool>.title` и `<tool>.desc`.
3. Зарегистрировать страницу в `PAGES` в `tool/build.py` и ярлык в `nav`.
4. Логику — в `src/js/<tool>.js` (ES-модуль); при работе с форматом ссылок
   добавлять golden-векторы в `tool/test.mjs`.
5. Прогнать проверки и сборку (см. выше), закоммитить.

## Добавление языка

1. Создать `src/i18n/<lang>.json` с тем же набором ключей.
2. Добавить язык в `LANGS` в `tool/build.py`.

Валидатор проверит паритет ключей и разрешимость всех плейсхолдеров.
