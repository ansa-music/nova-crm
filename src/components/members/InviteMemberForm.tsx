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

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-start gap-2">
      <div className="flex-1">
        <Input placeholder="email@company.com" {...form.register("email")} />
        {form.formState.errors.email && (
          <p className="mt-1 text-xs text-destructive">{form.formState.errors.email.message}</p>
        )}
      </div>
      <Controller
        control={form.control}
        name="role"
        render={({ field }) => (
          <RoleSelect value={field.value} onChange={field.onChange} assignableRoles={["admin", "manager", "viewer"]} />
        )}
      />
      <Button type="submit" disabled={isSubmitting} className="gap-1.5">
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        Пригласить
      </Button>
    </form>
  );
}
