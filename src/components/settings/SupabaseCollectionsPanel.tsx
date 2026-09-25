import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  SB_COLLECTION_KEYS,
  SB_COLLECTION_LABELS,
  SB_TABLES,
  probeSbTable,
  sbSettingOf,
  sbTableState,
  sbTablesVersion,
  setSbCollectionSetting,
  subscribeSbTables,
  type CollectionKey,
  type SbSetting,
} from "@/services/sb/sbCollections";
import { cn } from "@/utils/cn";

/**
 * Какие коллекции уже УМЕЮТ жить в Supabase. Остальные пока всегда в
 * Firestore — их настройку можно поставить заранее, она подхватится, когда
 * придёт код переноса.
 */
const WIRED: ReadonlySet<CollectionKey> = new Set<CollectionKey>(["deskLoads", "presence", "notifications", "osOrders"]);

const SETTINGS: { value: SbSetting; label: string }[] = [
  { value: "auto", label: "Авто" },
  { value: "firestore", label: "Firestore" },
  { value: "supabase", label: "Supabase" },
];

type Tone = "ok" | "warn" | "muted";

/**
 * «Хранилища Supabase» — где живут переносимые коллекции (счётчики столов и
 * дальше уведомления, заказы ОС, чаты). Только Owner. Действий от Nurba не
 * нужно: после вставки SQL коллекция в режиме «Авто» переезжает сама;
 * «Firestore» — откат одной кнопкой, «Supabase» — принудительно.
 */
export function SupabaseCollectionsPanel() {
  const { activeWorkspace } = useWorkspace();
  const permissions = usePermissions();
  useSyncExternalStore(subscribeSbTables, sbTablesVersion, sbTablesVersion);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState<CollectionKey | null>(null);
  const rowsOnSupabase = activeWorkspace?.rowsBackend === "supabase";

  async function probeAll() {
    setChecking(true);
    try {
      await Promise.all(SB_COLLECTION_KEYS.map((key) => probeSbTable(key)));
    } finally {
      setChecking(false);
    }
  }

  // Открыли панель — спросить базу про все таблицы: статус должен быть
  // правдой сейчас, а не памятью десятиминутной давности.
  useEffect(() => {
    if (rowsOnSupabase) void probeAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsOnSupabase]);

  if (!activeWorkspace || !permissions.actsAsOwner) return null;
  const workspace = activeWorkspace;

  function statusOf(key: CollectionKey): { text: string; tone: Tone } {
    const setting = sbSettingOf(workspace, key);
    const state = sbTableState(key);
    if (!rowsOnSupabase) return { text: "Firestore: строки таблиц ещё в Firestore", tone: "muted" };
    if (setting === "firestore") return { text: "Firestore: выключено вручную", tone: "warn" };
    if (!WIRED.has(key)) return { text: "Firestore: перенос появится в следующих обновлениях", tone: "muted" };
    if (state === "missing") {
      return {
        text: setting === "supabase" ? "Supabase (принудительно), но SQL не накатан — пока Firestore" : "Firestore: SQL не накатан",
        tone: "warn",
      };
    }
    if (state === "unknown") return { text: checking ? "Проверяем базу…" : "Supabase — таблица ещё не проверена", tone: "muted" };
    return { text: setting === "supabase" ? "Supabase (принудительно)" : "Supabase (авто)", tone: "ok" };
  }

  async function choose(key: CollectionKey, setting: SbSetting) {
    if (sbSettingOf(workspace, key) === setting) return;
    setSaving(key);
    try {
      await setSbCollectionSetting(workspace.id, key, setting);
      toast.success(
        setting === "firestore"
          ? `${SB_COLLECTION_LABELS[key]}: обратно в Firestore`
          : setting === "supabase"
            ? `${SB_COLLECTION_LABELS[key]}: принудительно в Supabase`
            : `${SB_COLLECTION_LABELS[key]}: авто`
      );
    } catch {
      toast.error("Не удалось сохранить настройку");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-4 w-4" /> Хранилища Supabase
        </CardTitle>
        <CardDescription>
          Часть данных, которые все читают постоянно, переезжает из Firestore в Supabase — там нет дневной квоты, и
          цифры обновляются за секунды. В режиме «Авто» коллекция переезжает сама, как только её SQL вставлен
          (кнопка «Скопировать SQL» в блоке «Строки таблиц» выше — она берёт все файлы). «Firestore» — откат,
          «Supabase» — принудительно. Открытые вкладки переключаются сами.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!rowsOnSupabase && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Пока строки таблиц в Firestore, всё остальное тоже остаётся там: права для Supabase копируются только при
            строках в Supabase.
          </p>
        )}
        <ul className="flex flex-col divide-y divide-border/60">
          {SB_COLLECTION_KEYS.map((key) => {
            const setting = sbSettingOf(workspace, key);
            const status = statusOf(key);
            return (
              <li key={key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{SB_COLLECTION_LABELS[key]}</div>
                  <div
                    className={cn(
                      "text-xs",
                      status.tone === "ok" && "text-success",
                      status.tone === "warn" && "text-warning",
                      status.tone === "muted" && "text-muted-foreground"
                    )}
                  >
                    {status.text}
                    <span className="text-muted-foreground"> · таблица {SB_TABLES[key]}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={SB_COLLECTION_LABELS[key]}>
                  {SETTINGS.map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={setting === option.value ? "default" : "outline"}
                      role="radio"
                      aria-checked={setting === option.value}
                      className="min-h-11 sm:min-h-0"
                      disabled={saving === key}
                      onClick={() => void choose(key, option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void probeAll()} disabled={checking || !rowsOnSupabase}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Проверить таблицы
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
