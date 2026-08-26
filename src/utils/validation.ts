import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "Введите email").email("Некорректный email"),
  password: z.string().min(6, "Минимум 6 символов"),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    name: z.string().min(2, "Введите имя"),
    email: z.string().min(1, "Введите email").email("Некорректный email"),
    password: z.string().min(6, "Минимум 6 символов"),
    confirmPassword: z.string().min(6, "Минимум 6 символов"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });
export type SignupFormValues = z.infer<typeof signupSchema>;

export const inviteSchema = z.object({
  email: z.string().min(1, "Введите email").email("Некорректный email"),
  role: z.enum(["admin", "manager", "viewer"]),
});
export type InviteFormValues = z.infer<typeof inviteSchema>;

export const workspaceSchema = z.object({
  name: z.string().min(2, "Минимум 2 символа").max(40, "Максимум 40 символов"),
});
export type WorkspaceFormValues = z.infer<typeof workspaceSchema>;

export const pageSchema = z.object({
  name: z.string().min(1, "Введите название").max(40, "Максимум 40 символов"),
});
export type PageFormValues = z.infer<typeof pageSchema>;

export const profileSchema = z.object({
  name: z.string().min(2, "Минимум 2 символа"),
  nickname: z.string().max(40, "Максимум 40 символов").optional(),
});
export type ProfileFormValues = z.infer<typeof profileSchema>;
