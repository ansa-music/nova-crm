import { fetchGrokAccounts } from "@/services/grokAccountService";
import { usePolledData } from "@/hooks/usePolledData";
import type { GrokAccount } from "@/types";

export function useGrokAccounts(workspaceId: string | null) {
  const { data: accounts, isLoading, reload } = usePolledData<GrokAccount[]>(
    Boolean(workspaceId),
    () => fetchGrokAccounts(workspaceId as string),
    [],
    [workspaceId]
  );

  return { accounts, isLoading, reload };
}
