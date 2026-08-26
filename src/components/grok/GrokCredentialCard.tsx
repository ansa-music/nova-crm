import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

const CARD = {
  available: "border-success/20",
  resetToday: "border-warning/25",
  unavailable: "border-destructive/20",
} as const;

export function GrokCredentialCard({
  methodLabel,
  extraChip,
  email,
  password,
  phone,
  note,
  available,
  limitResetAt,
  updatedByName,
  updatedAt,
  revealed,
  onToggleReveal,
  onCopy,
  onToggleAvailable,
  onActualize,
  onEdit,
  onDelete,
}: {
  methodLabel: string;
  extraChip?: string;
  email: string;
  password: string;
  phone?: string;
  note?: string;
  available?: boolean;
  limitResetAt: number | null;
  updatedByName: string;
  updatedAt: number;
  revealed: boolean;
  onToggleReveal: () => void;
  onCopy: (text: string, label: string) => void;
  onToggleAvailable: (next: boolean) => Promise<void>;
  onActualize: (next: number | null) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = getGrokAccountStatus({ available, limitResetAt });

  return (
    <Card className={cn("hud-frame glass-panel overflow-hidden", CARD[status])}>
      <CardContent className="relative p-0">
        <span className={cn("absolute inset-y-0 left-0 w-0.5", RAIL[status])} aria-hidden />
        <div className="flex flex-col gap-2.5 px-4 py-3 pl-5">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {methodLabel}
            </span>
            {extraChip && (
              <span className="truncate rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                {extraChip}
              </span>
            )}
            <AvailabilityToggle available={available} limitResetAt={limitResetAt} onToggle={onToggleAvailable} />
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Действия">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
          </div>

          <div className="flex flex-col gap-1 rounded-md bg-background/35 px-2.5 py-1.5">
            <SecretRow label="Почта" value={email} onCopy={() => onCopy(email, "Email")} mono={false} />
            <SecretRow
              label="Пароль"
              value={password}
              revealed={revealed}
              onToggle={onToggleReveal}
              onCopy={() => onCopy(password, "Пароль")}
            />
            <SecretRow label="Номер" value={phone ?? ""} onCopy={() => onCopy(phone ?? "", "Номер")} />
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <ActualizePopover limitResetAt={limitResetAt} onSave={onActualize} />
            {limitResetAt != null && <span className="tabular-nums text-foreground/80">{formatDate(limitResetAt)}</span>}
            {note?.trim() && <span className="truncate">{note}</span>}
            <span className="ml-auto">
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
