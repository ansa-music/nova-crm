import { useId, useMemo, useState } from "react";
import { Clock, Headset, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NICK_MAX_LENGTH, nickOptionsOf } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { ROLE_LABELS, type JoinRequest, type JoinRequestRole, type Workspace } from "@/types";

const ROLE_CHOICES: { role: JoinRequestRole; title: string; hint: string; icon: typeof Wrench }[] = [
  { role: "manager", title: "Технарь", hint: "свой стол, заказы", icon: Wrench },
  { role: "os", title: "ОС", hint: "выдаю заказы, оцениваю", icon: Headset },
];

/**
 * Заявка на вход: человек приходит БЕЗ роли и сам говорит, кем работает, и —
 * если уже работал под ником — какой у него ник. Подсказки ника берутся из
 * списков workspace (документ workspace читает любой вошедший), но это только
 * подсказки: решает Тимлид или выше при одобрении.
 */
export function JoinRequestForm({
  workspace,
  request,
  submitting,
  onSubmit,
}: {
  workspace: Workspace | null | undefined;
  request: JoinRequest | null | undefined;
  submitting: boolean;
  onSubmit: (wish: { role: JoinRequestRole; nick: string }) => void;
}) {
  const pending = request?.status === "pending";
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<JoinRequestRole | null>(request?.requestedRole ?? null);
  const [nick, setNick] = useState(request?.requestedNick ?? "");
  const listId = useId();
  const suggestions = useMemo(
    () => (role ? nickOptionsOf(workspace, role === "manager" ? "tech" : "os").filter((o) => !o.inactive) : []),
    [workspace, role]
  );

  if (pending && !editing) {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" /> Заявка отправлена, ждём подтверждения
        </div>
        <p className="text-[12px] text-muted-foreground">
          {request?.requestedRole ? ROLE_LABELS[request.requestedRole] : "Роль не выбрана"}
          {request?.requestedNick ? ` · ник «${request.requestedNick}»` : ""}
        </p>
        <button
          type="button"
          onClick={() => {
            setRole(request?.requestedRole ?? null);
            setNick(request?.requestedNick ?? "");
            setEditing(true);
          }}
          className="min-h-11 text-[12px] text-primary underline underline-offset-2 sm:min-h-0"
        >
          Изменить заявку
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        if (!role) return;
        onSubmit({ role, nick: nick.trim() });
        setEditing(false);
      }}
    >
      {request?.status === "rejected" && (
        <p className="text-center text-[12px] text-destructive">Прошлую заявку отклонили — можно подать снова.</p>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] text-muted-foreground">Кем вы работаете?</p>
        <div className="grid grid-cols-2 gap-2">
          {ROLE_CHOICES.map(({ role: value, title, hint, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              aria-pressed={role === value}
              className={cn(
                "flex min-h-16 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                role === value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                {title}
              </span>
              <span className="text-[11px] text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
        Ваш ник, если уже есть
        <Input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          maxLength={NICK_MAX_LENGTH}
          placeholder={role ? "Например, Sakodxxp" : "Сначала выберите роль"}
          disabled={!role}
          list={suggestions.length > 0 ? listId : undefined}
          autoComplete="off"
          className="h-10"
        />
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((o) => (
              <option key={o.value} value={o.label} />
            ))}
          </datalist>
        )}
        <span className="text-[11px]">Нет ника — оставьте пустым: его выдаст Тимлид.</span>
      </label>

      <div className="flex gap-2">
        <Button type="submit" className="min-h-11 flex-1 gap-1.5" disabled={!role || submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? "Обновить заявку" : "Отправить заявку"}
        </Button>
        {pending && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setEditing(false)} disabled={submitting}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}
