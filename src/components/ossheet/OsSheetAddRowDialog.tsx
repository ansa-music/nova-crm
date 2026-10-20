import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addOsSheetRow, osSheetErrorText } from "@/services/osSheetService";
import { formatDate } from "@/utils/date";
import { checkOsSheetValue, columnTitle, osEditReasonText, type OsSheetTab } from "@/utils/osSheet";

/**
 * Новая строка в конец листа «Таблицы ОС»: поле на каждый видимый столбец,
 * кроме формул (их таблица досчитает сама — скрипт протягивает формулы и
 * списки с прошлой строки). Дата — сегодняшняя, «Менеджер ОС» и похожие
 * списки — свой ник, если он есть среди вариантов.
 */
export function OsSheetAddRowDialog({
  workspaceId,
  tab,
  myName,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  tab: OsSheetTab;
  myName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fields = useMemo(() => {
    const hidden = new Set(tab.meta.hiddenCols);
    return tab.meta.cols
      .map((col, c) => ({ c, col, title: columnTitle(tab, c) }))
      .filter(({ c, col }) => !col.formula && !hidden.has(c));
  }, [tab]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = formatDate(Date.now(), "dd.MM.yyyy");
    const mine = myName.trim().toLowerCase();
    const initial: Record<number, string> = {};
    let dated = false;
    for (const { c, col } of fields) {
      if (col.kind === "d" && !dated) {
        initial[c] = today;
        dated = true;
      } else if (col.kind === "l" && mine && col.options.some((o) => o.trim().toLowerCase() === mine)) {
        initial[c] = col.options.find((o) => o.trim().toLowerCase() === mine) ?? "";
      }
    }
    setValues(initial);
  }, [open, fields, myName]);

  const submit = async () => {
    const cells: Array<[number, string]> = [];
    for (const { c, col, title } of fields) {
      const raw = values[c] ?? "";
      if (!raw.trim()) continue;
      const checked = checkOsSheetValue(col, raw);
      if (!checked.ok) {
        toast.error(`${title}: ${osEditReasonText(checked.reason)}`);
        return;
      }
      cells.push([c, checked.value]);
    }
    if (cells.length === 0) {
      toast.error("Заполните хотя бы одно поле");
      return;
    }
    setBusy(true);
    try {
      await addOsSheetRow(workspaceId, tab, cells);
      toast.success("Строка отправлена в таблицу");
      onOpenChange(false);
    } catch (e) {
      toast.error(osSheetErrorText(e, "Не удалось добавить строку"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-os-sheet-add>
        <DialogHeader>
          <DialogTitle>Новая строка</DialogTitle>
          <DialogDescription>
            Ляжет в конец листа «{tab.meta.name}». Столбцы с формулами таблица заполнит сама.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto pr-1"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {fields.map(({ c, col, title }) => {
            const id = `os-add-${c}`;
            const value = values[c] ?? "";
            const set = (v: string) => setValues((prev) => ({ ...prev, [c]: v }));
            return (
              <label key={c} htmlFor={id} className="flex flex-col gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">{title}</span>
                {col.kind === "l" && !col.allowInvalid && col.options.length > 0 ? (
                  <select
                    id={id}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {col.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : col.kind === "b" ? (
                  <select
                    id={id}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    <option value="TRUE">Да</option>
                    <option value="FALSE">Нет</option>
                  </select>
                ) : (
                  <>
                    <Input
                      id={id}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      inputMode={col.kind === "n" ? "decimal" : undefined}
                      placeholder={col.kind === "d" ? "ДД.ММ.ГГГГ" : undefined}
                      list={col.kind === "l" ? `${id}-list` : undefined}
                    />
                    {col.kind === "l" && (
                      <datalist id={`${id}-list`}>
                        {col.options.map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    )}
                  </>
                )}
              </label>
            );
          })}
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background pt-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              Добавить
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
