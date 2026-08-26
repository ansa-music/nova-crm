import { useEffect, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SecretRow } from "@/components/grok/SecretRow";
import { ActualizePopover, AvailabilityToggle } from "@/components/grok/GrokStatusControls";
import { getGrokAccountStatus } from "@/services/grokAccountService";
import { formatDate, formatResetCountdown, timeAgo } from "@/utils/date";
import { cn } from "@/utils/cn";

const RAIL = {
  available: "bg-success",
  resetToday: "bg-warning",
  unavailable: "bg-destructive",
} as const;

const OVERLAY = {
  available: "bg-success/12",
  resetToday: "bg-warning/12",
  unavailable: "bg-destructive/12",
} as const;

const CARD = {
  available: "border-success/20",
  resetToday: "border-warning/25",
  unavailable: "border-destructive/20",
} as const;

function ResetCountdown({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span
      className="text-[13px] font-medium tabular-nums leading-none text-foreground"
      title={formatDate(at)}
    >
      {formatResetCountdown(at, now)}
    </span>
  );
}

export function GrokCredentialCard({
  methodLabel,
  extraChip,
  nickname,
  email,
  password,
  phone,
  note,
  available,
  limitResetAt,
  updatedByName,
  updatedAt,
  revealed,
  canRename,
  onToggleReveal,
  onCopy,
  onToggleAvailable,
  onActualize,
  onRename,
  onEdit,
  onDelete,
}: {
  methodLabel: string;
  extraChip?: string;
  nickname?: string;
  email: string;
  password: string;
  phone?: string;
  note?: string;
  available?: boolean;
  limitResetAt: number | null;
  updatedByName: string;
  updatedAt: number;
  revealed: boolean;
  canRename?: boolean;
  onToggleReveal: () => void;
  onCopy: (text: string, label: string) => void;
  onToggleAvailable: (next: boolean) => Promise<void>;
  onActualize: (next: number | null) => Promise<void>;
  onRename?: (nickname: string) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = getGrokAccountStatus({ available, limitResetAt });
  const named = Boolean(nickname?.trim());
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(nickname ?? "");
  const [savingName, setSavingName] = useState(false);

  function startRename() {
    if (!canRename || !onRename) return;
    setDraft(nickname ?? "");
    setRenaming(true);
  }

  async function commitRename() {
    if (!onRename) return;
    const next = draft.trim();
    if (next === (nickname?.trim() ?? "")) {
      setRenaming(false);
      return;
    }
    setSavingName(true);
    try {
      await onRename(next);
      setRenaming(false);
    } finally {
      setSavingName(false);
    }
  }

  function copyLogin() {
    const lines = [email, password, phone?.trim()].filter((part): part is string => Boolean(part));
    onCopy(lines.join("\n"), "Вход");
  }

  return (
    <Card className={cn("hud-frame glass-panel overflow-hidden", CARD[status], status === "resetToday" && "grok-reset-pulse")}>
      <CardContent className="relative p-0">
        <button
          type="button"
          disabled={!canRename}
          onClick={startRename}
          title={named ? (canRename ? "Нажми, чтобы изменить название" : nickname) : canRename ? "Нажми, чтобы дать название" : undefined}
          className={cn(
            "absolute inset-y-0 left-0 z-10 flex w-9 items-center justify-center overflow-hidden",
            named ? OVERLAY[status] : "bg-transparent",
            canRename && "cursor-text hover:bg-accent/35"
          )}
        >
          <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", RAIL[status])} />
          {named && (
            <span className="max-h-[calc(100%-12px)] max-w-6 truncate text-[13px] font-semibold leading-none tracking-wide text-foreground [writing-mode:vertical-rl] rotate-180">
              {nickname?.trim()}
            </span>
          )}
        </button>
        <div className="flex flex-col gap-2 py-3 pl-11 pr-3.5">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              {renaming ? (
                <Input
                  value={draft}
                  autoFocus
                  disabled={savingName}
                  placeholder="Название аккаунта"
                  className="h-8 text-[16px] font-semibold"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { void commitRename(); }}
                  onKeyDown={(e) => {
                    if (e.code === "Enter") {
                      e.preventDefault();
                      void commitRename();
                    }
                    if (e.code === "Escape") setRenaming(false);
                  }}
                />
              ) : (
                <div className="flex min-w-0 items-center gap-1">
                  <h2 className="min-w-0 truncate text-[16px] font-semibold leading-snug tracking-[-0.02em] text-foreground">
                    {email}
                  </h2>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Копировать email"
                    onClick={() => onCopy(email, "Email")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-px text-[11px] font-medium text-primary">
                  {methodLabel}
                </span>
                {extraChip && (
                  <span className="truncate rounded-full border border-border/60 px-2 py-px text-[11px] text-foreground/80">
                    {extraChip}
                  </span>
                )}
                <AvailabilityToggle available={available} limitResetAt={limitResetAt} onToggle={onToggleAvailable} />
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" title="Действия">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={copyLogin}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Копировать вход
                </DropdownMenuItem>
                {canRename && onRename && (
                  <DropdownMenuItem onClick={startRename}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Название
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Редактировать
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className={cn("grid gap-x-4 gap-y-0.5", phone?.trim() && "sm:grid-cols-2")}>
            <SecretRow
              label="Пароль"
              value={password}
              revealed={revealed}
              onToggle={onToggleReveal}
              onCopy={() => onCopy(password, "Пароль")}
            />
            <SecretRow label="Номер" value={phone ?? ""} hideEmpty onCopy={() => onCopy(phone ?? "", "Номер")} />
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
            <ActualizePopover limitResetAt={limitResetAt} onSave={onActualize} />
            {limitResetAt != null && <ResetCountdown at={limitResetAt} />}
            {note?.trim() && <span className="truncate">{note}</span>}
            <span className="ml-auto shrink-0">
              <span className="font-medium text-foreground">{updatedByName}</span>
              {" · "}
              {timeAgo(updatedAt)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
