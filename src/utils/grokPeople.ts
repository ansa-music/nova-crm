import { rolesOf, type WorkspaceMember } from "@/types";
import { personLabel } from "@/utils/peopleDesks";
import { TEAM_GROUP_LABEL, TEAM_GROUPS, teamGroupOf, type TeamGroup } from "@/utils/teamGroup";
import { matchesPersonQuery } from "@/utils/weekTemplate";

/** Открыт ли человеку «Грок лимит» — зеркало canUseGrok: чистому ОС нет. */
export function canUseGrokMember(member: WorkspaceMember): boolean {
  return !rolesOf(member).every((role) => role === "os");
}

/**
 * Кого можно отметить в «Доступе к аккаунту» и в «Кто управляет разделом»:
 * живые участники с аккаунтом, кому страница вообще открыта. Owner и Тимлид
 * видят все аккаунты всегда — отмечать их нечем, в списке их нет. Чистый ОС
 * страницу не видит: отметить его можно было, а толку — ноль.
 */
export function grokPickerCandidates(members: WorkspaceMember[]): WorkspaceMember[] {
  return members.filter(
    (m) => m.status === "active" && Boolean(m.uid) && m.role !== "owner" && m.role !== "teamlead" && canUseGrokMember(m)
  );
}

export interface PickerGroup {
  id: TeamGroup;
  label: string;
  /** Все люди группы (для «все / снять»), независимо от поиска. */
  all: WorkspaceMember[];
  /** Люди группы, прошедшие поиск, по алфавиту. */
  people: WorkspaceMember[];
}

/**
 * Группы пикера — те же «Технари / ОС / Другие», что на «Команде»
 * (`teamGroupOf`). Пустые группы не рисуются; поиск — по началам слов имени,
 * ника и почты (`matchesPersonQuery`), как в графике.
 */
export function groupPickerPeople(candidates: WorkspaceMember[], query: string, order: readonly TeamGroup[] = TEAM_GROUPS): PickerGroup[] {
  const byGroup = new Map<TeamGroup, WorkspaceMember[]>();
  for (const m of candidates) {
    const g = teamGroupOf(m);
    byGroup.set(g, [...(byGroup.get(g) ?? []), m]);
  }
  const sortByName = (a: WorkspaceMember, b: WorkspaceMember) => personLabel(a).localeCompare(personLabel(b), "ru");
  return order.map((id): PickerGroup => {
    const all = (byGroup.get(id) ?? []).slice().sort(sortByName);
    return {
      id,
      label: TEAM_GROUP_LABEL[id],
      all,
      people: all.filter((m) => matchesPersonQuery(query, [m.name, m.nickname, personLabel(m), m.email])),
    };
  }).filter((g) => g.all.length > 0);
}

/** Начальный выбор: только те uid, что есть среди кандидатов (ушедшие не тянутся в «Сохранить · N»). */
export function pickerInitialSelection(uids: readonly string[], candidates: WorkspaceMember[]): string[] {
  const allowed = new Set(candidates.map((m) => m.uid));
  return Array.from(new Set(uids.filter((id) => allowed.has(id))));
}
