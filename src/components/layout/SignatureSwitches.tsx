import { PageModeSwitch } from "@/components/common/PageModeSwitch";
import { DESKS_GROUP_KEYS, TEAM_GROUP_KEYS, groupTabs } from "@/config/signatureNav";
import { useNavModel } from "@/hooks/useNavModel";
import { useUiStore } from "@/store/uiStore";

/**
 * Переключатели объединённых разделов NOVA Signature (просьба Nurba
 * 12.10.2026): в меню один пункт, вкладки — внутри страницы. Адреса страниц
 * прежние (старые ссылки и уведомления ведут куда вели); вкладки — из модели
 * меню, поэтому у роли видны только её разделы. Вне Signature и когда вкладка
 * одна — ничего не рисуют.
 */
function GroupSwitch({ keys, label, className }: { keys: readonly string[]; label: string; className?: string }) {
  const signature = useUiStore((s) => s.uiSkin === "signature");
  const nav = useNavModel();
  if (!signature) return null;
  const tabs = groupTabs(nav.items, keys);
  if (tabs.length < 2) return null;
  return (
    <PageModeSwitch
      label={label}
      className={className}
      tabs={tabs.map((t) => ({ to: t.to, label: t.label, icon: t.icon, count: t.badge }))}
    />
  );
}

/** «Столы / Столы ОС». */
export function DesksModeSwitch({ className = "mb-4" }: { className?: string }) {
  return <GroupSwitch keys={DESKS_GROUP_KEYS} label="Столы" className={className} />;
}

/** «Технари / Команда / Пользователи» («Люди» — только у кого нет «Пользователей»). */
export function TeamModeSwitch({ className = "mb-4" }: { className?: string }) {
  return <GroupSwitch keys={TEAM_GROUP_KEYS} label="Команда" className={className} />;
}
