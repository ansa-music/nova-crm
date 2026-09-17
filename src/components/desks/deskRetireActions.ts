import { toast } from "@/components/ui/sonner";
import { setPageInactive } from "@/services/pageService";
import { confirmDialog } from "@/utils/appDialog";
import { memberHasRole, type WorkspaceMember, type WorkspacePage } from "@/types";

function claimsDesk(page: WorkspacePage, members: WorkspaceMember[]) {
  return memberHasRole(members.find((m) => m.uid === page.responsibleUserId) ?? null, "manager");
}

/** Bring a desk back from «Неактуальные» (Owner/Тимлид). */
export async function restoreDesk(page: WorkspacePage, members: WorkspaceMember[], byUid: string) {
  try {
    await setPageInactive(page.workspaceId, page, false, byUid, claimsDesk(page, members));
    toast.success(`«${page.name}» снова в столах`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Не удалось вернуть стол");
  }
}

/**
 * «В неактуальные» instead of deleting (Owner/Тимлид): asks first, keeps
 * every row and tab, and offers to undo right in the toast.
 */
export async function retireDesk(page: WorkspacePage, members: WorkspaceMember[], byUid: string) {
  const ok = await confirmDialog({
    title: `Убрать «${page.name}» в неактуальные?`,
    description:
      "Стол пропадёт из «Столов», дашборда и «Технарей». Вкладки и строки сохранятся — вернуть можно в любой момент в «Столы» → «Неактуальные».",
    confirmLabel: "В неактуальные",
  });
  if (!ok) return false;
  try {
    await setPageInactive(page.workspaceId, page, true, byUid, claimsDesk(page, members));
    toast.success(`«${page.name}» в неактуальных`, {
      action: { label: "Вернуть", onClick: () => void restoreDesk(page, members, byUid) },
    });
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Не удалось убрать стол");
    return false;
  }
}
