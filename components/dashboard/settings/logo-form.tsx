"use client";

import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { LogoPicker } from "@/components/dashboard/settings/logo-picker";
import { useAction } from "@/components/dashboard/use-action";
import { MerchantMark } from "@/components/ui/merchant-mark";
import { removeLogoAction, uploadLogoAction } from "@/lib/merchants/actions/account";

/** The business logo with buttons to upload a new one or remove it; the file is sent as soon as it is chosen. */
export function LogoForm({ name, logoUrl, editable }: { name: string; logoUrl: string | null; editable: boolean }) {
  const merchantId = useMerchantId();
  const upload = useAction();
  const remove = useAction();

  if (!editable) {
    return (
      <div className="flex items-start gap-4 sm:items-center">
        <MerchantMark name={name} logoUrl={logoUrl} variant="hero" />
        <p className="text-meta text-muted">{logoUrl ? "Customers see this logo on your checkout and payment-link pages." : "Without a logo, customers see your initials."}</p>
      </div>
    );
  }
  return (
    <LogoPicker
      name={name}
      logoUrl={logoUrl}
      upload={upload}
      onPick={(file) => {
        const form = new FormData();
        form.set("logo", file);
        upload.run(() => uploadLogoAction(merchantId, form));
      }}
    >
      {logoUrl ? <ConfirmAction label="Remove" confirmLabel="Remove" ariaLabel="Remove the logo" pending={remove.pending} error={remove.error} onConfirm={() => remove.run(() => removeLogoAction(merchantId))} /> : null}
    </LogoPicker>
  );
}
