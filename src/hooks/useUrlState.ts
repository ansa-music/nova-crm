import { useCallback, useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router";

interface UrlStateOptions<T extends string> {
  /**
   * `true` (умолчание) — смена значения не плодит записей в истории: чипы
   * фильтров жмут по десять раз подряд, и «Назад» иначе листал бы их все.
   */
  replace?: boolean;
  /** Допустимые значения: чужое или устаревшее в адресе → умолчание. */
  values?: readonly T[];
}

/**
 * Строковое состояние экрана в адресной строке (`?key=value`) поверх
 * `useSearchParams` роутера.
 *
 * Нужен там, где раньше стоял `useState` для вкладки или фильтра: F5 и
 * «Поделиться ссылкой» возвращали человека на умолчание. Умолчание в адрес
 * не пишется (ключ убирается), поэтому чистый `/orders` и `/orders?status=open`
 * — одно и то же, а ссылки в меню не размножают адресов.
 *
 * Через роутер, а не `window.history.replaceState`: то писало адрес мимо
 * `useLocation`, и остальные читатели адреса (например, `?row`) видели
 * устаревший `search`.
 */
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
  options: UrlStateOptions<T> = {},
): [T, (next: T) => void] {
  const { replace = true, values } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  // `setSearchParams` без `state` затирает `location.state` — а в нём `from`
  // («← Заказы» у стола): после клика по фильтру кнопка стала бы «Назад».
  // Через ref, а не в зависимостях: state после каждой навигации — новый
  // объект, и `setValue` менялся бы на каждый клик.
  const location = useLocation();
  const stateRef = useRef<unknown>(location.state);
  useEffect(() => {
    stateRef.current = location.state;
  }, [location.state]);
  const raw = searchParams.get(key);
  const value: T =
    raw === null
      ? defaultValue
      : values
        ? values.includes(raw as T)
          ? (raw as T)
          : defaultValue
        : (raw as T);

  const setValue = useCallback(
    (next: T) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === defaultValue) params.delete(key);
          else params.set(key, next);
          return params;
        },
        { replace, state: stateRef.current },
      );
    },
    [key, defaultValue, replace, setSearchParams],
  );

  return [value, setValue];
}
