import { useEffect, useState } from "react";
import { IdCard, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateClientCardOptions } from "@/services/workspaceService";
import { firestoreErrorText } from "@/utils/dbError";
import { cn } from "@/utils/cn";
import {
  CLIENT_CARD_OPTION_MAX_ITEMS,
  CLIENT_CARD_OPTION_MAX_LENGTH,
  clientCardOptionsOf,
  DEFAULT_CLIENT_CARD_OPTIONS,
  sanitizeClientCardOptions,
  type ClientCardOptions,
} from "@/types";

type ListKey = keyof ClientCardOptions;

const LISTS: Array<{ key: ListKey; title: string; hint: string; placeholder: string }> = [
  { key: "languages", title: "Языки озвучки", hint: "Чипы у «Озвучка · есть». Рядом всегда есть «свой» — ввод текста.", placeholder: "например, tr" },
  { key: "styles", title: "Стили", hint: "Обычно один — «Pixar». Добавьте те, что просят часто.", placeholder: "например, Реализм" },
  { key: "tiers", title: "Уровни заказа", hint: "База / Premium / Ultima — порядок чипов такой же, как здесь.", placeholder: "например, VIP" },
];

/**
 * «Настройки → Визитка» (Owner): какие варианты подсказывает визитка
 * клиента — языки озвучки, стили, уровни заказа. Списки только подсказывают
 * частое: в самой визитке рядом с чипами всегда есть «свой» — ввод текста.
 * Пишется одним `updateClientCardOptions`; Тимлиду поле закрыто правилом.
 */
export function ClientCardSettingsPanel() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const saved = clientCardOptionsOf(activeWorkspace);
  const [draft, setDraft] = useState<ClientCardOptions>(saved);
  const [inputs, setInputs] = useState<Record<ListKey, string>>({ languages: "", styles: "", tiers: "" });
  const [saving, setSaving] = useState(false);
  const savedKey = JSON.stringify(saved);

  // Пришло с сервера (другая вкладка сохранила) — черновик подхватывает,
  // если человек здесь ничего не менял.
  useEffect(() => {
    setDraft((prev) => (JSON.stringify(prev) === savedKey ? prev : JSON.parse(savedKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const changed = JSON.stringify(sanitizeClientCardOptions(draft)) !== savedKey;

  function add(key: ListKey) {
    const value = inputs[key].trim().slice(0, CLIENT_CARD_OPTION_MAX_LENGTH);
    if (!value) return;
    if (draft[key].some((v) => v.toLowerCase() === value.toLowerCase())) {
      toast.error("Такой вариант уже есть");
      return;
    }
    if (draft[key].length >= CLIENT_CARD_OPTION_MAX_ITEMS) {
      toast.error(`Не больше ${CLIENT_CARD_OPTION_MAX_ITEMS} вариантов`);
      return;
    }
    setDraft((prev) => ({ ...prev, [key]: [...prev[key], value] }));
    setInputs((prev) => ({ ...prev, [key]: "" }));
  }

  function remove(key: ListKey, value: string) {
    setDraft((prev) => ({ ...prev, [key]: prev[key].filter((v) => v !== value) }));
  }

  async function save() {
    if (!activeWorkspaceId || saving) return;
    setSaving(true);
    try {
      await updateClientCardOptions(activeWorkspaceId, draft);
      toast.success("Варианты визитки сохранены");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IdCard className="h-4 w-4 text-primary" /> Визитка клиента
        </CardTitle>
        <CardDescription>
          Что подсказывает визитка в карточке строки: языки озвучки, стили и уровни заказа. Пустые списки ставятся по умолчанию,
          рядом с чипами всегда есть «свой» — ввод текста.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {LISTS.map((list) => (
          <section key={list.key} className="flex flex-col gap-2">
            <div>
              <p className="text-sm font-medium">{list.title}</p>
              <p className="text-xs text-muted-foreground">{list.hint}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {draft[list.key].map((value) => (
                <span
                  key={value}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-primary/30 bg-primary/[0.12] pl-2.5 pr-1 text-[12px] font-medium text-primary"
                >
                  {value}
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-sm text-primary/70 hover:bg-primary/20 hover:text-primary"
                    aria-label={`Убрать «${value}»`}
                    onClick={() => remove(list.key, value)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {draft[list.key].length === 0 && <span className="text-[12px] text-muted-foreground">пусто — будут варианты по умолчанию</span>}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={inputs[list.key]}
                onChange={(e) => setInputs((prev) => ({ ...prev, [list.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(list.key);
                  }
                }}
                placeholder={list.placeholder}
                maxLength={CLIENT_CARD_OPTION_MAX_LENGTH}
                className="h-9 max-w-xs"
              />
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={() => add(list.key)} disabled={!inputs[list.key].trim()}>
                <Plus className="h-3.5 w-3.5" /> Добавить
              </Button>
            </div>
          </section>
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button type="button" onClick={() => void save()} disabled={saving || !changed} className={cn("gap-1.5")}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => setDraft({ ...DEFAULT_CLIENT_CARD_OPTIONS, languages: [...DEFAULT_CLIENT_CARD_OPTIONS.languages], styles: [...DEFAULT_CLIENT_CARD_OPTIONS.styles], tiers: [...DEFAULT_CLIENT_CARD_OPTIONS.tiers] })}
          >
            <RotateCcw className="h-3.5 w-3.5" /> По умолчанию
          </Button>
          {changed && <span className="text-[12px] text-muted-foreground">есть несохранённые изменения</span>}
        </div>
      </CardContent>
    </Card>
  );
}
