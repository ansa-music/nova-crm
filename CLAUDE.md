# Nova CRM — контекст проекта для Claude Code

Рабочий файл контекста, читается автоматически при запуске в этой папке. Держим его коротким —
всё «почему»/архитектурные детали живут в скилле **`nova-crm-deep-dive`** (`.claude/skills/`),
который стоит явно подгрузить перед нетривиальной правкой row/column CRUD
(`pageService.ts`/`subPageService.ts`), Supabase-моста (`rowRecordsService.ts`), резолва
`statusOptions` (`columnOptions.ts`) или Supabase Storage-аплоадов. Здесь — только то, что нужно
знать в КАЖДОЙ сессии: кто владелец, что это за проект, куда деплоится, и список уроков,
которые нельзя наступать повторно.

Если увидишь расхождение между этим файлом и кодом — код важнее, но обнови и файл.

## Кто владелец и как общаться

Владелец — Nurba, общается **по-русски**. Решения (архитектурные и дизайнерские) принимай
**самостоятельно**, без уточняющих вопросов, если задача не критически неоднозначна.
Формулировки часто неформальные/с опечатками — ориентируйся на суть. Nurba нередко ведёт
**несколько сессий Claude Code параллельно** над одним `main` — перед крупной задачей делай
`git fetch`/смотри последние коммиты в `main`, не доверяй локально закэшированному состоянию.

## Что это за проект

Nova CRM — production SaaS, написанная с помощью Claude. Один **Owner** (Nurba) + независимые
**менеджеры** (в UI — «Технар»), каждый работает на своей изолированной персональной странице,
в UI называемой **«стол»** (desk). НЕ модель отделов/бухгалтеров — столы это личные рабочие
пространства менеджеров, Owner видит сводку над всеми.

## Терминология

Внутренний код (типы, роли, коллекции Firestore) не переименован — это чисто UI-слой:

- `Role = "owner" | "admin" | "manager" | "viewer"`, но `ROLE_LABELS.manager === "Технар"`
  (`src/types/role.ts`) — везде в UI роль `manager` подписана «Технар».
- «Страница» (`WorkspacePage`, коллекция `pages`) в UI — **«стол»** (desk). Код/типы остаются
  `page`/`WorkspacePage`, но роуты/сервисы часто используют «desk»/«стол» (`DesksPage.tsx`,
  `deskCoverService.ts`, `/desks`).
- Экраны: `/dashboard` (графики/рейтинг/KPI), `/desks` (грид обложек столов), `/people`
  (участники), `/page/:pageId` (сам стол). `HomePage` (`/`) — если есть свой ответственный
  стол, сразу открывает его, иначе дашборд-лендинг.

## Стек

React 19, TypeScript, Vite 6, Tailwind, shadcn/ui, Framer Motion, GSAP (десктоп-only, см. скилл
для деталей), Zustand, Firebase (Auth + Firestore — источник истины), **Supabase** (Postgres +
Storage + Realtime — см. `nova-crm-deep-dive`), TanStack Virtual, dnd-kit, sonner, canvas-confetti.

Firebase Storage не используется (нет Blaze) — файлы идут через **Supabase Storage**. Модель
прав, Supabase-мост для строк таблицы, полная история statusOptions и весь список уже
реализованных фич — в скилле `nova-crm-deep-dive`, не здесь.

## Ключевые пути и инфраструктура

- Локальная копия у Nurba: `C:\Users\nurpr\Documents\Nova\crm-platform`; архивы — `Downloads`
- GitHub: `https://github.com/ansa-music/nova-crm` (публичный)
- Деплой: `https://nurba-6e70d.web.app`, Firebase-проект `nurba-6e70d`, аккаунт `nurpro2005@gmail.com`
- Supabase: `xoqivqqcmunavuwpsmsd.supabase.co` (URL/anon key в `src/lib/supabase.ts`, фоллбэк на env)
- CI/CD: `.github/workflows/deploy.yml`, автодеплой на push в `main`:
  `npm ci` → `npm run type-check` → `npm run build` → `firebase deploy --only hosting,firestore:rules`.
  Падает на любом шаге — деплоя не будет. Правки `firestore.rules` деплоятся тем же пайплайном,
  отдельный `npm run deploy:rules` нужен только для локальной проверки до пуша.

## Обязательные шаги перед любым коммитом

1. Прочитать файл перед правкой.
2. После значимых изменений — `npx tsc --noEmit` (`npm run type-check`), затем `npm run build`.
3. Перед сдачей крупной пачки — чистая пересборка:
   `rm -rf node_modules package-lock.json dist && npm install && npx tsc --noEmit && npm run build`.
4. В облачных сессиях `node_modules` может отсутствовать при старте — сначала `npm install`,
   иначе `npx tsc`/`npx vite` подхватят чужой глобальный тулинг (например `TS5101`).

## Модель прав (кратко)

Roles: `owner` > `admin` > `manager` («Технар») > `viewer`. Только Owner проходит `isOwner()`
безусловно. `canEditPage(page) = owner || responsibleUserId == uid || (canAccessPage && uid in editableUsers)`.
`canAccessPage(page) = owner || isResponsiblePage || uid in allowedUsers`. `allowedUsers`
(просмотр) и `editableUsers` (редактирование) — разные права. `responsibleUserId` даёт
админ-права в рамках конкретной страницы + доступ на чтение даже без `allowedUsers`, но не
доступ на уровне workspace. История изменений (`/history`) — только Owner.

