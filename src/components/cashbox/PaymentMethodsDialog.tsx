import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentMethodsEditor } from "@/components/cashbox/PaymentMethodsEditor";

/** «Настроить способы…» из чипа оплаты — тот же редактор, что в «Настройки → Касса». */
export function PaymentMethodsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Способы оплаты</DialogTitle>
          <DialogDescription>
            Комиссия вычитается из цены или апсейла, у которых выбран способ. Остаток — «Итого» — уходит технарю как цена заказа.
          </DialogDescription>
        </DialogHeader>
        <PaymentMethodsEditor />
      </DialogContent>
    </Dialog>
  );
}
