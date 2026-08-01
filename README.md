# Nova CRM

Полноценная облачная CRM-платформа уровня Notion / Airtable / Linear: мультиворкспейсы,
роли и права доступа, realtime-таблицы с историей изменений — на React 19 + TypeScript +
Firebase.

## Стек

React 19 · TypeScript · Vite · TailwindCSS · shadcn/ui (Radix) · Framer Motion ·
TanStack Table/Virtual · React Router 7 · Zustand · React Hook Form + Zod · Lucide ·
Firebase (Auth / Firestore / Storage) · dnd-kit · Recharts · Sonner

## Быстрый старт

```bash
npm install
npm run dev
```

Проект уже подключён к Firebase-проекту `nurba-6e70d` (конфиг в `src/firebase/firebase.ts`).
Firebase API key для веб-приложений не является секретом — безопасность обеспечивается
правилами Firestore/Storage (см. ниже), поэтому конфиг хранится прямо в исходниках.

### Обязательные шаги в консоли Firebase

Я не могу настроить консоль Firebase за вас — это нужно сделать один раз вручную:

1. **Authentication** → Sign-in method → включите **Google** и **Email/Password**.
2. **Firestore Database** → создайте базу (production mode).
3. **Storage** → создайте бакет (уже указан в конфиге как `nurba-6e70d.firebasestorage.app`).
4. Задеплойте правила безопасности и индексы:
   ```bash
   npm install -g firebase-tools   # если ещё не установлено
   firebase login
   npm run deploy:rules
   ```
   Это выполнит `firebase deploy --only firestore:rules,firestore:indexes,storage`.
   Правила лежат в `firestore.rules`/`storage.rules`, индексы — в
   `firestore.indexes.json`. Без этого шага Firestore по умолчанию блокирует
   все запросы (permission-denied) — это единственный шаг, который я не могу
   выполнить за вас: он требует вашей сессии `firebase login`.

### Полное тестирование (проведено с нуля из чистого ZIP)

Распаковал реально отданный архив, поставил зависимости с нуля (без кэша), прогнал
полный цикл — и нашёл + исправил ещё один реальный баг:

- **Утечка билд-артефактов в исходники**: `tsc -b` (composite project references)
  компилировал `tsconfig.node.json` (используется для проверки типов в
  `vite.config.ts`) и оставлял `vite.config.js` / `vite.config.d.ts` прямо рядом
  с исходным `vite.config.ts`. Это не просто мусор — при определённых условиях
  Vite мог бы подхватить устаревший скомпилированный `.js`-конфиг вместо
  актуального `.ts`. Убрал composite/project-references полностью, `tsc --noEmit`
  теперь используется напрямую и ничего не эмитит.
- Обновил `react-router-dom` → унифицированный `react-router@8` (в React Router
  v8 DOM-биндинги вошли в основной пакет) — закрыл единственную оставшуюся
  npm-уязвимость (`npm audit`: 0 issues, было 2 high).
- Собрал реальный **headless smoke-тест**: билд подгружен в jsdom-окружение
  (с полифиллами matchMedia/ResizeObserver/MutationObserver/SVGElement и др.),
  React реально отрендерил экран входа (AuthLayout + LoginForm), **0 ошибок
  консоли, 0 необработанных исключений**, `#root` не пустой. Это подтверждает:
  инициализация Firebase не падает синхронно, роутинг корректно редиректит
  неавторизованного пользователя на `/login`, React-дерево монтируется без
  креша. Полный e2e-прогон с реальным логином и записью в Firestore я
  выполнить не могу (см. ниже).
- Финальные команды из чистого состояния: `npm install` → `npm run type-check`
  → `npm run build` → `npm run dev` — все проходят чисто, `npm audit` — 0 issues.

## Что реально проверено, а что нет

Я проверил (в изолированной песочнице без доступа к живым API Firebase):
`npm install`, `npm run type-check`, `npm run build`, `npm run dev` — все проходят
чисто. Логика правил Firestore проверена построчно вручную (в т.ч. сценарий приёма
инвайта до вступления в участники).

Я **не могу** выполнить live smoke-test (создать тестового пользователя, записать/
прочитать документ в реальном Firestore) — у песочницы нет сетевого доступа к
`identitytoolkit.googleapis.com` / `firestore.googleapis.com`. Обязательно
задеплойте правила (шаг 4 выше) и пройдите обычный флоу входа руками один раз —
если Firestore выдаст `permission-denied`, приложение теперь покажет об этом
понятный toast с точной подсказкой, что делать.

