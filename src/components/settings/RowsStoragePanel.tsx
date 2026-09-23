import { useState, useSyncExternalStore } from "react";
import { CheckCircle2, Copy, Database, Loader2, RefreshCw, TriangleAlert, Undo2, UploadCloud } from "lucide-react";
import migrationSql from "../../../supabase/migrations/20260923_desk_rows.sql?raw";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { useRowsBackend } from "@/hooks/useRowsBackend";
import { ROWS_MIGRATION_STALE_MS } from "@/hooks/useRowsBackendBridge";
import { migrationStartMillis } from "@/services/rows/rowsBackend";
import { confirmDialog } from "@/utils/appDialog";
import { fetchDeskObserverUidsFresh } from "@/services/deskObserverService";
import { fetchMembersFresh } from "@/services/memberService";
import { lastAclSync, noteAclSync, subscribeAclSync, syncRowAcl, type AclSyncReport } from "@/services/rows/rowAclService";
import {
  checkRowsHealth,
  clearRowsMigrationFlag,
  migrateRowsToFirestore,
  migrateRowsToSupabase,
  seedSql,
  type MigrationProgress,
  type RowsHealth,
} from "@/services/rows/rowsMigrationService";
import { cn } from "@/utils/cn";
import { setOsManagedDesks } from "@/services/workspaceService";
import {
  adoptOrdersToOsDesks,
  releaseAllOrders,
  type OsAdoptionProgress,
  type OsAdoptionReport,
} from "@/services/rows/osOrderAdoption";

