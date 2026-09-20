import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { RoleSelect } from "@/components/members/RoleSelect";
import { inviteSchema, type InviteFormValues } from "@/utils/validation";
import { inviteMember } from "@/services/memberService";
import { refreshWorkspaceMembers } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";

export function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
  const { profile } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "manager" },
  });

  async function onSubmit(values: InviteFormValues) {
    if (!profile) return;
    setIsSubmitting(true);
    try {
      await inviteMember(workspaceId, values.email, values.role, profile.uid);
      await refreshWorkspaceMembers(workspaceId);
      toast.success(`Приглашение для ${values.email} создано`);
      form.reset({ email: "", role: "manager" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось пригласить пользователя");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Форма живёт в узкой правой панели (max-w-md), поэтому колонка — всегда,
  // без sm:flex-row: брейкпойнты Tailwind меряют ВЬЮПОРТ, и на широком экране
  // строка внутри панели давала поле email шириной 130px.
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-2">
      {/* min-w-0 обязателен: без него flex-элемент не сжимается меньше
          своего контента, и в узкой колонке поле email превращалось в 26px. */}
      <div className="min-w-0 flex-1">
        <Input placeholder="email@company.com" {...form.register("email")} />
        {form.formState.errors.email && (
          <p className="mt-1 text-xs text-destructive">{form.formState.errors.email.message}</p>
        )}
      </div>
      <div className="flex gap-2">
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <RoleSelect value={field.value} onChange={field.onChange} assignableRoles={["teamlead", "admin", "manager", "os", "viewer"]} />
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="min-h-11 flex-1 gap-1.5 sm:min-h-0 sm:flex-none">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Пригласить
        </Button>
      </div>
    </form>
  );
}
