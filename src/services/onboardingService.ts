import { createPage, addRow } from "@/services/pageService";
import type { PageColumn, StatusOption } from "@/types";

const CLIENT_STATUS: StatusOption[] = [
  { value: "success", label: "Успешно", color: "142 71% 45%" },
  { value: "waiting", label: "Ждём", color: "38 92% 50%" },
  { value: "in_progress", label: "В работе", color: "0 72% 51%" },
  { value: "done", label: "Готово", color: "142 71% 45%" },
  { value: "cancelled", label: "Отмена", color: "240 4% 60%" },
];

const PROJECT_STATUS: StatusOption[] = [
  { value: "planning", label: "Планирование", color: "217 91% 60%" },
  { value: "active", label: "В работе", color: "38 92% 50%" },
  { value: "done", label: "Готово", color: "142 71% 45%" },
  { value: "blocked", label: "Заблокировано", color: "0 72% 51%" },
];

const EMPLOYEE_STATUS: StatusOption[] = [
  { value: "active", label: "Активен", color: "142 71% 45%" },
  { value: "vacation", label: "В отпуске", color: "38 92% 50%" },
  { value: "inactive", label: "Неактивен", color: "240 4% 60%" },
];

function col(
  key: string,
  label: string,
  type: PageColumn["type"],
  width = 160,
  statusOptions?: StatusOption[]
): Omit<PageColumn, "id"> {
  return { key, label, type, width, order: 0, statusOptions };
}

export async function seedDefaultWorkspacePages(workspaceId: string, createdBy: string) {
  const clientsPage = await createPage({
    workspaceId,
    name: "Клиенты",
    icon: "Users",
    color: "243 75% 59%",
    createdBy,
    order: 0,
    allowedUsers: [createdBy],
    columns: [
      col("name", "Имя клиента", "text", 200),
      col("phone", "Телефон", "phone", 150),
      col("amount", "Сумма", "currency", 130),
      col("status", "Статус", "status", 140, CLIENT_STATUS),
      col("price", "Цена", "currency", 140),
      col("note", "Примечание", "text", 220),
    ],
  });

  await createPage({
    workspaceId,
    name: "Проекты",
    icon: "Briefcase",
    color: "271 81% 56%",
    createdBy,
    order: 1,
    allowedUsers: [createdBy],
    columns: [
      col("name", "Проект", "text", 220),
      col("client", "Клиент", "text", 160),
      col("deadline", "Дедлайн", "date", 140),
      col("status", "Статус", "status", 150, PROJECT_STATUS),
      col("budget", "Бюджет", "currency", 130),
    ],
  });

  await createPage({
    workspaceId,
    name: "Финансы",
    icon: "Wallet",
    color: "152 60% 40%",
    createdBy,
    order: 2,
    allowedUsers: [createdBy],
    columns: [
      col("description", "Описание", "text", 220),
      col("category", "Категория", "text", 150),
      col("amount", "Сумма", "currency", 140),
      col("type", "Тип", "status", 130, [
        { value: "income", label: "Доход", color: "142 71% 45%" },
        { value: "expense", label: "Расход", color: "0 72% 51%" },
      ]),
      col("date", "Дата", "date", 140),
    ],
  });

  await createPage({
    workspaceId,
    name: "Сотрудники",
    icon: "UserCog",
    color: "199 89% 48%",
    createdBy,
    order: 3,
    allowedUsers: [createdBy],
    columns: [
      col("name", "Имя", "text", 200),
      col("position", "Должность", "text", 180),
      col("email", "Email", "email", 200),
      col("phone", "Телефон", "phone", 150),
      col("status", "Статус", "status", 140, EMPLOYEE_STATUS),
    ],
  });

  const demoClients: Array<[string, string, string, string]> = [
    ["Роман Ким", "+7 705 558 24 25", "150000", "success"],
    ["Бексултан Ахметов", "+7 701 564 20 89", "60000", "success"],
    ["Анжелика Ли", "+7 705 910 26 86", "121984", "success"],
    ["Санжар Тулеген", "+7 701 479 39 93", "141500", "success"],
    ["Юлия Смирнова", "+7 701 514 14 24", "134000", "waiting"],
    ["Куба Ержанов", "+7 701 224 34 12", "315000", "waiting"],
    ["Маржан Байжанова", "", "125000", "in_progress"],
  ];

  await Promise.all(
    demoClients.map((c, i) =>
      addRow(
        workspaceId,
        clientsPage.id,
        { name: c[0], phone: c[1], amount: c[2], status: c[3], note: "" },
        i
      )
    )
  );

  return clientsPage;
}