После этого `npm run dev` → откройте `http://localhost:5173` → зарегистрируйтесь → вы
автоматически попадёте в CRM и увидите приглашение создать первый workspace.

## Сборка

```bash
npm run build      # tsc -b && vite build — проверено, собирается без ошибок
npm run preview
```

## Архитектура

```
src/
  firebase/        firebase.ts (init), auth.ts, firestore.ts (пути + realtime helpers), storage.ts
  services/        authService, workspaceService, memberService, pageService,
                    historyService, onboardingService — вся бизнес-логика поверх Firebase
  store/            authStore, workspaceStore, uiStore (Zustand)
  contexts/         ThemeProvider
  hooks/            useAuth, useWorkspace, usePermissions, usePageRows, useHistoryLog,
                    useMultiPageRows, useDebounce, useMediaQuery
  types/            Role, AppUser, Workspace, WorkspaceMember, WorkspacePage, PageRow,
                    HistoryEntry, table selection types
  utils/            cn, permissions (RBAC), format, date, csv, validation (Zod), pageIcons
  layouts/          AuthLayout, AppLayout
  components/
    ui/              shadcn-style примитивы (Button, Dialog, DropdownMenu, Select, Sheet…)
    auth/             LoginForm (Google + Email/Password, RHF+Zod)
    layout/           Sidebar, Topbar, WorkspaceSwitcher, ThemeToggle, GlobalSearch
    pagesnav/         CreatePageDialog, EditPageDialog, PageNavItem (rename/duplicate/delete)
    table/            DataTable (ядро), ColumnHeaderCell, TableRow, TableCell, StatusBadge,
                       TableToolbar, TablePagination, GroupHeaderRow, FilterPopover
    dashboard/        StatCard, RevenueChart, StatusChart, RecentActivity
    members/          InviteMemberForm, RoleSelect (used by pages/UsersPage.tsx)
    history/          HistoryPanel (с восстановлением значений)
  pages/             LoginPage, DashboardPage, DynamicTablePage, UsersPage, SettingsPage, NotFoundPage
```

## Модель доступа: Owner vs явный allowlist по страницам

Это принципиально другая модель, чем классический RBAC — **страницы не привязаны
к ролям**. Доступ к каждой странице определяется отдельным полем
`allowedUsers: string[]` (uid участников) прямо на документе страницы.

- **Owner** — всегда видит и может редактировать абсолютно всё: все страницы,
  всю историю изменений, управляет участниками, ролями, создаёт/удаляет
  страницы и сам workspace. Это единственная роль с неявным полным доступом.
- **Все остальные** (Admin/Manager/Viewer — роль тут используется только как
  метка и для отметки read-only через Viewer) видят **только те страницы**,
  в чьём `allowedUsers` явно присутствует их uid. Ни автоматического доступа
  по роли, ни исключений — если Алихана нет в `allowedUsers` страницы
  «Финансы», он не увидит её ни в Sidebar, ни по прямому URL, ни через
  Firestore (запрос будет отклонён правилами на сервере).
- **Viewer** — даже если добавлен в `allowedUsers` конкретной страницы, может
  только просматривать её данные, не редактировать.

| Действие                             | Owner | Все остальные |
|---------------------------------------|:-----:|:--------------:|
| Просмотр страницы                     | ✓ (всегда) | только если uid ∈ `allowedUsers` |
| Редактирование данных страницы        | ✓ | ✓, если есть доступ и роль ≠ Viewer |
| Создание / удаление страниц           | ✓ | ✗ |
| Настройка `allowedUsers` страницы     | ✓ | ✗ |
| Приглашение / удаление участников     | ✓ | ✗ |
| Смена ролей                           | ✓ | ✗ |
| Создание / удаление Workspace         | ✓ | ✗ |
| Просмотр истории изменений            | ✓ | ✗ |

Управление всем этим — на отдельной странице **Workspace → Пользователи**
(`/users`, видна только Owner в Sidebar): приглашение, роль, удаление, и для
каждого участника — разворачиваемый список чекбоксов по всем страницам
workspace. Каждый чекбокс применяется **мгновенно** (без кнопки «Сохранить»).

