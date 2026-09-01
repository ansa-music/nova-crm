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
      { keys: ["Esc"], label: "Закрыть окно / снять выделение" },
    ],
  },
  {
    title: "В таблице — навигация",
    items: [
      { keys: ["↑", "↓", "←", "→"], label: "Перейти к соседней ячейке" },
      { keys: ["Shift", "↑↓←→"], label: "Выделить диапазон ячеек" },
      { keys: ["Ctrl", "↑↓←→"], label: "Прыгнуть к краю таблицы" },
      { keys: ["PgUp", "PgDn"], label: "На экран вверх / вниз" },
      { keys: ["Tab"], label: "Следующая ячейка (в конце — новая строка)" },
      { keys: ["Home", "End"], label: "К первому / последнему столбцу" },
      { keys: ["Ctrl", "Home"], label: "К первой ячейке таблицы" },
      { keys: ["Ctrl", "End"], label: "К последней ячейке таблицы" },
      { keys: ["Ctrl", "F"], label: "Поиск по столу" },
    ],
  },
  {
    title: "В таблице — редактирование",
    items: [
      { keys: ["Enter"], label: "Редактировать / открыть список или календарь" },
      { keys: ["F2"], label: "Редактировать ячейку" },
      { keys: ["Space"], label: "Открыть карточку строки" },
      { keys: ["Shift", "Enter"], label: "Сохранить, не переходя вниз" },
      { keys: ["Ctrl", "C"], label: "Скопировать выделенные ячейки" },
      { keys: ["Ctrl", "V"], label: "Вставить (в т.ч. из Excel)" },
      { keys: ["Ctrl", "A"], label: "Выделить все ячейки" },
      { keys: ["Delete"], label: "Очистить выделенные ячейки" },
      { keys: ["Ctrl", "Z"], label: "Отменить последнее действие" },
      { keys: ["Ctrl", "Y"], label: "Вернуть отменённое действие" },
      { keys: ["Ctrl", "D"], label: "Заполнить вниз из ячейки сверху" },
      { keys: ["Ctrl", "Enter"], label: "Добавить строку" },
      { keys: ["Ctrl", "Shift", "Enter"], label: "Вставить строку сверху" },
      { keys: ["Ctrl", "Shift", "D"], label: "Дублировать строку" },
      { keys: ["Ctrl", "Space"], label: "Выделить столбец" },
      { keys: ["Shift", "Space"], label: "Выделить строку" },
      { keys: ["Ctrl", "Alt", "C"], label: "Копировать строку целиком" },
      { keys: ["Буква"], label: "На ячейке статуса — выбрать вариант по первой букве" },
    ],
  },
  {
    title: "В карточке строки",
    items: [
      { keys: ["←", "→"], label: "Предыдущая / следующая строка" },
      { keys: ["Esc"], label: "Закрыть карточку" },
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" /> Горячие клавиши
          </DialogTitle>
          <DialogDescription>Нажмите «?» в любой момент, чтобы открыть эту подсказку снова.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
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
