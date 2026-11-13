"use client";

import { useRef, useState, type ReactNode } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { MerchantMark } from "@/components/ui/merchant-mark";
import { LOGO_TOO_LARGE, LOGO_UPLOAD_TYPES, MAX_LOGO_UPLOAD_BYTES } from "@/lib/merchants/logo-upload";

/** The business mark with a button that opens the file chooser; a file over the upload limit is refused here and never reaches `onPick`. */
export function LogoPicker({
  name,
  logoUrl,
  onPick,
  upload,
  children,
}: {
  name: string;
  logoUrl: string | null;
  onPick: (file: File) => void;
  /** State of the upload a chosen file starts at once; without it the button only picks the file. */
  upload?: { pending: boolean; done: boolean; failed: boolean; error: string | null };
  /** Buttons shown beside the upload button, such as Remove. */
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [tooLarge, setTooLarge] = useState(false);

  return (
    <div className="flex items-start gap-4 sm:items-center">
      <MerchantMark name={name} logoUrl={logoUrl} variant="hero" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            variant="secondary"
            size="sm"
            pending={upload?.pending}
            done={upload?.done}
            doneLabel="Uploaded"
            failed={upload?.failed || tooLarge}
            onClick={() => input.current?.click()}
          >
            {logoUrl ? "Replace logo" : "Upload logo"}
          </ActionButton>
          {children}
        </div>
        <p className="text-meta text-muted">
          Upload a PNG, JPEG or WebP image of up to 800 KB; square logos look best.{" "}
          {logoUrl ? "Customers see this logo on your checkout and payment-link pages." : "Without a logo, customers see your initials."}
        </p>
        <ActionError message={tooLarge ? LOGO_TOO_LARGE : (upload?.error ?? null)} />
      </div>
      <input
        ref={input}
        type="file"
        accept={LOGO_UPLOAD_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          /** Clearing the input lets the same file be chosen again after a failed upload. */
          event.target.value = "";
          if (!file) return;
          /** Larger files would be cut off by the 1 MB request limit before the server could explain why. */
          setTooLarge(file.size > MAX_LOGO_UPLOAD_BYTES);
          if (file.size <= MAX_LOGO_UPLOAD_BYTES) onPick(file);
        }}
      />
    </div>
  );
}
