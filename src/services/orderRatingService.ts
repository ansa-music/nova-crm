import { onSnapshot, query, runTransaction, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { previousMonthKey } from "@/services/monthTabService";
import type { OrderRating, OrderRatingTotals } from "@/types";

export function orderRatingId(pageId: string, rowId: string) {
  return `${pageId}_${rowId}`;
}

export function orderRatingTotalsId(osUid: string, technicianUid: string, monthKey: string) {
  return `${osUid}_${technicianUid}_${monthKey}`;
}

/**
 * Итоги по всем парам — её читает каждый участник («Технари» и «Дашборд»
 * показывают рейтинг по заказам всем). Документ на пару ОС×Технарь В МЕСЯЦ,
 * так что коллекция растёт каждый месяц, а экранам нужны только текущий
 * месяц и закреплённый итог прошлого — их и читаем. `monthKey` у итогов был
 * с самого их появления, `in` по одному полю обходится автоматическим
 * индексом. Сменился месяц — хук переподписывается с новой парой месяцев.
 */
export function subscribeOrderRatingTotals(
  workspaceId: string,
  monthKey: string,
  onData: (totals: OrderRatingTotals[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.orderRatingTotalsAll(workspaceId), where("monthKey", "in", [previousMonthKey(monthKey), monthKey])),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as OrderRatingTotals), id: d.id }))),
    withErrorReporting(onError)
  );
}

/**
 * Сами оценки за заказы видит только тот, кто их ставил: в них лежит
 * название заказа, а ОС не должен видеть чужие заказы (и Тимлид — ничьи).
 * Правило пускает по `osUid`, запрос повторяет его ровно — иначе
 * неоднородные права уронят весь list (см. CLAUDE.md).
 *
 * Только за `monthKey`: оценки нужны лишь, чтобы подсветить звёзды у заказов
 * в «Мои заказы», а там только заказы вкладки текущего месяца — и оценить их
 * можно было только в этом же месяце. Без фильтра каждая подписка ОС
 * перечитывала бы все его оценки за всё время (по документу на заказ). Два
 * равенства сервер собирает из одиночных индексов — составной не нужен.
 */
export function subscribeMyOrderRatings(
  workspaceId: string,
  osUid: string,
  monthKey: string,
  onData: (ratings: OrderRating[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db || !osUid) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.orderRatingsAll(workspaceId), where("osUid", "==", osUid), where("monthKey", "==", monthKey)),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as OrderRating), id: d.id }))),
    withErrorReporting(onError)
  );
}

/**
 * Ставит или меняет оценку заказа И правит итоги пары ОДНОЙ транзакцией.
 *
 * Обязательно транзакцией, а не двумя записями: итоги — это счётчик, и
 * «прочитал, посчитал, записал» двумя вкладками (или двойным кликом)
 * разъезжается с реальностью навсегда — ровно та же ловушка, что с квотой
 * столов технаря в CLAUDE.md. Дельту считаем от предыдущего значения этой
 * же оценки, поэтому смена 5→3 не добавляет заказ в count.
 */
export async function rateOrder(input: {
  workspaceId: string;
  pageId: string;
  rowId: string;
  osUid: string;
  osValue: string;
  technicianUid: string;
  stars: number;
  title: string;
  monthKey: string;
}) {
  if (!db) return;
  const stars = Math.max(1, Math.min(5, Math.round(input.stars)));
  const ratingRef = paths.orderRating(input.workspaceId, orderRatingId(input.pageId, input.rowId));
  const totalsRef = paths.orderRatingTotals(
    input.workspaceId,
    orderRatingTotalsId(input.osUid, input.technicianUid, input.monthKey)
  );
  const now = Date.now();
  await runTransaction(db, async (tx) => {
    const ratingSnap = await tx.get(ratingRef);
    const totalsSnap = await tx.get(totalsRef);
    const previous = ratingSnap.exists() ? (ratingSnap.data() as OrderRating) : null;
    if (previous?.stars === stars) return;

    tx.set(ratingRef, {
      workspaceId: input.workspaceId,
      pageId: input.pageId,
      rowId: input.rowId,
      osUid: input.osUid,
      osValue: input.osValue,
      technicianUid: input.technicianUid,
      stars,
      monthKey: input.monthKey,
      title: input.title.slice(0, 120),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    } satisfies Omit<OrderRating, "id">);

    const current = totalsSnap.exists() ? (totalsSnap.data() as OrderRatingTotals) : null;
    tx.set(totalsRef, {
      workspaceId: input.workspaceId,
      osUid: input.osUid,
      technicianUid: input.technicianUid,
      monthKey: input.monthKey,
      count: Math.max(0, (current?.count ?? 0) + (previous ? 0 : 1)),
      sum: Math.max(0, (current?.sum ?? 0) + stars - (previous?.stars ?? 0)),
      updatedAt: now,
    } satisfies Omit<OrderRatingTotals, "id">);
  });
}

/**
 * Снимает оценку с заказа и чинит итоги той же транзакцией — иначе среднее
 * «по заказам» навсегда останется посчитанным по уже удалённой оценке.
 *
 * Одна функция и для ОС (снять свою), и для Owner/Тимлида (убрать
 * несправедливую): кто именно имеет право, решают правила, а арифметика
 * итогов от этого не зависит — и не должна расходиться в зависимости от
 * того, кто нажал.
 */
export async function removeOrderRating(workspaceId: string, ratingId: string) {
  if (!db) return;
  const ratingRef = paths.orderRating(workspaceId, ratingId);
  await runTransaction(db, async (tx) => {
    const ratingSnap = await tx.get(ratingRef);
    if (!ratingSnap.exists()) return;
    const previous = ratingSnap.data() as OrderRating;
    const totalsRef = paths.orderRatingTotals(
      workspaceId,
      orderRatingTotalsId(previous.osUid, previous.technicianUid, previous.monthKey)
    );
    const totalsSnap = await tx.get(totalsRef);
    tx.delete(ratingRef);
    const current = totalsSnap.exists() ? (totalsSnap.data() as OrderRatingTotals) : null;
    tx.set(totalsRef, {
      workspaceId,
      osUid: previous.osUid,
      technicianUid: previous.technicianUid,
      monthKey: previous.monthKey,
      count: Math.max(0, (current?.count ?? 1) - 1),
      sum: Math.max(0, (current?.sum ?? previous.stars) - previous.stars),
      updatedAt: Date.now(),
    } satisfies Omit<OrderRatingTotals, "id">);
  });
}
