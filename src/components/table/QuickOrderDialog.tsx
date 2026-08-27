import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QuickOrderInput } from "@/utils/quickOrder";

const EMPTY: QuickOrderInput = {
  client: "",
  number: "",
  os: "",
  check: "",
  persons: "",
  minutes: "",
};

export function QuickOrderDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: QuickOrderInput) => Promise<void>;
}) {
  const [form, setForm] = useState<QuickOrderInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      const t = window.setTimeout(() => clientRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const client = form.client.trim();
  const check = form.check.trim();
  const canSave = Boolean(client && check) && !saving;

  function setField<K extends keyof QuickOrderInput>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSubmit(form);
      setForm(EMPTY);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-3 p-4">
        <DialogHeader>
          <DialogTitle>Заказ</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="qo-client">Клиент</Label>
            <Input
              id="qo-client"
              ref={clientRef}
              value={form.client}
              onChange={(e) => setField("client", e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="qo-number">Номер</Label>
              <Input
                id="qo-number"
                value={form.number}
                onChange={(e) => setField("number", e.target.value)}
                autoComplete="off"
                inputMode="tel"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="qo-os">ОС</Label>
              <Input
                id="qo-os"
                value={form.os}
                onChange={(e) => setField("os", e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="qo-check">Чек</Label>
            <Input
              id="qo-check"
              value={form.check}
              onChange={(e) => setField("check", e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="qo-persons">Перс</Label>
              <Input
                id="qo-persons"
                value={form.persons}
                onChange={(e) => setField("persons", e.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="qo-minutes">Минуты</Label>
              <Input
                id="qo-minutes"
                value={form.minutes}
                onChange={(e) => setField("minutes", e.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter className="mt-1">
            <Button type="submit" disabled={!canSave} className="h-9">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              В стол
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