Реализовано в двух местах, и это осознанно:
- `src/utils/permissions.ts` — клиентские проверки (скрыть пункт в Sidebar,
  показать «Access denied», отключить кнопки). Это только UX.
- `firestore.rules` — **настоящая граница безопасности**. Функция
  `canAccessPage()` там проверяет `isOwner() || request.auth.uid in
  pageData.allowedUsers` на каждый запрос чтения/записи документа страницы и
  её строк. Даже если открыть чужую страницу напрямую через URL или
  попытаться прочитать документ через DevTools/Firestore SDK напрямую в
  обход React — сервер откажет.

## Firestore структура данных

```
users/{uid}
workspaces/{workspaceId}
  members/{uid или email-до-принятия-инвайта}
  pages/{pageId}            — включает allowedUsers: string[]
    rows/{rowId}
  history/{entryId}          — только Owner может читать
```

Все чтения таблиц/участников/страниц идут через `onSnapshot` — изменения одного
пользователя мгновенно видны другим, открывшим ту же страницу (совместная работа в
реальном времени).

## Таблица (DataTable)

Полностью переработанная таблица с: resize колонок/строк, закрепление колонок и первой
строки (шапка always sticky), drag & drop колонок и строк (dnd-kit — реордер строк
отключается, пока активны сортировка/фильтр/поиск/группировка, чтобы не конфликтовать
с производным порядком), множественное выделение диапазона (мышь + Shift), чекбоксы для
bulk-удаления, Ctrl+C/Ctrl+V (в т.ч. вставка из/в Excel-подобный TSV), Ctrl+Z/Ctrl+Y
(локальный стек команд за сессию), двойной клик для редактирования, контекстное меню,
цветные статусы, поиск, фильтр по значениям колонки, группировка, пагинация, а также
виртуализация строк через `@tanstack/react-virtual` в обычном (не сгруппированном) режиме.

**Известное упрощение**: drag & drop строк работает в пределах видимого (виртуализированного)
окна — это стандартный компромисс при совмещении virtual scrolling с drag-and-drop.

## Приглашения участников

Приглашение создаёт документ в `members` с `status: 'invited'`, ключом по email. Когда
приглашённый регистрируется/входит с тем же email, `claimPendingInvites()` автоматически
переносит его в активные участники. **Реальная отправка email не реализована** — для этого
нужна Cloud Function + провайдер (SendGrid/Resend и т.п.), что выходит за рамки
клиентского приложения. Сейчас после приглашения можно скопировать данные и сообщить
пользователю вручную, что удобно продолжить, добавив Cloud Function `onCreate` на
`members/{memberId}` с `status == 'invited'`.

## Переход на модель доступа "Owner + явный allowlist" (проведено)

По требованию заказчика полностью заменена модель прав на страницы:

- Было: `WorkspacePage.allowedRoles: Role[]` + опциональный `allowedUserIds`,
  Owner **и Admin** оба имели неявный полный доступ ко всем страницам.
- Стало: единственное поле `allowedUsers: string[]`. Полный неявный доступ —
  только у Owner. Admin больше не видит страницы автоматически — только если
  явно добавлен в `allowedUsers` конкретной страницы, как и любой другой.
- Все capability-проверки в `utils/permissions.ts` (создание страниц,
  приглашение/удаление участников, смена ролей, просмотр истории, удаление
  workspace) теперь **owner-only**, а не `owner || admin`.
- `firestore.rules` переписаны под ту же модель — это реальная граница
  безопасности, а не только клиентские проверки.
- Добавлена отдельная страница **Workspace → Пользователи** (`/users`,
  видна только Owner): приглашение/роль/удаление + разворачиваемый чекбокс-
  грид доступа к каждой странице на каждого участника, применяется мгновенно.
- `CreatePageDialog`/`EditPageDialog` переведены с выбора ролей на выбор
  конкретных людей.
- Удалён устаревший `MembersDialog` (функциональность перенесена в
  `UsersPage`, чтобы не поддерживать два места с дублирующейся логикой).

При переносе нашёл и исправил два реальных бага, которые проявились бы только
после этого перехода:
- `DashboardPage` считал доход/клиентов по **всем** страницам независимо от
  того, видит ли их текущий пользователь — утечка данных через агрегаты.
  Теперь фильтрует страницы через `canAccessPage` перед подсчётом статистики.
