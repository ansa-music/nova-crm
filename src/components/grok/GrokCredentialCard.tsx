import { useState } from "react";
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
import { formatDate, timeAgo } from "@/utils/date";
import { cn } from "@/utils/cn";

const RAIL = {
  available: "bg-success",
  resetToday: "bg-warning",
  unavailable: "bg-destructive",
} as const;

const OVERLAY = {
  available: "bg-success/15",
  resetToday: "bg-warning/15",
  unavailable: "bg-destructive/15",
} as const;

const CARD = {
  available: "border-success/25",
  resetToday: "border-warning/30",
  unavailable: "border-destructive/25",
} as const;

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

  return (
    <Card className={cn("hud-frame glass-panel overflow-hidden", CARD[status])}>
      <CardContent className="relative p-0">
        {named ? (
          <button
            type="button"
            disabled={!canRename}
            onClick={startRename}
            title={canRename ? "Нажми, чтобы изменить название" : nickname}
            className={cn(
              "absolute inset-y-0 left-0 z-10 flex w-10 items-center justify-center overflow-hidden",
              OVERLAY[status],
              canRename && "cursor-text hover:bg-accent/40"
            )}
          >
            <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", RAIL[status])} />
            <span className="max-h-[calc(100%-16px)] max-w-7 truncate text-[14px] font-semibold leading-none tracking-wide text-foreground [writing-mode:vertical-rl] rotate-180">
              {nickname?.trim()}
            </span>
          </button>
        ) : (
          <span className={cn("absolute inset-y-0 left-0 w-1.5", RAIL[status])} aria-hidden />
        )}
        <div className={cn("flex flex-col gap-3.5 px-4 py-4", named ? "pl-12" : "pl-5")}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {renaming ? (
                <Input
                  value={draft}
                  autoFocus
                  disabled={savingName}
                  placeholder="Название аккаунта"
                  className="h-9 text-[18px] font-semibold"
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
                <div className="flex items-center gap-1.5">
                  <h2
                    className={cn(
                      "truncate text-[18px] font-semibold leading-snug tracking-[-0.02em] text-foreground",
                      canRename && !named && "cursor-text rounded-sm hover:bg-accent/50"
                    )}
                    title={canRename && !named ? "Нажми, чтобы дать название" : undefined}
                    onClick={named ? undefined : startRename}
                  >
                    {email}
                  </h2>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Копировать email"
                    onClick={() => onCopy(email, "Email")}
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {methodLabel}
                </span>
                {extraChip && (
                  <span className="truncate rounded-full border border-border/70 px-2.5 py-0.5 text-xs text-foreground/80">
                    {extraChip}
                  </span>
                )}
                <AvailabilityToggle available={available} limitResetAt={limitResetAt} onToggle={onToggleAvailable} />
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" title="Действия">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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

          <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/50 px-3.5 py-2.5">
            <SecretRow
              label="Пароль"
              value={password}
              revealed={revealed}
              onToggle={onToggleReveal}
              onCopy={() => onCopy(password, "Пароль")}
            />
            <SecretRow label="Номер" value={phone ?? ""} onCopy={() => onCopy(phone ?? "", "Номер")} />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <ActualizePopover limitResetAt={limitResetAt} onSave={onActualize} />
            {limitResetAt != null && (
              <span className="text-[15px] font-medium tabular-nums leading-none text-foreground">{formatDate(limitResetAt)}</span>
            )}
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
