/**
 * Одна подписка Firestore на много читателей — и живёт ещё минуту после
 * ухода последнего. Зачем: боковое меню снимается и ставится заново при
 * каждом переключении полноэкранной таблицы и при открытии меню на телефоне,
 * и каждая новая подписка заново читает ВСЕ документы запроса (это и есть
 * чтения, которыми кончалась квота Spark). С «задержкой ухода» повторный
 * монтаж получает уже готовые данные без единого чтения.
 */
type Reader<T> = (value: T) => void;

interface Entry<T> {
  value: T | undefined;
  hasValue: boolean;
  readers: Set<Reader<T>>;
  unsubscribe: () => void;
  lingerTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry<unknown>>();

export function joinSharedSubscription<T>(
  key: string,
  start: (emit: (value: T) => void) => () => void,
  reader: Reader<T>,
  lingerMs = 60_000
): () => void {
  let entry = entries.get(key) as Entry<T> | undefined;
  if (!entry) {
    const created: Entry<T> = { value: undefined, hasValue: false, readers: new Set(), unsubscribe: () => {}, lingerTimer: null };
    entries.set(key, created as Entry<unknown>);
    created.unsubscribe = start((value) => {
      created.value = value;
      created.hasValue = true;
      created.readers.forEach((fn) => fn(value));
    });
    entry = created;
  }
  const current = entry;
  if (current.lingerTimer) {
    clearTimeout(current.lingerTimer);
    current.lingerTimer = null;
  }
  current.readers.add(reader);
  if (current.hasValue) reader(current.value as T);
  return () => {
    current.readers.delete(reader);
    if (current.readers.size > 0 || current.lingerTimer) return;
    current.lingerTimer = setTimeout(() => {
      current.lingerTimer = null;
      if (current.readers.size > 0) return;
      current.unsubscribe();
      if (entries.get(key) === current) entries.delete(key);
    }, lingerMs);
  };
}
