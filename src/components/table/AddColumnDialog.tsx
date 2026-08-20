import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import type { addColumn } from "@/services/pageService";
import type { ColumnType, PageColumn } from "@/types";

interface AddColumnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  pageId: string;
  existingColumns: PageColumn[];
  /**
   * The actual column-creation call to make. Passed in by the caller
   * (DataTable) already routed to the right target — a page's own columns,
   * or a specific subpage's nested columns when editing a subpage tab.
   * MUST NOT default to `pageService.addColumn` internally: that call only
   * ever targets the top-level page doc, so a dialog opened from inside a
   * subpage would silently overwrite the PARENT page's real columns with
   * the subpage's list instead of adding the column to the subpage.
   */
  createColumn: typeof addColumn;
  onCreated?: (column: PageColumn) => void;
}

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Текст",
  number: "Число",
  currency: "Валюта",
  status: "Статус",
  responsible: "Ответственный",
  date: "Дата",
  email: "Email",
  phone: "Телефон",
};

const COLUMN_TYPES: ColumnType[] = ["text", "number", "currency", "status", "responsible", "date", "email", "phone"];

function slugify(label: string, existingKeys: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "col";
  let key = base;
  let i = 1;
  while (existingKeys.has(key)) {
    key = `${base}_${i}`;
    i += 1;
  }
  return key;
}

export function AddColumnDialog({
  open,
  onOpenChange,
  workspaceId,
  pageId,
  existingColumns,
  createColumn,
  onCreated,
}: AddColumnDialogProps) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [isSaving, setIsSaving] = useState(false);

  async function handleCreate() {
    if (!label.trim()) {
      toast.error("Введите название столбца");
      return;
    }
    setIsSaving(true);
    try {
      const existingKeys = new Set(existingColumns.map((c) => c.key));
      const key = slugify(label, existingKeys);
      const column = await createColumn(workspaceId, pageId, existingColumns, {
        key,
        label: label.trim(),
        type,
        // Neither "status" nor "responsible" columns store their own
        // options anymore — both read a shared, workspace-wide list (see
        // src/utils/columnOptions.ts), managed by the Owner in Настройки.
        statusOptions: undefined,
      });
      toast.success(`Столбец «${column.label}» добавлен`);
      onCreated?.(column);
      setLabel("");
      setType("text");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить столбец");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Добавить столбец</DialogTitle>
          <DialogDescription>Новый столбец появится сразу у всех, кто открыл эту страницу.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Название</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например, Комментарий"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Тип</Label>
            <Select value={type} onValueChange={(v) => setType(v as ColumnType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMN_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {COLUMN_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(type === "responsible" || type === "status") && (
              <p className="text-xs text-muted-foreground">
                Варианты для этого столбца общие для всего сайта — их добавляет Овнер в
                Настройках → Workspace → «{type === "responsible" ? "Ответственные" : "Статусы"}».
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Отмена
          </Button>
          <Button onClick={handleCreate} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