const FIREBASE_PROJECT_ID = "nurba-6e70d";

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} скопирован`);
  } catch {
    toast.error("Браузер не дал скопировать — выделите текст вручную");
  }
}

function Step({ n, done, title, children }: { n: number; done: boolean | null; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          done === true && "border-success/50 bg-success/15 text-success",
          done === false && "border-warning/50 bg-warning/15 text-warning",
          done === null && "border-border text-muted-foreground"
        )}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <div className="font-medium">{title}</div>
        {children}
      </div>
    </div>
  );
}

function ReportLines({ report }: { report: AclSyncReport }) {
  const lines = [
    `участников записано: ${report.membersUpserted}, убрано: ${report.membersRemoved}`,
    `столов записано: ${report.pagesUpserted}`,
    report.observersChanged ? `наблюдателей изменено: ${report.observersChanged}` : null,
  ].filter(Boolean);
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div>{lines.join(" · ")}</div>
      {report.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer">Пропущено: {report.skipped.length}</summary>
          <ul className="mt-1 list-disc pl-4">
            {report.skipped.slice(0, 20).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      {report.errors.length > 0 && (
        <ul className="list-disc pl-4 text-destructive">
          {report.errors.slice(0, 10).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * «Настройки → Строки таблиц» (только Owner): где живут строки столов —
 * Firestore или Supabase — и кнопки переноса туда и обратно. Сама механика —
 * `rowsMigrationService`, права — `rowAclService` и
 * supabase/migrations/20260923_desk_rows.sql.
 */
export function RowsStoragePanel() {
  const { activeWorkspace, allPages, members } = useWorkspace();
  const permissions = usePermissions();
  const workspaceId = activeWorkspace?.id ?? null;
  const backend = useRowsBackend(workspaceId);
  const aclStatus = useSyncExternalStore(subscribeAclSync, lastAclSync, lastAclSync);
  const [health, setHealth] = useState<RowsHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [adoptAt, setAdoptAt] = useState<OsAdoptionProgress | null>(null);
  const [adoptReport, setAdoptReport] = useState<OsAdoptionReport | null>(null);
  const [released, setReleased] = useState<number | null>(null);

  if (!activeWorkspace || !workspaceId) return null;
  const me = permissions.uid ?? "";
  const migrationAt = migrationStartMillis(activeWorkspace.rowsMigrationAt);
  const migrationStale = typeof migrationAt === "number" && Date.now() - migrationAt >= ROWS_MIGRATION_STALE_MS;
  const migrationLive = typeof migrationAt === "number" && !migrationStale;
  const onSupabase = backend === "supabase";
  const rowCountHint = allPages.length;

  async function runCheck() {
    if (!workspaceId) return;
    setChecking(true);
    try {
      setHealth(await checkRowsHealth(workspaceId));
    } catch (error) {
      setHealth({
        ok: false,
        uid: null,
        role: null,
        isOwner: false,
        seeded: false,
        problem: error instanceof Error ? error.message : "Проверка не прошла",
      });
    } finally {
      setChecking(false);
    }
  }

  async function runSyncNow() {
    if (!workspaceId || !activeWorkspace) return;
    setBusy(true);
    setLastError(null);
    try {
      const [members, observers] = await Promise.all([
        fetchMembersFresh(workspaceId),
        fetchDeskObserverUidsFresh(workspaceId),
      ]);
      const report = await syncRowAcl({
        workspaceId,
        ownerId: activeWorkspace.ownerId,
        me,
        realRole: permissions.realRole,
        members,
        pages: allPages,
        observers,
        force: true,
      });
      noteAclSync({ at: Date.now(), ok: report.errors.length === 0, report, error: null });
      if (report.errors.length) toast.error("Права синхронизированы с ошибками — подробности ниже");
      else toast.success("Права синхронизированы");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      noteAclSync({ at: Date.now(), ok: false, report: null, error: message });
      setLastError(message);
    } finally {
      setBusy(false);
    }
  }

  /** Снять зависший флаг переноса — с ответом: молчащая кнопка выглядит сломанной. */
  async function handleClearFlag() {
    if (!workspaceId) return;
    try {
      await clearRowsMigrationFlag(workspaceId);
      toast.success("Флаг переноса снят — правка строк снова разрешена");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error("Не удалось снять флаг переноса");
    }
  }

  const osManaged = Boolean(activeWorkspace?.osManagedDesks);

  async function toggleOsManaged() {
    if (!workspaceId) return;
    setBusy(true);
    try {
      await setOsManagedDesks(workspaceId, !osManaged);
      toast.success(osManaged ? "Технари снова заводят строки сами" : "Заказы теперь заводит только ОС");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error("Не удалось переключить");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Разовый перенос: заказы текущего месяца уезжают под управление ОС.
   * Повтор безопасен — id строки-источника выведен из строки технаря, поэтому
   * второй запуск обновит те же строки, а не размножит их.
   */
  async function runAdoption() {
    if (!workspaceId) return;
    const ok = await confirmDialog({
      title: "Перенести заказы текущего месяца в столы ОС?",
      description:
        "У каждого заказа с ником ОС появится строка в столе этого ОС, а строка технаря перейдёт под управление: " +
        "статус, сумму и клиента в ней будет менять ОС. Заказы без ника ОС и прошлые месяцы не трогаем.",
      confirmLabel: "Перенести",
    });
    if (!ok) return;
    setBusy(true);
    setLastError(null);
    setAdoptReport(null);
    setReleased(null);
    try {
      const report = await adoptOrdersToOsDesks({
        workspaceId,
        members,
        onProgress: setAdoptAt,
      });
      setAdoptReport(report);
      if (report.errors.length) toast.error("Перенос прошёл с ошибками — подробности ниже");
      else toast.success(`Под управление ОС ушло заказов: ${report.adopted}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error("Перенос не прошёл");
    } finally {
      setAdoptAt(null);
      setBusy(false);
    }
  }

  /** Аварийный выход: ОС недоступен, а заказы надо вести дальше. */
  async function runRelease() {
    if (!workspaceId) return;
    const ok = await confirmDialog({
      title: "Снять управление со ВСЕХ заказов?",
      description:
        "Строки останутся на месте и снова станут обычными строками технарей — они смогут менять статус и сумму сами. " +
        "Строки в столах ОС не удаляются.",
      destructive: true,
      confirmLabel: "Снять управление",
    });
    if (!ok) return;
    setBusy(true);
    setLastError(null);
    setAdoptReport(null);
    try {
      const result = await releaseAllOrders({ workspaceId, onProgress: setAdoptAt });
      setReleased(result.released);
      if (result.errors.length) {
        setLastError(result.errors.join(" · "));
        toast.error("Управление снято не везде — подробности ниже");
      } else toast.success(`Управление снято со строк: ${result.released}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error("Не удалось снять управление");
    } finally {
      setAdoptAt(null);
      setBusy(false);
    }
  }

  async function runMigrate(direction: "supabase" | "firestore") {
    if (!workspaceId || !activeWorkspace) return;
    const toSupabase = direction === "supabase";
    const ok = await confirmDialog({
      title: toSupabase ? "Перенести строки таблиц в Supabase?" : "Вернуть строки таблиц в Firestore?",
      description: toSupabase
        ? `Все строки всех столов (${rowCountHint} столов с вкладками) будут скопированы в Supabase и сверены по количеству. ` +
          "На время переноса — обычно минута-две — правка строк у всех приостановится, потом все открытые вкладки перезагрузятся. " +
          "Каждая строка Firestore будет прочитана один раз: делайте это, когда дневная квота не на исходе. Старая копия в Firestore останется как архив."
        : "Строки из Supabase будут записаны обратно в Firestore — каждая строка это одна запись Firestore, следите за дневной квотой (20 000). " +
          "Строки, которых в Supabase нет, из Firestore будут УДАЛЕНЫ: после переноса Firestore станет точной копией Supabase. " +
          "Если не уверены — сначала «Настройки → Бэкап → Скачать бэкап workspace». " +
          "Правка строк на это время приостановится, потом все вкладки перезагрузятся.",
      confirmLabel: toSupabase ? "Перенести" : "Вернуть",
      destructive: !toSupabase,
    });
    if (!ok) return;
    setBusy(true);
    setLastError(null);
    setProgress(null);
    try {
      const report = toSupabase
        ? await migrateRowsToSupabase({
            workspaceId,
            ownerId: activeWorkspace.ownerId,
            me,
            pages: allPages,
            onProgress: setProgress,
          })
        : await migrateRowsToFirestore({ workspaceId, pages: allPages, onProgress: setProgress });
      toast.success(
        `${toSupabase ? "Строки в Supabase" : "Строки в Firestore"}: ${report.rows} строк в ${report.tables} таблицах. Вкладки сейчас перезагрузятся.`
      );
      if (report.acl) noteAclSync({ at: Date.now(), ok: report.acl.errors.length === 0, report: report.acl, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      toast.error("Перенос не завершён — хранилище не переключено");
    } finally {
      setBusy(false);
    }
  }

  // Галочка — только проверенному шагу. Нет SQL — про вход ничего не известно
  // (функция проверки сама в SQL), не принят вход — про SQL тоже.
  const sqlMissing = health?.problem?.includes("шаг 2") ?? false;
  const authRejected = health?.problem?.includes("шаг 1") ?? false;
  const step1 = !health || sqlMissing ? null : !authRejected && health.uid !== null;
  const step2 = !health || authRejected ? null : !sqlMissing;
  const step3 = !health || sqlMissing || authRejected ? null : health.seeded && health.isOwner;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> Где живут строки таблиц
          </CardTitle>
          <CardDescription>
            Строки столов — самая частая операция приложения и главный расход дневной квоты бесплатного Firebase.
            В Supabase суточной квоты на операции нет. Всё остальное (люди, столы, вкладки, заказы, график) остаётся в Firestore.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Сейчас:</span>
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 font-medium",
                onSupabase ? "border-success/40 bg-success/10 text-success" : "border-border bg-muted/40"
              )}
            >
              {backend === null ? "загружается…" : onSupabase ? "Supabase" : "Firestore"}
            </span>
            {migrationLive && (
              <span className="flex items-center gap-1.5 text-warning">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> идёт перенос — правка строк приостановлена
              </span>
            )}
          </div>
          {migrationStale && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-warning">
              <TriangleAlert className="h-4 w-4" />
              <span className="flex-1">Перенос был начат и не закончился (вкладку закрыли?). Хранилище не переключалось.</span>
              <Button size="sm" variant="outline" onClick={() => void handleClearFlag()}>
                Снять флаг
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Настройка Supabase</CardTitle>
          <CardDescription>Один раз. Шаги 1–3 делаются в панели Supabase, потом — «Проверить».</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Step n={1} done={step1} title="Вход через Firebase">
            <p className="text-muted-foreground">
              Supabase → <b>Authentication</b> → <b>Sign In / Providers</b> → <b>Third-party Auth</b> → <b>Add provider</b> →{" "}
              <b>Firebase</b>, Project ID:
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs">{FIREBASE_PROJECT_ID}</code>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Скопировать Project ID"
                className="h-11 w-11 p-0 sm:h-7 sm:w-7"
                onClick={() => void copy(FIREBASE_PROJECT_ID, "Project ID")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Step>
          <Step n={2} done={step2} title="Таблица строк и правила доступа (SQL)">
            <p className="text-muted-foreground">
              Supabase → <b>SQL Editor</b> → <b>New query</b> → вставить и <b>Run</b>. Скрипт можно запускать повторно.
            </p>
            <Button size="sm" variant="outline" className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => void copy(migrationSql, "SQL")}>
              <Copy className="h-3.5 w-3.5" /> Скопировать SQL ({Math.round(migrationSql.length / 1024)} КБ)
            </Button>
          </Step>
          <Step n={3} done={step3} title="Кто владелец workspace">
            <p className="text-muted-foreground">Та же вкладка SQL Editor — одна строка:</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{seedSql(workspaceId, activeWorkspace.ownerId)}</code>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Скопировать SQL владельца"
                className="h-11 w-11 shrink-0 p-0 sm:h-7 sm:w-7"
                onClick={() => void copy(seedSql(workspaceId, activeWorkspace.ownerId), "SQL")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Step>
          <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
            <Button size="sm" className="gap-1.5" onClick={() => void runCheck()} disabled={checking}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Проверить
            </Button>
            {health && (
              <span className={cn("text-sm", health.ok ? "text-success" : "text-warning")}>
                {health.ok ? "Supabase готов: вход, таблицы и владелец на месте." : health.problem}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Заказы заводит только ОС</CardTitle>
          <CardDescription>
            Включено — у технарей в их столах нет «Добавить строку» и «Быстрого заказа»: заказы приходят со столов ОС
            и там же им меняют статус. Сами строки-заказы технарь не правит в любом случае — это держит база.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant={osManaged ? "outline" : "default"}
            className="gap-1.5"
            disabled={busy}
            onClick={() => void toggleOsManaged()}
          >
            {osManaged ? "Выключить" : "Включить"}
          </Button>
          <span className="text-sm text-muted-foreground">
            Сейчас: <span className="font-medium text-foreground">{osManaged ? "только ОС" : "как раньше"}</span>
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Заказы под управление ОС</CardTitle>
          <CardDescription>
            Разовый перенос уже заведённых заказов ТЕКУЩЕГО месяца: у каждого заказа с ником ОС появится строка в столе
            этого ОС, а у технаря она станет строкой-заказом — статус и сумму в ней меняет ОС. Заказы без ника ОС и
            прошлые месяцы остаются как были. Повторный запуск ничего не размножает.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button className="gap-1.5" onClick={() => void runAdoption()} disabled={busy || !onSupabase}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Перенести заказы в столы ОС
            </Button>
            <Button
              variant="outline"
              className="gap-1.5 text-destructive"
              onClick={() => void runRelease()}
              disabled={busy || !onSupabase}
            >
              <Undo2 className="h-4 w-4" />
              Снять управление
            </Button>
          </div>
          {!onSupabase && (
            <p className="text-sm text-muted-foreground">
              Доступно, когда строки живут в Supabase: замок строки-заказа держат политики Postgres.
            </p>
          )}
          {adoptAt && (
            <p className="text-sm text-muted-foreground">
              {adoptAt.done} / {adoptAt.total} · {adoptAt.label}
            </p>
          )}
          {adoptReport && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                Под управление ОС: <span className="font-medium text-foreground">{adoptReport.adopted}</span> из столов:{" "}
                {adoptReport.desks}
              </li>
              {adoptReport.alreadyManaged > 0 && <li>Уже были под управлением: {adoptReport.alreadyManaged}</li>}
              {adoptReport.createdOsDesks > 0 && <li>Заведено столов ОС: {adoptReport.createdOsDesks}</li>}
              {adoptReport.skippedNoOs > 0 && <li>Без ника ОС — остались у технаря: {adoptReport.skippedNoOs}</li>}
              {adoptReport.skippedNoAccount > 0 && (
                <li>Ник ОС без аккаунта — пропущено: {adoptReport.skippedNoAccount}</li>
              )}
              {adoptReport.errors.map((e, i) => (
                <li key={i} className="text-destructive">
                  {e}
                </li>
              ))}
            </ul>
          )}
          {released !== null && (
            <p className="text-sm text-muted-foreground">
              Управление снято со строк: <span className="font-medium text-foreground">{released}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Перенос</CardTitle>
          <CardDescription>
            Переключение происходит только после сверки: в каждой таблице строк должно быть поровну. Не сошлось —
            хранилище остаётся прежним, старая копия не трогается.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {!onSupabase ? (
              <Button
                className="gap-1.5"
                onClick={() => void runMigrate("supabase")}
                disabled={busy || migrationLive || !health?.ok || backend === null}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Перенести строки в Supabase
              </Button>
            ) : (
              <>
                <Button variant="outline" className="gap-1.5" onClick={() => void runSyncNow()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Синхронизировать права сейчас
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5 text-destructive"
                  onClick={() => void runMigrate("firestore")}
                  disabled={busy || migrationLive || !health?.ok}
                >
                  <Undo2 className="h-4 w-4" /> Вернуть строки в Firestore
                </Button>
              </>
            )}
          </div>
          {!health?.ok && (
            <p className="text-xs text-muted-foreground">Кнопки переноса станут доступны после успешной «Проверить».</p>
          )}
          {progress && busy && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {progress.label} {progress.total > 1 ? `· ${progress.done}/${progress.total}` : ""}
              </div>
            </div>
          )}
          {lastError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{lastError}</div>
          )}
          {aclStatus && (
            <div className="space-y-1 border-t border-border/60 pt-3">
              <div className="text-sm">
                Последняя сверка прав: {new Date(aclStatus.at).toLocaleTimeString("ru-RU")} —{" "}
                <span className={aclStatus.ok ? "text-success" : "text-destructive"}>{aclStatus.ok ? "без ошибок" : "с ошибками"}</span>
              </div>
              {aclStatus.error && <div className="text-xs text-destructive">{aclStatus.error}</div>}
              {aclStatus.report && <ReportLines report={aclStatus.report} />}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
