# Вишлист-бот - код

Реализация итерации 1 по [спеке](Продукт/спека-итерация-1.md) и
[флоу](Продукт/флоу-итерация-1.md). Итерация 1 - только вишлист и бронь
(деньги и календарь - итерация 2, см. `Продукт/спека-итерация-2-черновик.md`).
Дизайн-макет (визуальный референс на обе итерации сразу, не разделён) -
[Вишлист-бот - экраны итерации 1](https://claude.ai/artifact/RrdHzfH46fV7PPCsz4bqsc).

## Стек

- **backend/** - Node.js + TypeScript, Fastify (HTTP API), grammY (Telegram
  Bot API), Prisma + PostgreSQL.
- **frontend/** - Vite + React + TypeScript, Telegram Web App SDK. Тема
  подхватывается от Telegram автоматически (не тумблером, как в макете).

## Что реально работает (проверено живьём 2026-10-01 - реальный Postgres,
реальный API, клики в браузере, не только сборка)

- Первый запуск бота (Onboarding) и пустой вишлист - разные экраны:
  Onboarding - ещё нет своего вишлиста вообще, пустой вишлист - вишлист уже
  создан, но без позиций.
- Вишлист: создание, добавление позиций, экран "Поделиться" с реальной
  ссылкой (`https://t.me/wishhdesk_bot?startapp=w_<slug>` - бот
  зарегистрирован в @BotFather 2026-10-01, токен в `backend/.env`,
  локально не в гит).
- Бронирование позиции с TTL 5 дней, доверительная отметка "куплено".
  Личность дарителя нигде не отдаётся - ни в API, ни на экране. Повторная
  бронь чужой позиции - 409, отметка "куплено" не своей брони - 403 (оба
  проверены curl'ом напрямую).
- Первый переход по ссылке на чужой вишлист показывает приглашение один
  раз (локально у клиента), дальше сразу список.
- Вне Telegram (обычный браузер, для разработки) `telegramId` берётся из
  dev-заглушки в localStorage - см. `frontend/src/telegram.ts`. Внутри
  настоящего Telegram эта ветка не используется, там всегда настоящий id.

## Что написано заранее, но не подключено к итерации 1 (задел под итерацию 2)

Код есть и собирается, роуты/экраны просто не связаны ссылками с текущими
пользовательскими экранами - см. `Продукт/задачи-итерация-2-черновик.md`:
- Сбор денег - создание, прогресс, продление срока. Приём взноса создаёт
  запись, но **не проводит платёж** - ЮKassa не подключена.
- ICS/webcal-фид календаря - минимальная версия
  (`GET /api/calendar/:telegramId.ics`), без ролевого разделения.
- Экраны `SharePool`, `Contribute`, три варианта календаря - заглушки с
  рабочей навигацией.

## Что вне скоупа дальше

Партнёрские программы маркетплейсов и автопарсинг ссылок (итерация 3),
реферальная механика (итерация 4), интеграция с конкретным банком
(итерация 5).

## Запуск локально

Локальный Postgres - через Docker, не нужно ничего ставить в систему:

```bash
docker run -d --name wishlistbot-pg -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=wishlistbot -p 5432:5432 postgres:16-alpine
```

```bash
cd backend
cat > .env <<'EOF'
DATABASE_URL="postgresql://postgres:devpass@localhost:5432/wishlistbot"
BOT_TOKEN="000000:любой-плейсхолдер-без-реального-бота-тоже-работает"
MINI_APP_URL="https://example.com"
PORT=3000
EOF
npm install
npx prisma migrate dev
npm run dev
```

Бот-логика не мешает работе API даже без настоящего токена - при невалидном
`BOT_TOKEN` в лог пишется ошибка, но HTTP API продолжает работать (см.
`src/index.ts`). Настоящий токен от @BotFather нужен только когда
понадобится реальный Telegram-бот, не для разработки API/фронтенда.

```bash
cd frontend
echo 'VITE_API_BASE="http://localhost:3000"' > .env
npm install
npm run dev
```

Открыть `http://localhost:5173` в обычном браузере - полный флоу
получатель/даритель кликается по-настоящему (см. "Что реально работает").
Настоящий Telegram Mini App (открытие изнутри Telegram, HTTPS,
`startapp=` ссылки) требует токен от @BotFather и HTTPS-туннель
(например ngrok) в `MINI_APP_URL` - это уже следующий шаг, не блокирует
разработку.

Оба пакета собираются и типы проходят чисто (`npm run build` в каждом).

## Продуктовая аналитика

События пишутся в собственную таблицу `Event` той же Postgres (модель в
`backend/prisma/schema.prisma`, миграция `analytics_events`) - не в
сторонний сервис: событийные данные о желаниях и покупках, привязанные к
поводу, и есть актив проекта. Запись - `track()` в
`backend/src/services/analytics.ts`, fire-and-forget: сбой записи события
только пишет `[analytics]` warn в лог и никогда не ломает основной запрос.

| Событие | Где | Ключевые props |
|---|---|---|
| `bot_started` | `/start` в боте | `isNewUser` |
| `wishlist_created` | `POST /api/wishlists`, бот | `source` (app/bot), `ordinal` |
| `item_added` | `services/itemCreate.ts` | `source`, `store`, `price` (коп.), `selfPurchased`, `maxContributors` |
| `wishlist_viewed` | `GET /api/wishlists/:slug` не владельцем | `anonymous`, `registered`, `itemCount`; не чаще 1 раза в сутки на зрителя+вишлист |
| `item_reserved` | `POST /api/items/:id/reserve` | `mode` (classic/split), `revealIdentity`, `selfPurchased`, `store` |
| `purchase_marked` | `POST /api/items/:id/mark-bought` | `mode`, `selfPurchased` |
| `item_bought` | позиция перешла в bought | `mode`, `store`, `price`, `contributors`, `occasionMonthDay` |
| `occasion_set` / `occasion_cleared` | `PATCH /api/wishlists/:slug` | `title`, `monthDay` (MM-DD) |
| `occasion_ics_downloaded` | `GET /api/wishlists/:slug/occasion.ics` | - |
| `calendar_feed_fetched` | `GET /api/calendar/:token.ics` | `occasionCount`; 1 раз в сутки на пользователя |
| `thanks_sent` | бот, благодарность дарителю | `mediaType`, `recipients`, `delivered` |

Приватность: в событиях нет телефонов (`sbpPhone`), `telegramId`, имён,
`initData`, текстов сообщений и `file_id` медиа - пользователь только
внутренним `User.id` (`null` у анонимного зрителя). Зритель без записи
`User` различается для дедупликации по HMAC от `telegramId` с серверным
секретом, сам `telegramId` не хранится.

Отчёт - только CLI, HTTP-эндпоинта нарочно нет:

```bash
cd backend
npm run analytics:report          # последние 30 дней
npm run analytics:report -- 7     # последние 7 дней
node dist/scripts/analyticsReport.js 30   # на проде после npm run build
```

Печатает: события по типам, воронку по вишлистам, созданным за период
(создал → добавил позицию → открыли дарители → бронь → покупка),
магазины, долю "уже купил(а) сам(а)" и "скинуться", цены, брони/раскрытия
и ближайшие поводы по месяцам (по текущим данным `Wishlist`).
