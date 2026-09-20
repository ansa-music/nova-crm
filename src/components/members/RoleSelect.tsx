import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/utils/cn";
import { ALL_ROLES, ROLE_LABELS, type Role } from "@/types";

interface RoleSelectProps {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  assignableRoles?: Role[];
  /** Ширину решает вызывающий: в строке участника 128px выдавливали имя в ноль. */
  className?: string;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

export function RoleSelect({
  value,
  onChange,
  disabled,
  assignableRoles = ["teamlead", "admin", "manager", "os", "viewer"],
  className,
}: RoleSelectProps) {
  // Radix Select throws on "" / unknown values. UsersPage is lazy-loaded, so
  // that throw is caught by the app ErrorBoundary and looks like "the site broke".
  const selectValue: Role = isRole(value) ? value : "viewer";
  const items: Role[] = [];
  if (selectValue === "owner") items.push("owner");
  for (const role of [selectValue, ...assignableRoles]) {
    if (role !== "owner" && !items.includes(role) && isRole(role)) items.push(role);
  }

  return (
    <Select value={selectValue} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger className={cn("h-8 min-h-11 sm:min-h-0", className ?? "w-32")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role] ?? role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
