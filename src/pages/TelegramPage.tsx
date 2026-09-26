import { useEffect, useMemo, useState } from "react";
import { Loader2, LogOut, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { LoadingState } from "@/components/common/LoadingState";
import { TelegramAccessDialog } from "@/components/telegram/TelegramAccessDialog";
import { TelegramSetupGuide } from "@/components/telegram/TelegramSetupGuide";
import { TgChats, useTg } from "@/components/telegram/TgChats";
import { TgLogin } from "@/components/telegram/TgLogin";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { useWorkspace } from "@/hooks/useWorkspace";
import { refreshTelegramAccess, useTelegramAccess } from "@/services/telegram/telegramAccess";
import { findTgClients, setTgChatClient, setTgChatLink, useTgChatLinks, type TgChatClient } from "@/services/telegram/tgChatLinks";
import type { TgLinking } from "@/components/telegram/TgOsLink";
import type { TgClientTools } from "@/components/telegram/TgClientLink";
import { usePeriodSettings } from "@/hooks/useCurrentPeriodKey";
import { clientNameAndPhone } from "@/utils/clientLabel";
import { deskNavState, deskRowHref } from "@/utils/deskLinks";
import { periodLabel, periodOfTabId } from "@/utils/periods";
import { useNavigate } from "react-router";
import { logOutTelegram, openTelegram } from "@/services/telegram/tgClient";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { myDisplayName } from "@/utils/displayName";

/**
 * «Telegram» (просьба Nurba 26.09.2026): рабочий аккаунт Telegram прямо в
 * Nova — чаты слева, переписка справа, отправка видео до 2 ГБ (с Premium —
 * до 4 ГБ) с прогрессом. У тех, кого отметил Owner («Доступ и ключи»):
 * ОС, технарей и других — любая роль (с SQL 20261012). Сам Telegram через Supabase и Firebase не идёт: браузер
 * говорит с серверами Telegram напрямую (services/telegram/tgClient.ts).
 */
export default function TelegramPage() {
  const { activeWorkspaceId, activeWorkspace, members, allPages, osDesks } = useWorkspace();
  const navigate = useNavigate();
  const periods = usePeriodSettings();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const uid = profile?.uid ?? null;
  const isOwner = permissions.actsAsOwner;
  const canHave = permissions.isResolved;
  const access = useTelegramAccess(activeWorkspaceId, uid, canHave);
  const granted = canHave && access.granted;
  const tg = useTg();
  const [manageOpen, setManageOpen] = useState(false);
  // Закрыли «Доступ и ключи» — инструкция перечитает, сколько ОС отмечено.
  const [accessRev, setAccessRev] = useState(0);
  const onManageOpenChange = (open: boolean) => {
    setManageOpen(open);
    if (!open) setAccessRev((n) => n + 1);
  };
  const [chatParam, setChatParam] = useUrlState<string>("chat", "");
  const chatId = chatParam && /^-?\d+$/.test(chatParam) ? Number(chatParam) : null;
  const deviceName = `Nova · ${myDisplayName(profile, members)}`;
  const config = access.config;

  // Привязка чатов к нику ОС (SQL 20261013): только пока открыт раздел.
  const chatLinks = useTgChatLinks(activeWorkspaceId, granted);
  const osOptions = activeWorkspace?.responsibleOptions;
  const myOsValue = useMemo(() => members.find((m) => m.uid === uid)?.osNickValue ?? null, [members, uid]);
  // Чат ↔ клиент (SQL 20261014): поиск по столам и переход к строке с визиткой.
  const pagesById = useMemo(() => new Map([...allPages, ...osDesks].map((p) => [p.id, p])), [allPages, osDesks]);
  const clientTools = useMemo<TgClientTools | null>(() => {
    if (!activeWorkspaceId || !uid || !chatLinks.loaded || chatLinks.clientsMissingSql) return null;
    const tabName = (pageId: string, tabId: string) => {
      const page = pagesById.get(pageId);
      if (!tabId) return page?.osDesk && page.mainTabName ? page.mainTabName : "Основная";
      const key = periodOfTabId(tabId);
      return key ? periodLabel(key, periods) : "";
    };
    return {
      clients: chatLinks.clients,
      find: (query) => findTgClients(activeWorkspaceId, query),
      describe: ({ pageId, tabId, cells }) => {
        const page = pagesById.get(pageId);
        const { name, phone } = clientNameAndPhone(cells, page?.columns);
        const place = [page?.name ?? "Стол", tabName(pageId, tabId)].filter(Boolean).join(" · ");
        return { name, phone, place };
      },
      setClient: (dialog, target) => setTgChatClient(activeWorkspaceId, dialog.id, target, uid),
      // Вкладку в адрес не кладём: после переноса заказа в новый период строка
      // живёт в другой вкладке, и стол сам найдёт её по id (?row без ?tab).
      open: (client: TgChatClient) =>
        navigate(`${deskRowHref(client.pageId, undefined, client.rowId)}&card=1`, {
          state: deskNavState({ to: `/telegram?chat=${client.chatId}`, label: "Telegram" }),
        }),
    };
  }, [activeWorkspaceId, uid, chatLinks.loaded, chatLinks.clientsMissingSql, chatLinks.clients, pagesById, periods, navigate]);

  const linking = useMemo<TgLinking | null>(() => {
    if (!activeWorkspaceId || !uid || !chatLinks.loaded || chatLinks.missingSql) return null;
    return {
      links: chatLinks.links,
      options: osOptions ?? [],
      myOsValue,
      setLink: (dialog, osValue) => setTgChatLink(activeWorkspaceId, dialog.id, osValue, dialog.title, uid),
      client: clientTools,
    };
  }, [activeWorkspaceId, uid, chatLinks.loaded, chatLinks.missingSql, chatLinks.links, osOptions, myOsValue, clientTools]);

  useEffect(() => {
    if (!granted || !config || !activeWorkspaceId || !uid) return;
    void openTelegram({ workspaceId: activeWorkspaceId, uid, config, deviceName });
    // deviceName меняется с ником — сессию из-за этого не пересоздаём.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granted, config?.apiId, config?.apiHash, activeWorkspaceId, uid]);

  if (!permissions.isResolved || (access.loading && !access.key)) return <LoadingState label="Открываю Telegram…" />;
  if (access.loading) return <LoadingState label="Проверяю доступ…" />;

  if (!granted && !isOwner) {
    return (
      <AccessDenied
        title="Раздел Telegram закрыт"
        reason="Раздел Telegram Owner открывает отдельным людям — попросите его выдать вам доступ."
      />
    );
  }

  const manageButton = isOwner ? (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setManageOpen(true)}>
      <ShieldCheck className="h-4 w-4" /> Доступ и ключи
    </Button>
  ) : null;

  const dialog =
    isOwner && activeWorkspaceId ? (
      <TelegramAccessDialog open={manageOpen} onOpenChange={onManageOpenChange} workspaceId={activeWorkspaceId} members={members} config={config} />
    ) : null;

  const me = tg.auth.kind === "ready" ? tg.auth.me : null;

  async function logout() {
    if (!activeWorkspaceId || !uid || !config) return;
    const ok = await confirmDialog({
      title: "Выйти из Telegram на этом браузере?",
      description: "Вход пропадёт и из списка устройств Telegram. Чтобы вернуться, понадобится телефон с рабочим аккаунтом.",
      confirmLabel: "Выйти",
      destructive: true,
    });
    if (!ok) return;
    await logOutTelegram({ workspaceId: activeWorkspaceId, uid, config, reason: "button" });
    setChatParam("");
    await openTelegram({ workspaceId: activeWorkspaceId, uid, config, deviceName });
    toast.success("Вы вышли из Telegram на этом браузере");
  }

  let body: React.ReactNode;
  if (access.missingSql) {
    body = (
      <Pane>
        <Alert tone="warning" title="Раздел ещё не готов в базе">
          SQL раздела Telegram накатится со следующим деплоем. Обновите страницу чуть позже.
        </Alert>
      </Pane>
    );
  } else if (isOwner && activeWorkspaceId && (!granted || !config)) {
    // Owner: пошаговая инструкция «Как подключить» с отметками сделанного.
    body = (
      <Pane wide>
        <TelegramSetupGuide workspaceId={activeWorkspaceId} config={config} refreshKey={accessRev} onOpenAccess={() => setManageOpen(true)} />
      </Pane>
    );
  } else if (!config) {
    body = (
      <Pane>
        <Alert tone="warning" title="Ключи Telegram ещё не введены">
          {isOwner ? "Введите api_id и api_hash в «Доступ и ключи»." : "Owner ещё не ввёл ключи приложения Telegram — раздел заработает, как только он это сделает."}
        </Alert>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={refreshTelegramAccess}>
          <RefreshCw className="h-4 w-4" /> Проверить снова
        </Button>
      </Pane>
    );
  } else if (tg.auth.kind === "idle" || tg.auth.kind === "connecting") {
    body = <LoadingState label="Подключаюсь к Telegram…" />;
  } else if (tg.auth.kind === "error") {
    const message = tg.auth.message;
    body = (
      <Pane>
        <Alert tone="error" title="Telegram не подключился">
          {message}
        </Alert>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => activeWorkspaceId && uid && void openTelegram({ workspaceId: activeWorkspaceId, uid, config, deviceName })}
        >
          <RefreshCw className="h-4 w-4" /> Повторить
        </Button>
      </Pane>
    );
  } else if (tg.auth.kind === "ready" && me) {
    body = <TgChats me={me} chatId={chatId} onOpenChat={(id) => setChatParam(id === null ? "" : String(id))} linking={linking} />;
  } else {
    body = <TgLogin auth={tg.auth} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 sm:px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
          <Send className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Telegram</h1>
          <p className="truncate text-[12px] text-muted-foreground">
            {me ? `${me.name}${me.username ? ` · @${me.username}` : ""}${me.isPremium ? " · Premium" : ""}` : "Рабочий аккаунт"}
          </p>
        </div>
        {access.error && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title={access.error}>
            <Loader2 className="h-3 w-3" /> доступ не перепроверен
          </span>
        )}
        {manageButton}
        {me && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Выйти
          </Button>
        )}
      </div>
      {body}
      {dialog}
    </div>
  );
}

function Pane({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto w-full space-y-3 p-4 sm:p-8", wide ? "max-w-2xl" : "max-w-xl")}>{children}</div>
    </div>
  );
}
