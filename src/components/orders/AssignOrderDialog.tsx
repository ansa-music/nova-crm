import { useState } from "react";
import { Hand, Loader2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { timeAgo } from "@/utils/date";
import { cn } from "@/utils/cn";
import type { OrderCandidate } from "@/services/orderService";
import type { WorkOrder, WorkspaceMember } from "@/types";

interface AssignOrderDialogProps {
  order: WorkOrder | null;
  onOpenChange: (open: boolean) => void;
  candidates: Array<OrderCandidate & { member: WorkspaceMember; deskName: string | null }>;
  onAssign: (candidate: OrderCandidate) => Promise<void>;
  onRandom: () => Promise<void>;
}

/** «Кому отдать»: откликнувшиеся сверху, остальные технари ниже; без стола — не выбрать. */
export function AssignOrderDialog({ order, onOpenChange, candidates, onAssign, onRandom }: AssignOrderDialogProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const claimed = candidates.filter((c) => c.claimedAt != null).sort((a, b) => (a.claimedAt ?? 0) - (b.claimedAt ?? 0));
  const others = candidates.filter((c) => c.claimedAt == null);
  const randomPool = (claimed.length ? claimed : others).filter((c) => c.hasDesk);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  }

  function row(c: (typeof candidates)[number]) {
    const disabled = !c.hasDesk || busy !== null;
    return (
      <button
        key={c.uid}
        type="button"
        disabled={disabled}
        onClick={() => void run(c.uid, () => onAssign(c))}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
          c.hasDesk ? "border-border hover:border-primary/40 hover:bg-accent/40" : "border-border/60 opacity-60",
          c.claimedAt != null && c.hasDesk && "border-primary/30 bg-primary/[0.05]"
        )}
      >
        <MemberAvatar id={c.uid} name={c.member.name} nickname={c.member.nickname} photoURL={c.member.photoURL} className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{c.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {c.deskName ?? "стола нет — забрать некуда"}
            {c.claimedAt != null ? ` · откликнулся ${timeAgo(c.claimedAt)}` : ""}
          </p>
        </div>
        {busy === c.uid ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : c.claimedAt != null ? (
          <Hand className="h-4 w-4 shrink-0 text-primary" />
        ) : null}
      </button>
    );
  }

  return (
    <Dialog open={Boolean(order)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Кому отдать заказ</DialogTitle>
          <DialogDescription>{order ? `${order.client} — выберите технаря или доверьтесь случаю.` : ""}</DialogDescription>
        </DialogHeader>
        <Button
          variant="outline"
          className="w-full gap-2"
          disabled={randomPool.length === 0 || busy !== null}
          onClick={() => void run("__random", onRandom)}
        >
          {busy === "__random" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
          {claimed.length ? `Рандом из откликнувшихся (${randomPool.length})` : `Рандом из всех технарей (${randomPool.length})`}
        </Button>
        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
          {claimed.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Откликнулись · {claimed.length}</p>
              {claimed.map(row)}
            </div>
          )}
          {others.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {claimed.length ? "Остальные технари" : "Технари"}
              </p>
              {others.map(row)}
            </div>
          )}
          {candidates.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Технарей в workspace пока нет.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
