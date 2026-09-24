---
name: nova-crm-deep-dive
description: Deep architectural reference for Nova CRM — table rows in Firestore OR Supabase (hybrid row store), statusOptions model history, full Storage/Supabase details, Table v2/v2.1 engine internals (drag-to-fill, filters, keyboard routing, dedup), the full "already implemented" feature list, and the discussed-but-not-built backlog. Load this before making non-trivial changes to DataTable.tsx, services/rows/*, pageService.ts/subPageService.ts row or column CRUD, columnOptions.ts, or Supabase Storage upload code — CLAUDE.md only keeps the must-never-violate rules; this skill has the "why" and the deep mechanics.
---

# Nova CRM — deep architecture reference

This is the detail CLAUDE.md deliberately keeps out of the always-loaded context. Read this
skill on demand — before touching row/column CRUD, the hybrid row store, statusOptions
resolution, or the Table v2 engine — rather than assuming CLAUDE.md's short rules already
cover the mechanics.

## Supabase Storage (files/covers)

Firebase Storage is still unused (no Blaze plan). File uploads go through **Supabase Storage**
instead:

- `src/lib/supabase.ts` — Supabase client (anon key hardcoded, same posture as the Firebase web
  API key; access is gated by Storage bucket policies, not key secrecy).
- Bucket `row-files` (`ROW_FILES_BUCKET`): `{workspaceId}/{pageId}/{rowId}/{id}_{filename}` for
  row attachments, `{workspaceId}/covers/{pageId}/{uuid}.ext` for desk covers.
- Row attachments (`rowAttachmentService.ts`, `RowAttachment` type in `src/types/page.ts`) — up
  to 10MB, `jpeg/png/webp/gif/avif/pdf` only. Shown in both the table cell and `RowCardSheet`.
- Desk cover (`deskCoverService.ts`) — up to 10MB, `jpeg/png/webp` only, feeds the `/desks` grid.
- The `url` column type ("Ссылка"/"Диск URL") is a manual-link alternative to uploading, kept
  for cases where a Supabase upload is overkill.

## Table rows: Firestore OR Supabase (hybrid, since 2026-09-23)

The old `row_records` mirror (`rowRecordsService.ts`, Firestore + an anon-key copy in Supabase)
is **gone** — it read every desk twice and never saved Firestore quota. Now each workspace keeps
its rows in exactly ONE store, chosen by `workspace.rowsBackend` (`"supabase"` → Postgres table
`desk_rows`; absent → Firestore). Full design, rationale and test counts: CLAUDE.md, section
«Строки таблиц: гибрид Firestore + Supabase». Mechanics to know before touching row CRUD:

- Every row function in `pageService.ts`/`subPageService.ts` (plus `rowAttachmentService`,
  `backupService`, `pageSnapshotService`, `osDeskStatsService`) branches on
  `usesSupabaseRows(workspaceId)` into `services/rows/supabaseRowStore.ts`. A NEW row
  read/write path must branch the same way — a Firestore-only write in Supabase mode is rejected
  by firestore.rules (`rowsWritableHere`) for everyone — the Owner too, unless a rollback is
  running (`rowsMigrationAt` fresh). Supabase has the mirror lock: `rows_workspaces.live` /
  `migrating_until` (`rows_set_state`, Owner only) — `desk_rows` accepts writes only in
  `rows_writable_workspaces()`.
- Every row write calls `assertRowsWritable(workspaceId)` first (blocked while a migration runs).
- Supabase row writes are merge semantics done INSIDE Postgres (`rows_patch` RPC: `cells ||
  patch`, extras keep/set/clear, highlight, filledAt, orderId, attachments, height). Don't
  reintroduce read-modify-write in the browser.
- Row identity in Postgres is `(workspace_id, page_id, tab_id, id)`; `tab_id = ''` is «Основная».
  `recordToRow` sets `pageId` to the tab id for tab rows, like Firestore docs did.
- Reads page through PostgREST's row cap (`fetchPaged`: first page asks `count: exact`, loop
  until that many). An EMPTY one-shot read (`sbFetchRows`/`sbFetchRowsSince`/`sbFetchAllPageRows`)
  is checked with `rows_page_access` and throws `permission-denied`/`unavailable` when the desk
  isn't readable — callers expect Firestore's loud denial, not an empty table
  (`{ assertAccess: false }` opts out).
- Live rows (`sbSubscribeRows`): fetch + Realtime `postgres_changes` on `page_id` (+ an
  unfiltered DELETE listener; out-of-scope events are dropped before anything else), full
  refetch on every (re)subscribe and on tab focus. UPDATE payloads are MERGED onto the stored raw
  record (`serverRecords`) — TOASTed jsonb (big `cells`, `attachments`) is omitted from update
  events; unknown row + missing fields → refetch. Realtime-driven renders are coalesced (16 ms);
  own optimistic edits render synchronously.
- Writes to one row are serialized (`sequenced`, lane = ws|page|tab, per row id; table-wide ops
  wait for and block everything in the lane) — separate HTTP requests could otherwise land out
  of order. A committed overlay not confirmed by an event within 5 s triggers a refetch.
- Access in Postgres = a COPY of Firestore ACL (`rows_members`, `rows_page_acl`,
  `rows_desk_observers`, `rows_workspaces`) kept in sync by `useRowAclSync` /
  `services/rows/rowAclService.ts`; RLS lives in `supabase/migrations/20260923_desk_rows.sql`
  and is tested by `supabase/tests/desk_rows_rls.sql`.

## statusOptions resolution model

`getColumnOptions()` (`src/utils/columnOptions.ts`) for a `status`-type column **always** reads
`workspace.statusOptions` (falling back to `DEFAULT_STATUS_OPTIONS`) — `column.statusOptions` is
never read for that type (the field is marked "DEAD for type status" in `src/types/page.ts`).
Status, Ответственный, and custom fields are all fully workspace-wide; there is no per-column
override for any of them despite an intermediate, since-reverted version of this doc claiming
otherwise for Status. `DataTable.tsx`'s `displayColumns` memo overwrites every column's
`.statusOptions` with `getColumnOptions()`'s result, so Kanban and the table dropdown always see
the identical list.

- `firestore.rules`'s `columnStatusOptionsPreserved()` lets a Технарь/responsible person change a
  column's other fields (label/width/order) freely, but changing the shared
  `workspace.statusOptions` list itself is Owner-only — a non-owner write attempting that gets
  `permission-denied`.
- `ensureDoneStatus()`/`isDoneStatusLabel()`/`findDoneStatusOption()` guarantee a resolved
  status list always has something "Готово"-shaped (substring match: "готов", "done", "успеш",
  "закрыт"), even if the Owner deleted it — otherwise confetti/leaderboard/"Готово" grouping
  break silently. `isDoneStatusLabel()` explicitly excludes a label containing a standalone
  "не" token ("Не готово") — a plain substring match used to also count that as done, corrupting
  the "Не готово" filter, the `notDone` counter, confetti, and `markRowDone()` (swipe/button/
  Ctrl+D) whenever a negated status existed.
- A column's own `statusOptions` field can still carry a **stale non-empty value** on legacy
  columns from before this model — `changeColumnType`/`changeSubPageColumnType` must carry that
  value forward (not drop it) when the caller doesn't pass a new one, or the diff
  `columnStatusOptionsPreserved()` sees turns "unchanged" into "removed" and silently rejects
  the whole write for a non-Owner responsible person.

## Firestore collection-group queries need an explicit `{path=**}` rule

A nested `match /workspaces/{workspaceId}/members/{memberId}` rule does **not** authorize a
`collectionGroup(db, "members")` query — Firestore only applies a rule to that query shape when
written with the recursive `{path=**}` wildcard at the top level. Missing this rule made
`claimPendingInvites()` (invite auto-claim on login) permission-denied for every user, silently,
for a long time — see `firestore.rules`'s `match /{path=**}/members/{memberId}` block. If you
ever add a new `collectionGroup()` query anywhere in the client, you need a matching top-level
`{path=**}` rule or it will always fail the same way.

## What's already implemented (beyond the original build)

Base build already had: shared option lists, undo/redo, the smart table, dashboard with
leaderboard, command palette, backup/export, change history. Added since (~90+ commits):

- **Kanban view** (table/Kanban toggle, only shown when a "Статус" column exists) — drag&drop
  between status columns goes through the exact same status-change path as the dropdown
  (undo/redo, confetti on "Готово" both work identically). `src/components/table/KanbanView.tsx`.
- **Desks instead of pages** — `/desks` (cover-photo grid via Supabase), `/people` (member list,
  moved out of the sidebar), `/dashboard` (its own screen: charts/leaderboard), `HomePage`
  smart-redirects to your own responsible desk if you have one.
- **Hidden desks + view requests** (`viewRequestService.ts`, `viewRequests` collection) —
  instead of a hard "no access," you can `requestDeskView()`; the responsible person approves/
  rejects with a notification; approval grants `allowedUsers` access via `toggleUserPageAccess`.
- **Row attachments + desk cover photos** via Supabase Storage (see section above).
- **`url` column type** ("Ссылка") — 8th base column type, link-only alternative to uploading.
- **Hidden columns** — `PageColumn.hidden` stays in the schema, just not rendered.
- **Quick status filter chips** in the toolbar — "Все"/"Не готово"
  (`NOT_DONE_STATUS_FILTER`)/per-status, layered on top of normal grouping.
- **Mobile-collapsed toolbar** — most controls (grouping, density, view switch, CSV, add column)
  fold into one "⋯" dropdown on small screens; search becomes a tap-to-expand icon.
- **Unread badges** on Messages/Chat nav items.
- **Default row order** is now a `createdAt` ledger (new rows always at the bottom) instead of
  an arbitrary `order` field; header-click sort is optional, layered on top of this default.
- **Mobile desk rework** — swipe/double-tap on status, sticky columns without visual seams,
  phone-safe bulk-action panel, iOS viewport-height fixes, clipboard (Ctrl+Alt+C copies a row as
  TSV, Ctrl+Space selects a column).
- **Visual theme** — since 24.09.2026 «один акцент, плоско» (neutral dark tokens, single teal
  accent, no glass/glow/gradients; 64px icon rail). The earlier «Nova OS» neon/glass theme and GSAP
  are gone: shell animations are CSS `@keyframes nova-fade-in` (opacity only, no transform). See
  «Дизайн экранов» in CLAUDE.md.
- **Desk Studio** — the responsible person can customize their own desk's look independent of
  the shared theme.

## Known, deliberate limitations (not bugs)

- Leaderboard only updates when the responsible person themselves opens their dashboard — no
  backend job refreshes it for them. Long-absent people show stale numbers. (A hidden desk's
  "Готово" total not counting toward the leaderboard WAS a real bug — now fixed, it counts.)
- Undo/redo only covers the current user's current browser tab/session — doesn't restore other
  people's actions, doesn't survive `F5`.
- Personal Space (`personalZones/{uid}/reports`) is a fully isolated subsystem with its own
  hardcoded statuses — never conflate with the general Статус/Ответственный/custom-field system.
- Rows live in ONE store at a time (`workspace.rowsBackend`). After a move to Supabase the
  Firestore rows are a frozen archive (writable by the Owner only while a move back runs) — not a
  live backup; migration moves only rows visible to the app (`orderBy("order")` — docs without
  `order` are skipped both ways) and converts Timestamp dates to ms (`firestoreDocToRow`); the JSON backup (`backupService`) reads whichever store is current.

## Discussed but NOT built

Saved views (filter+group+sort combos), if-then automation/notification rules, amoCRM/Excel
import, a Telegram bot, computed/formula columns, a public lead-capture form, a client portal,
custom roles, offline/PWA mode, swipe actions on mobile for fields other than status (status
already has it; anything else risks conflicting with horizontal scroll on a wide touch table).

## Table v2 engine internals (September 2026 build)

Full list in `CHANGELOG.md`. Key architecture:

- **`confirmDialog()`/`promptDialog()`** (`src/utils/appDialog.ts`) — the only way to ask for
  confirmation or a string. `window.confirm`/`window.prompt` are gone from the project; the host
  `AppDialogHost` is mounted in `AppLayout`. Usage:
  `if (!(await confirmDialog({ title, description, destructive: true }))) return;`
- **Numbers are stored canonically** (`src/utils/numberInput.ts`, `normalizeNumericInput`): a
  number/currency cell is normalized on commit/paste ("1 500,50" → "1500.5").
  `parseLooseNumber` is the single parser for totals, grouping, Kanban.
- **Column totals** (`src/utils/columnAggregates.ts`) — the chosen aggregate per view lives in
  `localStorage` (`nova-crm:column-aggregates:<viewKey>`), nothing written to Firestore.
- **Column filters key by the cell's RAW value** (`filters[colKey]: Set<rawValue>`), display via
  `FilterValueEntry { value, label, count, color }`. Never compare by label — that was the old
  status-column filter bug.
- **Search** compares both raw and `cellDisplayText()` (status label / formatted date).
- **Keyboard**: `openRequest` (DataTable → TableRow → TableCell) is a counter the active
  picker-cell uses to open its Radix Select (via a synthetic Enter keydown, so the global
  handler ignores `!e.isTrusted`) or calendar. Space opens the row card. While a row card is
  open (`expandedRowId`), the table's own key handler goes fully silent.
- **RowCardSheet is editable** — `onCellChange` = `handleStatusChange` (persist + undo + confetti).
- Tailwind: added an `xs: 420px` breakpoint.

### Table v2.1
- **Drag-to-fill**: `handleFillStart` → `fillDragRef` (source = current selection) →
  `fillPreview` (render-only) → `applyFill` writes every cell and pushes ONE undo command. The
  handle (`.table-fill-handle`) is drawn inside the `td` because `td` has `overflow:hidden`.
- **Quick filters**: `dateFilter {colKey, preset}` (`src/utils/dateRanges.ts`, Almaty-day
  boundaries) and `mineOnly` (matches nickname/name against `responsibleOptions[].label`). Both
  feed `hasActiveFilters`/`resetAllFilters` and the `ActiveFiltersBar` chips.
- **Duplicates**: `normalizeContact()` in DataTable; a badge in TableCell (`isDuplicate`),
  clicking it filters the column to raw values sharing the same normalized contact.
- `useUndoState()` in `undoStore.ts` powers the Undo/Redo buttons; `pushUndoCommand` calls `emit()`.
