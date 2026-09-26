import { Link } from "react-router";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  LayoutGrid,
  MessageSquare,
  PackageCheck,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";

/**
 * Публичная страница продукта (`/welcome`, SaaS этап 3) — первое, что видит
 * человек без входа. Нейтральный текст: подходит любой компании, где
 * менеджеры продаж передают заказы исполнителям. Ведёт на вход и на
 * регистрацию компании; вошедшему — сразу в приложение.
 */
const FEATURES = [
  {
    icon: LayoutGrid,
    title: "Столы вместо таблиц в облаке",
    text: "У каждого исполнителя свой стол: заказы, статусы, суммы, файлы. Владелец видит сводку по всем.",
  },
  {
    icon: PackageCheck,
    title: "Заказы от продаж к исполнению",
    text: "Менеджер заводит заказ у себя — он сам приезжает исполнителю. Статус, смена исполнителя, дедлайн — синхронно.",
  },
  {
    icon: Users,
    title: "Роли и доступ",
    text: "Owner, Тимлид, менеджеры, исполнители. Кто что видит и правит — решает компания, а держит база.",
  },
  {
    icon: CalendarDays,
    title: "График смен",
    text: "Неделя и месяц как в таблице, выходные и смены в один клик, вставка из Google Sheets.",
  },
  {
    icon: BarChart3,
    title: "Дашборд, рейтинги, отчёты",
    text: "Касса и KPI по людям, премии за места, отчёты за прошлые периоды — считаются сами.",
  },
  {
    icon: MessageSquare,
    title: "Чат и Telegram внутри",
    text: "Общий чат, личные сообщения, комментарии к заказу и рабочий Telegram-аккаунт прямо в системе.",
  },
  {
    icon: Smartphone,
    title: "С телефона — как с компьютера",
    text: "Карточки заказов, звук и всплывашка о новом заказе, нижняя панель под палец.",
  },
  {
    icon: ShieldCheck,
    title: "Данные компании отделены",
    text: "Каждая компания — своё пространство, свои настройки, регион и валюта. Полная копия данных — одной кнопкой.",
  },
];

const STEPS = [
  { n: "1", title: "Оставьте заявку", text: "Название компании и как с вами связаться. Или введите код приглашения, если он у вас уже есть." },
  { n: "2", title: "Заведите компанию", text: "Одна минута: название, страна и валюта. Вы — Owner, пробный период включён." },
  { n: "3", title: "Пригласите людей", text: "Ссылка-приглашение сотрудникам, роли и столы — и можно работать." },
];

export default function LandingPage() {
  const { isAuthenticated } = useAppBootstrap();
  const primaryTo = isAuthenticated ? "/" : "/start";

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <span className="font-serif text-xl font-light tracking-wide">
          <span className="text-primary">N</span>ova CRM
        </span>
        <nav className="flex items-center gap-2">
          {isAuthenticated ? (
            <Button asChild size="sm">
              <Link to="/">В приложение</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/login">Войти</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/start">Подключить компанию</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-20">
          <p className="eyebrow mb-3 text-primary">CRM для команд продаж и исполнителей</p>
          <h1 className="max-w-3xl font-serif text-4xl font-light leading-tight sm:text-5xl">
            Заказы, люди и деньги — в одном рабочем пространстве компании
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            Nova заменяет разрозненные таблицы: менеджер ведёт заказ у себя, исполнитель получает его на свой стол, руководитель
            видит загрузку, кассу и график — без пересылки файлов и ручных сводок.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="min-h-11">
              <Link to={primaryTo}>
                {isAuthenticated ? "Открыть приложение" : "Подключить компанию"} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {!isAuthenticated ? (
              <Button asChild variant="outline" className="min-h-11">
                <Link to="/login">У меня уже есть доступ</Link>
              </Button>
            ) : null}
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground">Пробный период 14 дней · без карты · данные компании отделены от других</p>
        </section>

        <section className="border-y border-border bg-card/60">
          <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-card p-4">
                <f.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-[14px] font-medium">{f.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="eyebrow mb-2 text-primary">Как подключиться</p>
          <h2 className="font-serif text-3xl font-light">Три шага — и команда работает</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl border border-border p-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/12 font-mono text-[13px] text-primary">{s.n}</span>
                <h3 className="mt-3 text-[14px] font-medium">{s.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-border bg-card/60">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="eyebrow mb-2 text-primary">Стоимость</p>
              <h2 className="font-serif text-2xl font-light">Пробный период бесплатно, дальше — по числу мест</h2>
              <p className="mt-2 max-w-xl text-[13.5px] text-muted-foreground">
                Тариф зависит от размера команды и согласуется при подключении. Приостановка и продление — без потери данных.
              </p>
            </div>
            <Button asChild className="min-h-11 shrink-0">
              <Link to={primaryTo}>
                {isAuthenticated ? "Открыть приложение" : "Оставить заявку"} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12px] text-muted-foreground sm:px-6">
        <span>© Nova CRM, 2026</span>
        <nav className="flex flex-wrap gap-4">
          <Link to="/terms" className="hover:text-foreground">Условия</Link>
          <Link to="/privacy" className="hover:text-foreground">Данные и конфиденциальность</Link>
          <a href="mailto:nurpro2005@gmail.com" className="hover:text-foreground">Написать нам</a>
        </nav>
      </footer>
    </div>
  );
}