## Критические уроки и подводные камни (НЕ повторять)

- **`e.key` vs `e.code`** — `e.key` зависит от раскладки клавиатуры (на русской раскладке
  физическая Z печатает «я»). Горячие клавиши (Ctrl+Z/C/V…) всегда через `e.code`
  (`"KeyZ"`, `"KeyC"`...), никогда через `e.key`.
- **`serverTimestamp()`** нельзя использовать на полях, которые форматируются/показываются
  пользователю (`createdAt`/`updatedAt` и т.п.) — persisted-значение становится Firestore
  `Timestamp`, а не `number`, и код, ожидающий число, тихо расходится с типом или крашится при
  рендере. Использовать `Date.now()`.
- Firestore `delete`-правила никогда не проверяют `request.resource.data` — поле не существует
  при удалении.
- Firestore list-запросы (`collection().where(...)`) требуют однородных прав на все документы
  результата — иначе весь запрос падает `permission-denied`, даже если доступ есть к части.
  Personal Space (`personalZones/{uid}/reports`) поэтому изолирован по uid отдельной коллекцией.
- **`collectionGroup()`-запросы требуют отдельного top-level правила `match /{path=**}/...`** —
  вложенное правило под конкретным путём НЕ авторизует collection-group запрос. Отсутствие
  такого правила для `members` держало `claimPendingInvites()` (auto-claim инвайта при логине)
  в вечном молчаливом `permission-denied` для абсолютно всех — если добавляешь новый
  `collectionGroup()`-запрос, сразу заводи парную `{path=**}`-rule.
- Экранный `hasOnly([...])`/`affectedKeys()` diff-чек в `firestore.rules` обязан включать
  **ровно** те поля, что реально пишет клиентская функция за одну операцию — не меньше и не
  больше. Несовпадение тихо роняет весь write с `permission-denied` для не-Owner, при этом
  кнопка в UI остаётся видимой и как будто рабочей. Уже наступали на это дважды (assign-
  responsible писал `allowedUsers`+`hiddenByResponsible` вместе с `responsibleUserId`;
  `changeColumnType` ронял `statusOptions`) — при правке ЛЮБОГО `hasOnly`-правила или функции,
  которая под него попадает, перепроверяй оба конца.
- Квоты на количество страниц у менеджера — только atomic Firestore batch writes, не
  читай-потом-пиши (race condition).
- **`activeRole`** (симуляция роли) — чисто клиентское UI-поле, Firestore rules никогда не
  должны ему доверять для реальных решений о доступе.
- «Статус», «Ответственный» и кастомные поля — не идентичны по модели resolution (детали в
  скилле `nova-crm-deep-dive`) — не переноси логику с одного типа на все три без проверки.
- Undo/redo — **глобальный** стек (`src/utils/undoStore.ts`), переживает навигацию между
  страницами, один слушатель Ctrl+Z на уровне приложения (`GlobalUndoHotkeys.tsx`) — не
  дублировать в `DataTable.tsx`. Многоячеечная операция (paste/clear/fill) обязана класть
  **ОДНУ** undo-команду на всю операцию (batch + `Promise.all`), не одну на ячейку — иначе один
  Ctrl+Z отменяет только последнюю тронутую ячейку.
- **Уже чинили дважды**: `column.type === "status"` для решения «можно ли редактировать текстом
  эту ячейку» — неполно. Нужно `isOptionColumn(column.type)` (status + responsible + custom),
  иначе двойной клик по «Ответственный»/кастомному полю включает фантомное текстовое
  редактирование, блокирующее ВСЕ горячие клавиши до перезагрузки.
- Подписка на Firestore-коллекцию (сообщения/переписки и т.п.) вначале отдаёт пустой массив (до
  первого снапшота), потом реальные данные — паттерн должен быть «видел ли я именно ЭТО», а не
  «это первый вызов эффекта». Также: React-компонент, который переиспользуется между разными
  «логическими» инстансами БЕЗ ремонта (тот же route, сменился id/prop) — обязан явно очищать
  свой стейт вверху эффекта при смене id, а не только когда id стал falsy.
- **iOS Safari / Google OAuth**: `authDomain` должен быть `firebaseapp.com`, не `web.app`
  (иначе `redirect_uri_mismatch` на iPhone). Мобильный Google-логин — `signInWithRedirect`, не
  `signInWithPopup`. `getRedirectResult()` не должен блокировать/ложно фейлить обычный
  email+password вход дольше пары секунд (даже если есть флаг «редирект ожидается» — он может
  быть устаревшим), и не должен реагировать на преждевременный `null` от Auth.
- **Firebase Spark listener limits**: не вешай новые постоянные `onSnapshot` бездумно на
  второстепенные экраны — упрёшься в лимиты бесплатного плана. Для строк таблицы уже есть
  Supabase Realtime мост (`rowRecordsService.ts`) — используй его паттерн.
- Отдельный standalone-проект «Living Archive CRM» архитектурно несовместим с Nova CRM, не
  пытаться сливать.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
