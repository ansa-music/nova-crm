import { useEffect } from "react";
import { Keyboard } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUiStore } from "@/store/uiStore";

interface ShortcutGroup {
  title: string;
  items: { keys: string[]; label: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "В любом месте сайта",
    items: [
      { keys: ["Ctrl", "K"], label: "Быстрый поиск по страницам и людям" },
      { keys: ["G", "D"], label: "Перейти на главную" },
      { keys: ["G", "S"], label: "Открыть закреплённый или первый стол" },
      { keys: ["?"], label: "Показать эту подсказку" },
      { keys: ["Esc"], label: "Закрыть текущее окно/диалог" },
    ],
  },
  {
    title: "В таблице — навигация",
    items: [
      { keys: ["↑", "↓", "←", "→"], label: "Перейти к соседней ячейке" },
      { keys: ["Shift", "↑↓←→"], label: "Выделить диапазон ячеек" },
      { keys: ["Tab"], label: "Перейти к следующей ячейке" },
      { keys: ["Enter"], label: "Начать редактирование ячейки" },
      { keys: ["F2"], label: "Редактировать ячейку" },
      { keys: ["Home", "End"], label: "К первому/последнему столбцу строки" },
    ],
  },
  {
    title: "В таблице — редактирование",
    items: [
      { keys: ["Ctrl", "C"], label: "Скопировать выделенные ячейки" },
      { keys: ["Ctrl", "V"], label: "Вставить в выделенные ячейки" },
      { keys: ["Delete"], label: "Очистить выделенные ячейки" },
      { keys: ["Ctrl", "Z"], label: "Отменить последнее действие" },
      { keys: ["Ctrl", "Y"], label: "Вернуть отменённое действие" },
      { keys: ["Ctrl", "D"], label: "Заполнить вниз из ячейки сверху" },
      { keys: ["Ctrl", "Enter"], label: "Добавить строку" },
      { keys: ["Ctrl", "Shift", "Enter"], label: "Вставить строку сверху" },
      { keys: ["Ctrl", "Space"], label: "Выделить столбец" },
      { keys: ["Ctrl", "Alt", "C"], label: "Копировать строку" },
    ],
  },
];

function Keycap({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
      {children}
    </kbd>
  );
}

export function ShortcutsHelpDialog() {
  const open = useUiStore((s) => s.shortcutsHelpOpen);
  const setOpen = useUiStore((s) => s.setShortcutsHelpOpen);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || (document.activeElement as HTMLElement)?.isContentEditable) return;
      setOpen(!open);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Горячие клавиши
          </DialogTitle>
          <DialogDescription>Нажмите «?» в любой момент, чтобы открыть эту подсказку снова.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="eyebrow mb-2">{group.title}</p>
              <div className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <Keycap key={k}>{k}</Keycap>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
