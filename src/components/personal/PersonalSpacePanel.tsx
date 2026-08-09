import { useEffect, useState } from "react";
import { ClipboardList, HandCoins, User, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportsTab } from "@/components/personal/ReportsTab";
import { FinanceTab } from "@/components/personal/FinanceTab";
import { DebtsTab } from "@/components/personal/DebtsTab";
import { NotesTab } from "@/components/personal/NotesTab";
import { ensurePersonalZone } from "@/services/personalSpaceService";

interface PersonalSpacePanelProps {
  workspaceId: string;
  pageId: string;
  uid: string;
  onClose: () => void;
}

export function PersonalSpacePanel({ workspaceId, pageId, uid, onClose }: PersonalSpacePanelProps) {
  const [tab, setTab] = useState<"reports" | "finance" | "debts" | "notes">("reports");

  useEffect(() => {
    ensurePersonalZone(workspaceId, pageId, uid).catch((err) => console.error("ensurePersonalZone failed:", err));
  }, [workspaceId, pageId, uid]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <User className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-sm font-semibold">Личное пространство</h2>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="ml-0 sm:ml-4">
          <TabsList>
            <TabsTrigger value="reports" className="gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" /> Отчёты
            </TabsTrigger>
            <TabsTrigger value="finance" className="gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> Финансы
            </TabsTrigger>
            <TabsTrigger value="debts" className="gap-1.5">
              <HandCoins className="h-3.5 w-3.5" /> Долги
            </TabsTrigger>
            <TabsTrigger value="notes" className="gap-1.5">
              Заметки
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" onClick={onClose} title="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "reports" && <ReportsTab workspaceId={workspaceId} pageId={pageId} uid={uid} />}
        {tab === "finance" && <FinanceTab workspaceId={workspaceId} pageId={pageId} uid={uid} />}
        {tab === "debts" && <DebtsTab workspaceId={workspaceId} pageId={pageId} uid={uid} />}
        {tab === "notes" && <NotesTab workspaceId={workspaceId} pageId={pageId} uid={uid} />}
      </div>
    </div>
  );
}
