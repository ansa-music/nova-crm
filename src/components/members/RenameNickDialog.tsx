import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { NICK_KIND_META, NICK_MAX_LENGTH, renameNickOption, type NickKind } from "@/services/memberService";
import { renamePage } from "@/services/pageService";
import { firestoreErrorText, withDbTimeout } from "@/utils/dbError";
import { realNameOf } from "@/utils/displayName";
import type { StatusOption, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Название стола, собранное из ника («Стол ОС · Ник», «Стол Ник» или сам
 * ник), — с новым ником. null — стол назвали по-своему, его не трогаем.
 */
function deskNameAfterRename(name: string, from: string, to: string): string | null {
  const current = name.trim();
  for (const prefix of ["Стол ОС · ", "Стол ", ""]) {
    if (current === `${prefix}${from.trim()}`) return `${prefix}${to}`;
  }
  return null;
}

/**
 * Столы держателя, названные по самому нику: название сменится вслед за
 * ником (у ника ОС — его стол ОС, у остальных — обычные столы).
 */
export function desksNamedAfterNick(
  pages: WorkspacePage[],
  kind: NickKind,
  holder: WorkspaceMember | null | undefined,
  label: string
): WorkspacePage[] {
  if (!holder?.uid) return [];
  return pages.filter(
    (p) => p.responsibleUserId === holder.uid && Boolean(p.osDesk) === (kind === "os") && deskNameAfterRename(p.name, label, label) !== null
  );
}

/**
 * Переименовать ник: подпись в списке и у человека, который его держит, —
 * одной записью (`renameNickOption`). Столы, названные по нику, следом
 * переименовывает только Owner: название стола правит он или хозяин стола.
 * Итог говорит тостом. true — записано.
 */
export async function renameNickWithDesks(input: {
  workspaceId: string;
  kind: NickKind;
  option: StatusOption;
  to: string;
  holder: WorkspaceMember | null;
  /** Столы держателя, названные по нику (`desksNamedAfterNick`). */
  desks: WorkspacePage[];
  viewerIsOwner: boolean;
}): Promise<boolean> {
  const { workspaceId, kind, option, holder, desks } = input;
  try {
    const saved = await renameNickOption({ workspaceId, kind, value: option.value, label: input.to });
    // Подпись в списке та же — значит, чинили копию, отставшую у держателя.
    const same = saved.label === option.label.trim();
    const notes: string[] = [];
    if (holder) notes.push(same ? `${realNameOf(holder)}: подпись теперь как в списке` : `${realNameOf(holder)} теперь под новым ником`);
    if (desks.length > 0 && input.viewerIsOwner) {
      let failed = 0;
      for (const page of desks) {
        try {
          // С потолком ожидания: запись стола без связи не падает, а висит.
          await withDbTimeout(
            renamePage(workspaceId, page.id, deskNameAfterRename(page.name, option.label, saved.label) ?? page.name),
            "Название стола"
          );
        } catch {
          failed++;
        }
      }
      notes.push(failed > 0 ? "название стола сменить не удалось — поправьте его вручную" : desks.length === 1 ? "стол переименован" : `столы переименованы (${desks.length})`);
    } else if (desks.length > 0) {
      notes.push(`стол «${desks[0].name}» называется по-старому — его название меняет Owner или хозяин стола`);
    }
    toast.success(same ? `Подпись «${saved.label}» обновлена` : `«${option.label}» теперь «${saved.label}»`, {
      description: notes.join(" · ") || undefined,
    });
    return true;
  } catch (error) {
    toast.error("Не удалось переименовать ник", { description: firestoreErrorText(error, "База не приняла запись") });
    return false;
  }
}

/**
 * Переименовать ник. Меняется только подпись: заказы, столы и счётчики
 * привязаны к значению варианта и остаются на нём. Подпись, которая уже есть
 * у другого ника этого списка, не принимается — два одинаковых ника не
 * отличить ни в выборе, ни в заказах (то же проверяет база). Прежнюю подпись
 * сохранить можно в одном случае: копия у держателя отстала от списка
 * (подпись меняли в редакторе вариантов «Ответственный», который участников
 * не трогает) — тогда «Сохранить» её чинит.
 *
 * Окно одно на два входа: карандаш в списке ников на «Команде» и кнопка
 * «Переименовать» в окне ника человека (`NickDialog`).
 */
export function RenameNickDialog({
  kind,
  option,
  options,
  holder,
  deskName,
  onClose,
  onSubmit,
}: {
  kind: NickKind;
  option: StatusOption;
  options: StatusOption[];
  holder: WorkspaceMember | null;
  /** Стол, названный по нику, — переименуется вместе с ним. */
  deskName: string | null;
  onClose: () => void;
  /** true — записано, окно можно закрыть. */
  onSubmit: (label: string) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(option.label);
  const [saving, setSaving] = useState(false);
  const current = option.label.trim();
  const next = label.trim().slice(0, NICK_MAX_LENGTH);
  const clash = next ? options.find((o) => o.value !== option.value && o.label.trim().toLowerCase() === next.toLowerCase()) : undefined;
  const holderLabel = holder ? ((holder[NICK_KIND_META[kind].label] as string | undefined) ?? "").trim() : null;
  const stale = holderLabel !== null && holderLabel !== current;
  const blocked = !next || Boolean(clash) || (next === current.slice(0, NICK_MAX_LENGTH) && !stale);

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    const ok = await onSubmit(next);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Переименовать «{option.label}»</DialogTitle>
          <DialogDescription>
            Меняется только подпись: заказы, оценки и счётчики привязаны к самому нику и остаются на нём.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={NICK_MAX_LENGTH}
            placeholder="Новый ник"
            aria-label="Новый ник"
            aria-invalid={Boolean(clash)}
            autoComplete="off"
            autoFocus
          />
          {clash ? (
            <p className="text-[12px] text-destructive" role="alert">
              Ник «{clash.label}» уже есть в списке{clash.inactive ? " — в неактуальных" : ""}.
            </p>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              {holder ? `Закреплён за: ${realNameOf(holder)} — он останется на этом нике.` : "Ник свободен — ни за кем не закреплён."}
              {stale ? ` У него сейчас записано «${holderLabel || "—"}» — «Сохранить» это исправит.` : ""}
              {deskName ? ` Стол «${deskName}» переименуется вместе с ником.` : ""}
            </p>
          )}
          {kind === "os" && (
            <p className="text-[12px] text-muted-foreground">
              Прежняя подпись останется в уже выданных заказах. Ячейки, куда ник вписан текстом (текстовый столбец «ОС»), перестанут
              считаться заказами этого ОС.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Отмена
            </Button>
            <Button type="submit" disabled={blocked || saving} className="gap-1.5">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
