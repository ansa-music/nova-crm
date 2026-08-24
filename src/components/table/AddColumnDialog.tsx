import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { addCustomField } from "@/services/workspaceService";
import { buildColumnTypeChoices, decodeColumnTypeValue, DEFAULT_STATUS_OPTIONS, encodeColumnTypeValue } from "@/utils/columnOptions";
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

const NEW_CUSTOM_FIELD_VALUE = "__new_custom_field__";

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
  const { activeWorkspace } = useWorkspace();
  const customFields = activeWorkspace?.customFields ?? [];
  const typeChoices = buildColumnTypeChoices(customFields);

  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [customFieldId, setCustomFieldId] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleTypeSelect(v: string) {
    if (v === NEW_CUSTOM_FIELD_VALUE) {
      const name = window.prompt("Название нового кастомного поля (например, «Приоритет»):")?.trim();
      if (!name) return;
      if (!activeWorkspace) return;
      try {
        const id = await addCustomField(activeWorkspace.id, customFields, name);
        setType("custom");
        setCustomFieldId(id);
        toast.success(`Поле «${name}» создано`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось создать поле");
      }
      return;
    }
    const decoded = decodeColumnTypeValue(v);
    setType(decoded.type);
    setCustomFieldId(decoded.customFieldId);
  }

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
        statusOptions: type === "status" ? DEFAULT_STATUS_OPTIONS : undefined,
        customFieldId,
      });
      toast.success(`Столбец «${column.label}» добавлен`);
      onCreated?.(column);
      setLabel("");
      setType("text");
      setCustomFieldId(undefined);
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
            <Select value={encodeColumnTypeValue(type, customFieldId)} onValueChange={handleTypeSelect}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeChoices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={NEW_CUSTOM_FIELD_VALUE}>
                  <span className="flex items-center gap-1.5 text-primary">
                    <Plus className="h-3.5 w-3.5" /> Новое кастомное поле…
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {type === "status" && (
              <p className="text-xs text-muted-foreground">
                Статусы (включая «Готово») можно добавить кнопкой «Статусы» над таблицей.
              </p>
            )}
            {(type === "responsible" || type === "custom") && (
              <p className="text-xs text-muted-foreground">
                Варианты общие для сайта — их меняет Owner в Настройках.
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
