import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/utils/format";
import {
  addPersonalReportRow,
  deletePersonalReportRow,
  updatePersonalReportRowCell,
  type PersonalReportRow,
} from "@/services/personalSpaceService";
import { calculateReportAggregates } from "@/utils/reportAggregates";
import type { PageColumn, SubPage } from "@/types";

interface PersonalReportTableProps {
  workspaceId: string;
  pageId: string;
  uid: string;
  report: SubPage;
  rows: PersonalReportRow[];
}

export function PersonalReportTable({ workspaceId, pageId, uid, report, rows }: PersonalReportTableProps) {
  const [editing, setEditing] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const columns = [...report.columns].sort((a, b) => a.order - b.order);

  async function handleAddRow() {
    const cells: Record<string, string | number | null> = {};
    columns.forEach((c) => (cells[c.key] = ""));
    await addPersonalReportRow(workspaceId, pageId, uid, report.id, cells, rows.length);
  }

  function startEdit(rowId: string, col: PageColumn, current: string | number | null) {
    setEditing({ rowId, colKey: col.key });
    setEditValue(current === null || current === undefined ? "" : String(current));
  }

  async function commitEdit() {
    if (!editing) return;
    await updatePersonalReportRowCell(workspaceId, pageId, uid, report.id, editing.rowId, editing.colKey, editValue);
    setEditing(null);
  }

  const aggregates = calculateReportAggregates(
    rows.map((r) => ({ id: r.id, pageId: report.id, cells: r.cells, order: r.order, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    columns
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 text-left font-medium text-muted-foreground">
                  {c.label}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0 hover:bg-accent/20">
                {columns.map((c) => {
                  const isEditing = editing?.rowId === row.id && editing.colKey === c.key;
                  const value = row.cells[c.key];
                  return (
                    <td key={c.key} className="px-1 py-1" onClick={() => !isEditing && startEdit(row.id, c, value)}>
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="h-8"
                        />
                      ) : (
                        <div className="min-h-8 cursor-text px-2 py-1.5">
                          {c.type === "currency" && value ? formatCurrency(Number(value)) : String(value ?? "")}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => deletePersonalReportRow(workspaceId, pageId, uid, report.id, row.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="p-4 text-center text-xs text-muted-foreground">
                  Строк пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" className="w-fit gap-1.5" onClick={handleAddRow}>
        <Plus className="h-3.5 w-3.5" /> Добавить строку
      </Button>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {aggregates.map((a) => (
          <div key={a.rate} className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{a.rate}%</p>
            <p className="mt-1 text-sm font-semibold">{formatCurrency(a.done)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
