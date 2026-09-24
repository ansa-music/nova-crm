/**
 * Ключи ячеек, занятые системой.
 *
 * Строку-заказ в столе технаря ведёт ОС (см. «Стол ОС — источник» в
 * CLAUDE.md): статус, цену, клиента технарь не правит. Но ДВА поля остаются
 * его — ссылка на сделанную работу и примечание, — и правило «технарь может
 * писать только их» должно быть выражено в firestore.rules и в политиках
 * Postgres. В языке правил Firestore нет ни filter, ни map (файл сам про это
 * предупреждает — прежний `columnStatusOptionsPreserved()` молча падал в
 * рантайме), поэтому единственная выразимая форма — «изменены ТОЛЬКО эти
 * ключи»: `cells.diff(...).affectedKeys().hasOnly(['techLink','techNote'])`.
 *
 * Отсюда требование: такие ключи не должен получить обычный столбец, иначе
 * человек, заведя столбец с этим ключом, открыл бы себе запись закрытого
 * поля. Ключи камелкейсные — диалог столбцов делает из названия slug в
 * нижнем регистре, так что совпасть случайно они не могут; проверка
 * нечувствительна к регистру на случай другого пути создания.
 */
export const TECH_LINK_KEY = "techLink";
export const TECH_NOTE_KEY = "techNote";
/**
 * Служебные ячейки строки-ИСТОЧНИКА на столе ОС (см. utils/osDispatchPlan.ts):
 * последний синхронизированный с технарём статус и ник технаря, у которого
 * копию удалили (чтобы проход не воскрешал её сам). Столбцами не рисуются.
 */
export const OS_STATUS_SENT_KEY = "osStatusSent";
export const OS_LOST_FOR_KEY = "osLostFor";
/**
 * Когда заказ отдан НЫНЕШНЕМУ технарю (мс строкой) — ставит `pushOrderToTech`
 * при заведении копии, снимают проход (технаря стёрли, копию удалили) и
 * «Вернуть» на «Правке столов». Показывает столбец «Даты» стола ОС.
 */
export const OS_ISSUED_AT_KEY = "osIssuedAt";

export const RESERVED_CELL_KEYS: readonly string[] = [TECH_LINK_KEY, TECH_NOTE_KEY, OS_STATUS_SENT_KEY, OS_LOST_FOR_KEY, OS_ISSUED_AT_KEY];

const RESERVED_LOWER = new Set(RESERVED_CELL_KEYS.map((k) => k.toLowerCase()));

export function isReservedCellKey(key: string): boolean {
  return RESERVED_LOWER.has(key.trim().toLowerCase());
}

/** Текст отказа — один на все места, где заводят столбец. */
export const RESERVED_CELL_KEY_ERROR = "Такой ключ занят системой — назовите столбец иначе";
