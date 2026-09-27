import { useEffect, useMemo, useState } from "react";
import { Loader2, LogOut, RefreshCw, Send, ShieldCheck, Unplug } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { LoadingState } from "@/components/common/LoadingState";
import { TelegramAccessDialog } from "@/components/telegram/TelegramAccessDialog";
import { TelegramSetupGuide } from "@/components/telegram/TelegramSetupGuide";
import { TgChats, useTg } from "@/components/telegram/TgChats";
import { TgLogin } from "@/components/telegram/TgLogin";
import { TgConnect } from "@/components/telegram/TgConnect";
import { TgTechChats } from "@/components/telegram/TgTechChats";
import type { TgTechGrantTools } from "@/components/telegram/TgTechGrant";
import { callTgEdge, refreshTgServer, ringTgServer, tgFunctionMissing, tgServerLink, useTgServer, useTgTechAccess } from "@/services/telegram/tgServer";
import { memberHasRole } from "@/types";
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
import { acceptLoginUrlHere, logOutTelegram, openTelegram, retryTelegramNow, takeOverTelegram } from "@/services/telegram/tgClient";
import { TgConnDot, TgElsewhere, TgRetryIn } from "@/components/telegram/TgConnection";
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
  // Аккаунт workspace на сервере (SQL 20261035 + функция `tg`): один на
  // workspace, вход не вылетает, браузеры получают устройство без QR.
  const server = useTgServer(activeWorkspaceId, canHave && (granted || isOwner));
  const serverMode = server.connected && !tgFunctionMissing();
  const canUse = granted || (isOwner && serverMode);
  // Технарь без полного доступа: только чаты, которые ему открыл ОС.
  const techAccess = useTgTechAccess(activeWorkspaceId, uid, canHave && !canUse);
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
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

  // «Технарю»: открыть переписку с клиентом технарю заказа (SQL 20261035).
  const techGrant = useMemo<TgTechGrantTools | null>(() => {
    if (!activeWorkspaceId || !serverMode) return null;
    const candidates = members.filter((m) => m.uid && m.uid !== uid && m.status !== "invited" && memberHasRole(m, "manager"));
    return {
      workspaceId: activeWorkspaceId,
      candidates,
      clientOf: (id) => {
        const c = chatLinks.clients[id];
        return c ? { pageId: c.pageId, rowId: c.rowId } : null;
      },
    };
  }, [activeWorkspaceId, serverMode, members, uid, chatLinks.clients]);

  const linking = useMemo<TgLinking | null>(() => {
    if (!activeWorkspaceId || !uid || !chatLinks.loaded || chatLinks.missingSql) return null;
    return {
      links: chatLinks.links,
      options: osOptions ?? [],
      myOsValue,
      setLink: (dialog, osValue) => setTgChatLink(activeWorkspaceId, dialog.id, osValue, dialog.title, uid),
      client: clientTools,
      techGrant,
    };
  }, [activeWorkspaceId, uid, chatLinks.loaded, chatLinks.missingSql, chatLinks.links, osOptions, myOsValue, clientTools, techGrant]);

  const accountId = server.account?.id ?? null;
  useEffect(() => {
    if (!canUse || !config || !activeWorkspaceId || !uid) return;
    if (server.loading) return;
    void openTelegram({
      workspaceId: activeWorkspaceId,
      uid,
      config,
      deviceName,
      server: serverMode ? tgServerLink(activeWorkspaceId, accountId) : null,
    });
    // deviceName меняется с ником — сессию из-за этого не пересоздаём.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, config?.apiId, config?.apiHash, activeWorkspaceId, uid, serverMode, accountId, server.loading]);

  if (!permissions.isResolved || (access.loading && !access.key)) return <LoadingState label="Открываю Telegram…" />;
  if (access.loading) return <LoadingState label="Проверяю доступ…" />;

  if (!canUse && !isOwner && techAccess && activeWorkspaceId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 sm:px-6">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
            <Send className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">Telegram</h1>
            <p className="truncate text-[12px] text-muted-foreground">Клиенты ваших заказов</p>
          </div>
        </div>
        <TgTechChats workspaceId={activeWorkspaceId} chatId={chatId} onOpenChat={(id) => setChatParam(id === null ? "" : String(id))} />
      </div>
    );
  }

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

  async function disconnect() {
    if (!activeWorkspaceId) return;
    const ok = await confirmDialog({
      title: "Отключить Telegram от workspace?",
      description: "Аккаунт выйдет на сервере и на всех устройствах Nova. Чтобы вернуть, Owner подключит его заново (QR или код).",
      confirmLabel: "Отключить",
      destructive: true,
    });
    if (!ok) return;
    try {
      await callTgEdge(activeWorkspaceId, "disconnect");
      ringTgServer(activeWorkspaceId);
      refreshTgServer();
      toast.success("Telegram отключён от workspace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отключить");
    }
  }

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
  } else if (isOwner && activeWorkspaceId && config && !serverMode && !server.sqlMissing && !server.loading && !tgFunctionMissing() && (connectOpen || (!legacyLogin && (!canUse || tg.auth.kind === "signedOut")))) {
    // Owner: подключить аккаунт к workspace один раз (вход на сервере).
    body = (
      <Pane>
        <TgConnect
          workspaceId={activeWorkspaceId}
          migrate={tg.auth.kind === "ready" ? acceptLoginUrlHere : null}
          onLegacy={granted && tg.auth.kind !== "ready" ? () => setLegacyLogin(true) : null}
        />
        {connectOpen && (
          <Button variant="ghost" size="sm" onClick={() => setConnectOpen(false)}>
            Вернуться к чатам
          </Button>
        )}
      </Pane>
    );
  } else if (isOwner && activeWorkspaceId && (!canUse || !config)) {
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
  } else if (tg.auth.kind === "issuing") {
    body = <LoadingState label="Подключаю это устройство к аккаунту workspace…" />;
  } else if (tg.auth.kind === "elsewhere") {
    body = (
      <Pane>
        <TgElsewhere onTakeOver={() => void takeOverTelegram()} />
      </Pane>
    );
  } else if (tg.auth.kind === "error") {
    const message = tg.auth.message;
    const retryAt = tg.auth.retryAt;
    body = (
      <Pane>
        <Alert tone={retryAt ? "warning" : "error"} title={retryAt ? "Нет связи с Telegram — переподключаюсь сам" : "Telegram не подключился"}>
          {message}
          {retryAt && <TgRetryIn at={retryAt} />}
        </Alert>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={retryTelegramNow}>
          <RefreshCw className="h-4 w-4" /> {retryAt ? "Повторить сейчас" : "Повторить"}
        </Button>
      </Pane>
    );
  } else if (tg.auth.kind === "ready" && me) {
    body = (
      <>
        {isOwner && !serverMode && !server.sqlMissing && !server.loading && !tgFunctionMissing() && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-sky-500/5 px-4 py-2 text-[12px] sm:px-6">
            <span className="min-w-0 flex-1">Сейчас вход только в этом браузере. Сделайте его общим для workspace — тогда Telegram не будет вылетать, а другим не нужен QR.</span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setConnectOpen(true)}>
              Сделать общим
            </Button>
          </div>
        )}
        <TgChats me={me} chatId={chatId} onOpenChat={(id) => setChatParam(id === null ? "" : String(id))} linking={linking} />
      </>
    );
  } else if (serverMode && tg.auth.kind === "password") {
    // Пароль на сервере не сохранён — облачный пароль вводят один раз в этом браузере.
    body = (
      <Pane>
        <TgLogin auth={tg.auth} lastEnd={null} />
      </Pane>
    );
  } else if (!serverMode && !isOwner && granted && server.key && !server.loading && !server.sqlMissing && !tgFunctionMissing() && tg.auth.kind === "signedOut" && !legacyLogin) {
    body = (
      <Pane>
        <Alert tone="info" title="Аккаунт workspace ещё не подключён">
          Owner подключает Telegram к workspace один раз — после этого он откроется здесь сам, без QR.
        </Alert>
        <button type="button" className="text-[12px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setLegacyLogin(true)}>
          Войти по-старому — только в этом браузере
        </button>
      </Pane>
    );
  } else {
    body = <TgLogin auth={tg.auth} lastEnd={tg.lastEnd} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 sm:px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
          <Send className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 text-sm font-semibold">
            Telegram {me && <TgConnDot conn={tg.conn} />}
          </h1>
          <p className="truncate text-[12px] text-muted-foreground">
            {me
              ? `${me.name}${me.username ? ` · @${me.username}` : ""}${me.isPremium ? " · Premium" : ""}${serverMode ? " · аккаунт workspace" : ""}`
              : server.account?.name
                ? `${server.account.name} · аккаунт workspace`
                : "Рабочий аккаунт"}
          </p>
        </div>
        {access.error && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title={access.error}>
            <Loader2 className="h-3 w-3" /> доступ не перепроверен
          </span>
        )}
        {manageButton}
        {me && !serverMode && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Выйти
          </Button>
        )}
        {serverMode && isOwner && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void disconnect()}>
            <Unplug className="h-4 w-4" /> Отключить
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