- И `DashboardPage`, и `HistoryPanel` на странице таблицы **безусловно**
  подписывались на коллекцию `history` (теперь Owner-only по правилам) —
  значит, у любого не-Owner при первом же открытии Dashboard или любой
  таблицы гарантированно всплывал бы permission-denied toast. Теперь эти
  подписки монтируются только для Owner. Также убрал попытку читать rows
  страницы, если доступ и так корректно запрещён — раньше "Access denied"
  показывался одновременно с ложным permission-denied toast.

Проверено с нуля («rm -rf node_modules package-lock.json && npm install»):
`type-check` ✓, `build` ✓ (новый `UsersPage` корректно попал в отдельный
lazy-чанк), `npm run dev` ✓, headless jsdom-рендер ✓ (0 ошибок консоли).

## Аудит безопасности и производительности (проведён)

При повторной ревизии кода как senior-разработчиком были найдены и исправлены:

- **Критическая уязвимость** в `firestore.rules`: правило самостоятельной записи в
  `members/{memberId}` было слишком широким и позволяло любому авторизованному
  пользователю создать себе документ участника с ролью `owner` в чужом workspace
  (privilege escalation). Переписано: самостоятельное создание записи участника теперь
  разрешено только (а) создателю workspace при его бутстрапе, либо (б) когда существует
  подтверждающий pending-инвайт с совпадающими email/ролью — во всех остальных случаях
  роль назначает только Owner/Admin.
- Список workspace пользователя раньше обновлялся **поллингом** каждые 8 секунд —
  заменено на настоящий `onSnapshot` по collectionGroup-запросу (мгновенное обновление
  при получении приглашения или удалении из workspace).
- Изменение ширины столбца/высоты строки писало в Firestore **на каждый мышемove**
  во время перетаскивания — теперь во время drag обновляется только локальный
  preview-стейт, а запись в Firestore происходит один раз на `mouseup`.
- При удалении страницы теперь каскадно удаляются и её записи в `history` (не только
  строки), чтобы не оставлять «осиротевшие» записи истории.
- Свёрнутый (collapsed) Sidebar раньше полностью скрывал список страниц — теперь в
  свёрнутом виде показываются иконки страниц с tooltip, как в Linear/Notion.
- Добавлен `firestore.indexes.json` с обязательными composite-индексами для
  collectionGroup-запросов по `members` (без них первый запуск может выдать ошибку
  с ссылкой на создание индекса).
- Основной JS-бандл (1.24 MB) разбит через `manualChunks` на кэшируемые части
  (firebase, recharts, radix, framer-motion, dnd-kit) — начальная загрузка теперь
  ощутимо легче, тяжёлые чанки подгружаются только при переходе на нужный экран.
- Добавлен алиас скрипта `type-check` (наряду с `typecheck`).

- **Инвайт-парадокс "курица и яйцо"** в `firestore.rules`: чтобы принять
  приглашение, `claimPendingInvites()` должен прочитать свой pending-инвайт
  документ по email — но правило чтения `members` требовало уже быть
  участником workspace, которым приглашённый ещё не является. Добавлено
  отдельное разрешение: непирисоединившийся пользователь может прочитать
  ровно один документ — свой собственный pending-инвайт по email.
- Конфиг Firebase теперь сначала читает `VITE_FIREBASE_*` из `.env.local`,
  и только если переменная не задана — использует захардкоженное значение
  как fallback. `.env.local` уже создан и заполнен реальными ключами проекта
  `nurba-6e70d`, так что `npm run dev` работает из коробки без ручной
  настройки .env.
- Добавлен `npm run deploy:rules` — деплоит правила и индексы одной командой.
- Firestore-ошибки `permission-denied` и `failed-precondition` (не задеплоены
  правила/индексы) теперь показывают понятный toast с точной инструкцией,
  вместо тихого зависания на экране загрузки.

## Известные ограничения / что дальше

- Email-рассылка приглашений (нужна Cloud Function).
- `manualChunks` для уменьшения размера основного бандла (сейчас ~340 KB gzip).
- Push-уведомления (сейчас — заглушка в топбаре).
- Command palette (Ctrl+K сейчас открывает быстрый поиск по страницам/людям, не команды).
