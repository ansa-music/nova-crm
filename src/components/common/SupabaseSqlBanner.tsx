import { useEffect, useState, useSyncExternalStore } from "react";
import { Copy, Database, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { sqlEditorUrl } from "@/services/sb/sqlEditorUrl";
import {
  probeSbTable,
  sbTableRecheckDue,
  sbTableState,
  sbTablesVersion,
  subscribeSbTables,
  type CollectionKey,
} from "@/services/sb/sbCollections";
import {
  probeSchemaVersion,
  schemaVersionRecheckDue,
  schemaVersionState,
  schemaVersionTick,
  subscribeSchemaVersion,
} from "@/services/sb/sbSchemaVersion";

export { REQUIRED_SQL_VERSION } from "@/services/sb/sbSchemaVersion";

/**
 * Коллекции, которые уже умеют жить в Supabase. Пока их таблиц нет в базе,
 * всё работает по-старому через Firestore — и экономии квоты НЕТ. Деплой SQL
 * сам не накатывает (секрета нет), поэтому Owner должен узнать об этом не из
 * глубины настроек, а сразу: 24.09.2026 фаза 1 уехала в прод, а Firebase
 * продолжал тратить столько же — SQL никто не вставил.
 */
const WATCHED: CollectionKey[] = ["deskLoads", "presence", "notifications", "osOrders"];
const HIDE_KEY = "nova:sql-banner-hidden-until";
const HIDE_FOR_MS = 24 * 60 * 60_000;

function hiddenNow(): boolean {
  try {
    return Number(window.localStorage.getItem(HIDE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * Плашка Owner: «экономия Firebase выключена — вставьте SQL в Supabase».
 * Три кнопки: скопировать SQL, открыть SQL Editor проекта, проверить.
 * Видна, пока хоть одной таблицы нет (строки уже в Supabase, иначе копии
 * прав нет и коллекции туда всё равно не пойдут) ИЛИ SQL в базе старее
 * `REQUIRED_SQL_VERSION` (`nova_schema_version()` нет или меньше): без него
 * статус от ОС не доходит до технаря сразу, а заказы технарей с ником ОС не
 * приезжают на стол ОС — клиент молча работает по-старому. Скрыть можно на
 * сутки.
 */
export function SupabaseSqlBanner() {
  const permissions = usePermissions();
  const { activeWorkspace } = useWorkspace();
  useSyncExternalStore(subscribeSbTables, sbTablesVersion, sbTablesVersion);
  useSyncExternalStore(subscribeSchemaVersion, schemaVersionTick, schemaVersionTick);
  const [hidden, setHidden] = useState(hiddenNow);
  const [checking, setChecking] = useState(false);
  // Текст SQL (~сотня КБ) — отдельным чанком, только когда плашка нужна:
  // в стартовый набор он раздувал главный чанк на 30 КБ gzip у всех. Грузим
  // заранее, а не по клику: копирование после ожидания сети браузер может
  // не пустить без свежего жеста.
  const [sql, setSql] = useState<string | null>(null);

  const isOwner = permissions.isResolved && permissions.realRole === "owner";
  const rowsOnSupabase = activeWorkspace?.rowsBackend === "supabase";
  const active = isOwner && rowsOnSupabase;

  // Один раз на вкладку спросить базу про таблицы, о которых ещё ничего не
  // знаем (или давно сказали «нет»): иначе плашка молчала бы до первого
  // экрана, который сам их спросит.
  useEffect(() => {
    if (!active) return;
    for (const key of WATCHED) {
      if (sbTableState(key) === "unknown" || sbTableRecheckDue(key)) void probeSbTable(key);
    }
    if (schemaVersionState() === "unknown" || schemaVersionRecheckDue()) void probeSchemaVersion();
  }, [active]);

  const missingCount = active ? WATCHED.filter((key) => sbTableState(key) === "missing").length : 0;
  const sqlOld = active && schemaVersionState() === "old";
  const needed = active && !hidden && (missingCount > 0 || sqlOld);
  useEffect(() => {
    if (!needed || sql !== null) return;
    let cancelled = false;
    void import("@/services/sb/migrationSql").then((module) => {
      if (!cancelled) setSql(module.migrationSql);
    });
    return () => {
      cancelled = true;
    };
  }, [needed, sql]);

  if (!needed) return null;

  async function copySql() {
    try {
      const text = sql ?? (await import("@/services/sb/migrationSql")).migrationSql;
      await navigator.clipboard.writeText(text);
      toast.success("SQL скопирован — вставьте его в SQL Editor и нажмите Run");
    } catch {
      toast.error("Браузер не дал скопировать — «Настройки → Строки таблиц → Скопировать SQL»");
    }
  }

  async function check() {
    setChecking(true);
    try {
      const [states, schema] = await Promise.all([
        Promise.all(WATCHED.map((key) => probeSbTable(key))),
        probeSchemaVersion(),
      ]);
      if (states.every((state) => state === "present") && schema === "ok") {
        toast.success("Готово: база строк обновлена — статус к технарю идёт сразу, заказы технарей с ником ОС едут на стол ОС");
      } else if (states.every((state) => state === "present")) {
        toast.error("SQL пока не свежий — вставьте его ещё раз целиком и нажмите Run");
      } else {
        toast.error("SQL пока не вставлен — таблиц ещё нет");
      }
    } finally {
      setChecking(false);
    }
  }

  function hide() {
    try {
      window.localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_FOR_MS));
    } catch {
      /* без localStorage — скрываем до перезагрузки */
    }
    setHidden(true);
  }

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[12.5px]"
    >
      <Database className="h-4 w-4 shrink-0 text-warning" />
      {missingCount > 0 ? (
        <p className="min-w-0 flex-1 basis-64 text-foreground">
          <b className="font-medium text-warning">Экономия Firebase ещё не включена.</b> В Supabase не вставлено
          обновление базы — счётчики столов, «в сети», уведомления и заказы ОС пока идут через Firebase и тратят его
          лимит. Скопируйте SQL, откройте SQL Editor, вставьте и нажмите <b>Run</b> — около минуты.
        </p>
      ) : (
        <p className="min-w-0 flex-1 basis-64 text-foreground">
          <b className="font-medium text-warning">Базе строк нужен свежий SQL.</b> Без него не работают «статус к
          технарю сразу» и «заказы технарей с вашим ником — на стол ОС»: статус от ОС доходит, только пока открыт
          стол ОС, а заказы с ником ОС сами не приезжают. Скопируйте SQL, откройте SQL Editor, вставьте и нажмите{" "}
          <b>Run</b> — около минуты.
        </p>
      )}
      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
        <button
          type="button"
          onClick={() => void copySql()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-warning px-3 font-medium text-warning-foreground hover:bg-warning/90 sm:min-h-0 sm:py-1.5"
        >
          <Copy className="h-3.5 w-3.5" /> Скопировать SQL
        </button>
        <a
          href={sqlEditorUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-warning/40 px-3 text-warning hover:bg-warning/10 sm:min-h-0 sm:py-1.5"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Открыть SQL Editor
        </a>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-foreground hover:bg-accent disabled:opacity-60 sm:min-h-0 sm:py-1.5"
        >
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Проверить
        </button>
        <button
          type="button"
          onClick={hide}
          aria-label="Скрыть на сутки"
          title="Скрыть на сутки"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground sm:h-8 sm:w-8"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
