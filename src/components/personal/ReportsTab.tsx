import { useEffect, useState } from "react";
import { ArrowRightCircle, ClipboardList, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { PersonalReportTable } from "@/components/personal/PersonalReportTable";
import {
  createNextMonthPersonalReport,
  createPersonalMonthlyReport,
  deletePersonalReport,
  subscribeToPersonalReportRows,
  subscribeToPersonalReports,
  type PersonalReportRow,
} from "@/services/personalSpaceService";
import { cn } from "@/utils/cn";
import type { PageColumn, SubPage } from "@/types";

const DEFAULT_REPORT_COLUMNS: PageColumn[] = [
  { id: "c1", key: "name", label: "Клиент", type: "text", width: 200, order: 0 },
  {
    id: "c2",
    key: "status",
    label: "Статус",
    type: "status",
    width: 140,
    order: 1,
    statusOptions: [
      { value: "todo", label: "К выполнению", color: "240 4% 46%" },
      { value: "done", label: "Готово", color: "142 71% 45%" },
    ],
  },
  { id: "c3", key: "price", label: "Цена", type: "currency", width: 140, order: 2 },
];

interface ReportsTabProps {
  workspaceId: string;
  pageId: string;
  uid: string;
}

export function ReportsTab({ workspaceId, pageId, uid }: ReportsTabProps) {
  const [reports, setReports] = useState<SubPage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rows, setRows] = useState<PersonalReportRow[]>([]);

  useEffect(
    () =>
      subscribeToPersonalReports(workspaceId, pageId, uid, (data) => {
        setReports(data);
        setActiveId((current) => current ?? data[0]?.id ?? null);
      }),
    [workspaceId, pageId, uid]
  );

  useEffect(() => {
    if (!activeId) {
      setRows([]);
      return;
    }
    return subscribeToPersonalReportRows(workspaceId, pageId, uid, activeId, setRows);
  }, [workspaceId, pageId, uid, activeId]);

  const active = reports.find((r) => r.id === activeId) ?? null;

  async function handleCreate() {
    const name = window.prompt("Название отчёта", "Новый отчёт");
    if (!name?.trim()) return;
    try {
      const created = await createPersonalMonthlyReport({
        workspaceId,
        pageId,
        uid,
        name: name.trim(),
        columns: DEFAULT_REPORT_COLUMNS,
        order: reports.length,
      });
      setActiveId(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать отчёт");
    }
  }

  async function handleNextMonth() {
    if (!active) return;
    try {
      const created = await createNextMonthPersonalReport(workspaceId, pageId, uid, active, reports.length);
      setActiveId(created.id);
      toast.success(`Создан отчёт «${created.name}»`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать следующий месяц");
    }
  }

  async function handleDelete(report: SubPage) {
    if (!window.confirm(`Удалить отчёт «${report.name}»?`)) return;
    await deletePersonalReport(workspaceId, pageId, uid, report.id);
    if (activeId === report.id) setActiveId(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {reports.map((r) => (
          <button
            key={r.id}
            onClick={() => setActiveId(r.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              activeId === r.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/40"
            )}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            {r.name}
          </button>
        ))}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCreate}>
          <Plus className="h-3.5 w-3.5" /> Новый отчёт
        </Button>
      </div>

      {active ? (
        <>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleNextMonth}>
              <ArrowRightCircle className="h-3.5 w-3.5" /> Следующий месяц
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => handleDelete(active)}>
              <Trash2 className="h-3.5 w-3.5" /> Удалить отчёт
            </Button>
          </div>
          <PersonalReportTable workspaceId={workspaceId} pageId={pageId} uid={uid} report={active} rows={rows} />
        </>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {reports.length === 0 ? "Пока нет отчётов — создайте первый" : "Выберите отчёт"}
        </p>
      )}
    </div>
  );
}
