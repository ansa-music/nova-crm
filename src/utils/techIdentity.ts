import type { StatusOption, WorkspaceMember } from "@/types";

/**
 * Кто такой технарь в строке стола ОС — по нику из столбца «Технарь».
 *
 * Жалоба Nurba 24.09.2026: «непонятно, кто технарь». Ячейка рисовала ник как
 * статус («● ник»), без лица и имени; ник, которого нет в списке, — «—», а
 * карточка строки падала на СЫРОЕ значение варианта (`opt_…`). Здесь одна
 * развязка на все экраны: подпись ника, настоящее имя, фото и что с ником не
 * так. Сырое значение наружу не показываем никогда — только для сравнения.
 */

/**
 * - `unknown-nick` — ника нет ни в списке ников технарей, ни у людей;
 * - `no-account` — ник в списке есть, а живого аккаунта под ним нет;
 * - `inactive` — ник в неактуальных или его аккаунт выключен.
 */
export type TechIdentityIssue = "unknown-nick" | "no-account" | "inactive";

export interface TechIdentity {
  /** Значение варианта (`opt_…`) — для сравнения, НЕ для показа. */
  nick: string;
  /** uid живого аккаунта под этим ником. */
  uid: string | null;
  /** Как показывать ник. null — показать нечего (`unknown-nick`). */
  label: string | null;
  /** Имя человека, если оно не совпадает с ником. */
  realName: string | null;
  photoURL: string | null;
  issue: TechIdentityIssue | null;
}

type MemberLike = Pick<WorkspaceMember, "uid" | "status" | "techNickValue" | "techNick" | "nickname" | "name" | "photoURL">;

function realNameFor(member: MemberLike | null, label: string | null): string | null {
  const real = member ? member.nickname?.trim() || member.name?.trim() || "" : "";
  if (!real) return null;
  if (label && real.toLocaleLowerCase("ru") === label.toLocaleLowerCase("ru")) return null;
  return real;
}

/**
 * Ник технаря → кто это. `null` — ника в ячейке нет.
 * Живой аккаунт ищется так же, как у выдачи (`techUidByNick`): активный
 * участник с этим `techNickValue`.
 */
export function resolveTechIdentity(
  nick: string | null | undefined,
  members: readonly MemberLike[],
  techNickOptions: readonly StatusOption[] | null | undefined
): TechIdentity | null {
  const value = nick === null || nick === undefined ? "" : String(nick).trim();
  if (!value) return null;
  const option = techNickOptions?.find((o) => o.value === value) ?? null;
  const active = members.find((m) => m.status === "active" && Boolean(m.uid) && m.techNickValue === value) ?? null;
  const anyMember = active ?? members.find((m) => m.techNickValue === value) ?? null;
  let label = option?.label?.trim() || anyMember?.techNick?.trim() || null;
  let realName = realNameFor(anyMember, label);
  // Ника как подписи нет, а человек есть — подписываем его именем.
  if (!label && realName) {
    label = realName;
    realName = null;
  }
  const issue: TechIdentityIssue | null = active
    ? null
    : anyMember || option?.inactive
      ? "inactive"
      : option
        ? "no-account"
        : "unknown-nick";
  return {
    nick: value,
    uid: active?.uid ?? null,
    label: issue === "unknown-nick" ? null : label,
    realName: active ? realName : null,
    photoURL: active?.photoURL ?? null,
    issue,
  };
}

/**
 * Кто по uid — для заказа, отданного с «Заказов»: ника в строке ещё нет, а
 * в заказе — uid и имя технаря (`assignedUid`/`assignedName`).
 */
export function techIdentityOfUid(
  uid: string | null | undefined,
  fallbackName: string | null | undefined,
  members: readonly MemberLike[],
  techNickOptions: readonly StatusOption[] | null | undefined
): TechIdentity | null {
  const member = uid ? (members.find((m) => m.uid === uid) ?? null) : null;
  if (member?.techNickValue) {
    const byNick = resolveTechIdentity(member.techNickValue, members, techNickOptions);
    if (byNick && !byNick.issue) return byNick;
  }
  const label =
    (member?.techNickValue ? techNickOptions?.find((o) => o.value === member.techNickValue)?.label?.trim() : "") ||
    member?.techNick?.trim() ||
    fallbackName?.trim() ||
    member?.nickname?.trim() ||
    member?.name?.trim() ||
    null;
  if (!label) return null;
  return {
    nick: member?.techNickValue ?? "",
    uid: member?.uid ?? uid ?? null,
    label,
    realName: realNameFor(member, label),
    photoURL: member?.photoURL ?? null,
    issue: null,
  };
}

/** Подсказка к нику: «ARM-07 — Арман Ахметов» или что с ником не так. */
export function techIdentityTitle(identity: TechIdentity | null): string {
  if (!identity) return "Технарь не выбран";
  if (identity.issue === "unknown-nick") return "Этого ника нет в списке ников технарей — выберите технаря заново";
  const who = identity.realName ? `${identity.label} — ${identity.realName}` : (identity.label ?? "технарь");
  if (identity.issue === "no-account") return `${who}. У этого ника нет аккаунта — закрепите ник на «Команде»`;
  if (identity.issue === "inactive") return `${who}. Ник в неактуальных или аккаунт выключен — заказ ему не уйдёт`;
  return who;
}

/** Как назвать технаря в тексте: подпись ника, иначе «технарь». */
export function techShortName(identity: TechIdentity | null | undefined, fallback = "технарю"): string {
  return identity?.label || fallback;
}

/**
 * Подпись всего, от чего зависит показ ников в ячейках: люди (ник, имя, фото,
 * статус) и подписи вариантов. Строки таблицы сравнивают пропсы (memo) — без
 * этой подписи бейджи остались бы старыми после смены фото или ника.
 */
export function techIdentitySignature(
  members: readonly MemberLike[],
  techNickOptions: readonly StatusOption[] | null | undefined
): string {
  const people = members
    .filter((m) => m.techNickValue)
    .map((m) => `${m.uid}:${m.techNickValue}:${m.techNick ?? ""}:${m.nickname ?? ""}:${m.name ?? ""}:${m.photoURL ?? ""}:${m.status}`)
    .sort()
    .join("|");
  const options = (techNickOptions ?? []).map((o) => `${o.value}:${o.label}:${o.inactive ? 1 : 0}`).join("|");
  return `${people}#${options}`;
}
