/**
 * Свой раздел графика: название задаёт руководство, люди в нём — НЕ участники
 * workspace (монтажёры на подряде, пришедшие на месяц и т.п.). Роль им не
 * выдают, аккаунта у них нет, но смены у них есть.
 */
export interface SchedulePerson {
  id: string;
  name: string;
  /**
   * Ник ОС, за которым человек закреплён ЗАРАНЕЕ — пока у него нет аккаунта.
   * Когда этот ник закрепят за живым участником, его строка графика вместе с
   * неделей переедет на аккаунт (`bindScheduleGroupPersonToMember`), а здесь
   * исчезнет: два места с одним и тем же человеком разъехались бы за неделю.
   */
  osNick?: string;
}

export interface ScheduleGroup {
  id: string;
  workspaceId: string;
  name: string;
  people: SchedulePerson[];
  updatedAt: number;
  updatedBy: string;
}

/** Раздел на workspace один, поэтому id фиксированный — без списка документов. */
export const CUSTOM_SCHEDULE_GROUP_ID = "custom";
export const DEFAULT_CUSTOM_GROUP_NAME = "Другие";

/**
 * У своего человека нет uid, а документ графика лежит ИМЕННО по uid. Даём
 * синтетический id с префиксом: правило «участник правит свой selfWork»
 * сравнивает `resource.data.uid` с `request.auth.uid` и на таком id не
 * совпадёт никогда — значит, этот график ведёт только руководство.
 */
export function newSchedulePersonId(): string {
  return `ext_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
