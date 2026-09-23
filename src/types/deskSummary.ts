/**
 * Контракт между DataTable и шапкой стола (DynamicTablePage).
 *
 * Стол считает суммы по видимым (отфильтрованным) строкам сам — у него есть
 * processedRows и разрешённые statusOptions. Шапка стола только рисует то,
 * что ей отдали через onSummaryChange, и вызывает действия из onActionsChange
 * («+ Заказ» живёт в шапке, а логика быстрого заказа — внутри DataTable).
 */
export interface DeskSummary {
  /** Заполненных строк после фильтра/поиска. */
  rowCount: number;
  /** Групп при включённой группировке, иначе 0. */
  groupCount: number;
  /** Сумма по всем денежным столбцам. */
  total: number;
  /** Сумма строк со статусом «Готово»-подобным (isDoneStatusLabel). */
  done: number;
  /** Сумма строк со статусом «В работе» (findInProgressStatusOption). */
  inProgress: number;
  /** Сумма строк со статусом «Ждём»/«Ожидание»/«оплат…» (isWaitingStatusLabel). */
  waiting: number;
  /** Есть ли на столе денежный столбец — без него суммы не показываем. */
  hasCurrency: boolean;
  /** Есть ли столбец-статус — без него Готово/В работе/Ждём не показываем. */
  hasStatus: boolean;
}

export interface DeskTableActions {
  /** Добавить пустую строку (как кнопка «Строка» в тулбаре). */
  addRow: () => void;
  /** Открыть диалог быстрого заказа (как кнопка «Заказ»). */
  quickOrder: () => void;
  canAddRow: boolean;
  canQuickOrder: boolean;
}
