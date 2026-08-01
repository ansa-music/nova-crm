import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLE_LABELS, type Role } from "@/types";

interface RoleSelectProps {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  assignableRoles?: Role[];
}

export function RoleSelect({ value, onChange, disabled, assignableRoles = ["admin", "manager", "viewer"] }: RoleSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger className="h-8 w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {value === "owner" && <SelectItem value="owner">{ROLE_LABELS.owner}</SelectItem>}
        {assignableRoles.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
