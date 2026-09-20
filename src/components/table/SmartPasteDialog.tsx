import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ClipboardPaste, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColumnTypeIcon } from "@/components/table/ColumnTypeIcon";
import { cn } from "@/utils/cn";
import type { PasteMappingResult } from "@/utils/pasteMapping";
import type { PageColumn } from "@/types";

const SKIP = "__skip__";

export interface SmartPasteRequest {
  /** Матрица из буфера как есть — вместе со строкой заголовков, если она там была. */
  matrix: string[][];
  /** Столбцы стола-приёмника в экранном порядке. */
  columns: PageColumn[];
  guess: PasteMappingResult;
  /** Сколько строк доступно от активной и ниже — по ним считаем нехватку. */
  availableRows: number;
  /** Подпись источника для шапки диалога («Excel» / «стол «Айбек»»). */
  sourceLabel: string;
}

export interface SmartPasteResult {
  /** Ключ столбца на каждый столбец вставки; null — пропустить. */
  mapping: (string | null)[];
  hasHeader: boolean;
  createMissing: boolean;
  /** Вставить по порядку от активной ячейки, без раскладки по столбцам. */
  positional: boolean;
}

interface SmartPasteDialogProps {
  request: SmartPasteRequest | null;
  onCancel: () => void;
  onApply: (result: SmartPasteResult) => void;
}

/**
 * Куда лягут столбцы из чужой таблицы. Раскладку подбираем сами, но показываем
 * её до записи: вставка в таблицу — операция разрушительная, а «номер уехал в
 * цену» замечают через неделю. Предзаполнено так, что обычный путь — Enter.
 */
export function SmartPasteDialog({ request, onCancel, onApply }: SmartPasteDialogProps) {
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [hasHeader, setHasHeader] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);

  useEffect(() => {
    if (!request) return;
    setMapping(request.guess.mapping);
    setHasHeader(request.guess.hasHeader);
    setCreateMissing(true);
  }, [request]);

  const width = request ? Math.max(1, ...request.matrix.map((line) => line.length)) : 0;
  const body = useMemo(() => {
    if (!request) return [];
    return hasHeader ? request.matrix.slice(1) : request.matrix;
  }, [request, hasHeader]);

  const headers = useMemo(() => {
    if (!request) return null;
    // Подписи скопированных столбцов важнее строки заголовков: копия из CRM
    // приносит их с собой, и галочка «первая строка — заголовки» их не трогает.
    if (request.guess.headers && !request.guess.hasHeader) return request.guess.headers;
    return hasHeader ? request.matrix[0] : null;
  }, [request, hasHeader]);

  if (!request) return null;

  const columnsByKey = new Map(request.columns.map((c) => [c.key, c]));
  const mappedCount = mapping.filter(Boolean).length;
  // Нехватка строк зависит от галочки заголовков: снятая строка — минус строка.
  const missing = Math.max(0, body.length - request.availableRows);

  function pick(index: number, value: string) {
    setMapping((prev) => {
      const next = [...prev];
      const key = value === SKIP ? null : value;
      // Один столбец стола — один источник, иначе второй молча затрёт первый.
      if (key) {
        for (let i = 0; i < next.length; i++) if (i !== index && next[i] === key) next[i] = null;
      }
      next[index] = key;
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" /> Вставить данные
          </DialogTitle>
          <DialogDescription>
            {body.length} стр. × {width} стб. из «{request.sourceLabel}». Проверьте, куда лягут столбцы.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {request.matrix.length > 1 && !request.guess.headers?.length && (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <span className="text-sm">Первая строка — заголовки</span>
              <Switch checked={hasHeader} onCheckedChange={setHasHeader} />
            </label>
          )}

          <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin">
            {Array.from({ length: width }, (_, i) => {
              const target = mapping[i] ? columnsByKey.get(mapping[i]!) : undefined;
              const samples = body
                .map((line) => (line[i] ?? "").trim())
                .filter(Boolean)
                .slice(0, 3);
              return (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    target ? "border-border/60 bg-background" : "border-dashed border-border/50 bg-muted/10"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{headers?.[i]?.trim() || `Столбец ${i + 1}`}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{samples.join(" · ") || "пусто"}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Select value={mapping[i] ?? SKIP} onValueChange={(v) => pick(i, v)}>
                      <SelectTrigger className="h-9 w-[46%] min-w-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[90]">
                        <SelectItem value={SKIP}>Пропустить</SelectItem>
                        {request.columns.map((col) => (
                          <SelectItem key={col.key} value={col.key}>
                            <span className="flex items-center gap-1.5">
                              <ColumnTypeIcon type={col.type} className="h-3.5 w-3.5" />
                              {col.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>

          {missing > 0 && (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <span className="text-sm">
                Ниже не хватает {missing} строк — создать
                <span className="block text-[11px] text-muted-foreground">Иначе вставится только то, что помещается</span>
              </span>
              <Switch checked={createMissing} onCheckedChange={setCreateMissing} />
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => onApply({ mapping, hasHeader, createMissing, positional: true })}
          >
            <ClipboardPaste className="h-4 w-4" /> По порядку
          </Button>
          <Button
            disabled={mappedCount === 0}
            onClick={() => onApply({ mapping, hasHeader, createMissing, positional: false })}
          >
            Вставить {mappedCount > 0 ? `(${mappedCount})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
