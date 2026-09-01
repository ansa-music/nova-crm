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
import { buildColumnTypeChoices, decodeColumnTypeValue, encodeColumnTypeValue } from "@/utils/columnOptions";
import { ColumnTypeIcon } from "@/components/table/ColumnTypeIcon";
import type { addColumn } from "@/services/pageService";
import type { ColumnType, PageColumn } from "@/types";
import { promptDialog } from "@/utils/appDialog";

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

const TYPE_HINTS: Record<ColumnType, string> = {
  text: "Любой текст — имена, комментарии, адреса.",
  number: "Число. Можно вводить «1 500» или «2,5» — сохранится как число, в итогах считается.",
  currency: "Сумма в тенге. Участвует в «Итого», «Готово» и процентах на дашборде.",
  status: "Цветной статус из общего списка сайта. «Готово» считается на дашборде.",
  responsible: "Кто отвечает за строку — общий список для всего сайта.",
  date: "Дата из календаря. Заполняется автоматически при первом вводе в первый столбец, если пусто.",
  email: "Почта — в ячейке появится кнопка «написать».",
  phone: "Телефон — в ячейке появится кнопка «позвонить».",
  url: "Ссылка http(s) на Диск или любой сайт — открывается в новой вкладке.",
  custom: "Свой список вариантов, общий для всего сайта.",
};

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
      const name = (await promptDialog({ title: "Новое кастомное поле", label: "Название", placeholder: "Например, Приоритет", maxLength: 40, confirmLabel: "Создать" }))?.trim();
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
      // Never seed statusOptions, including for type "status" — that list is
      // workspace-wide now (getColumnOptions never reads a column's own
      // value), so a new status column just reads the shared list like every
      // other one instead of getting its own copy that could drift.
      const column = await createColumn(workspaceId, pageId, existingColumns, {
        key,
        label: label.trim(),
        type,
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
                    <span className="flex items-center gap-2">
                      <ColumnTypeIcon type={choice.type} className="h-3.5 w-3.5" />
                      {choice.label}
                    </span>
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
            <p className="text-xs leading-5 text-muted-foreground">{TYPE_HINTS[type]}</p>
            {type === "status" && (
              <p className="text-xs text-muted-foreground">
                Список вариантов статуса (включая «Готово») меняет только Owner.
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
