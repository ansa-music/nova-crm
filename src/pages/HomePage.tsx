import { Navigate } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { useNavModel } from "@/hooks/useNavModel";

/**
 * «/» — дом человека, и где он, решает навигационная модель (`useNavModel().home`):
 * свой стол у технаря, «Технари» у ОС, «Пользователи» у Тимлида, иначе
 * обложки столов. Раньше та же логика лежала здесь и в Sidebar порознь.
 * Персональная главная появится следующим этапом — пока простой редирект.
 */
export default function HomePage() {
  const { isLoadingWorkspaceData } = usePeopleDesks();
  const nav = useNavModel();

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-6xl p-5 sm:p-8">
        <Skeleton className="mb-3 h-6 w-32" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  return <Navigate to={nav.home.to} replace />;
}
