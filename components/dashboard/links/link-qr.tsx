"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { QRCodeCanvas } from "qrcode.react";
import { useRef, useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { POPOVER_MOTION } from "@/components/ui/motion";
import { useClipboard } from "@/components/ui/use-clipboard";
import { usePopoverDismiss } from "@/components/ui/use-popover-dismiss";

const QR_SIZE = 176;

const COPY_BLOCKED = "Your browser blocked copying images. Right-click the code and save it instead.";

/** The QR code as a PNG clipboard item; the blob is passed as a promise so Safari keeps the click as the user gesture. */
function canvasImage(canvas: HTMLCanvasElement): ClipboardItem[] {
  const png = new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("empty"))), "image/png"));
  return [new ClipboardItem({ "image/png": png })];
}

/** QR code button that opens a small card with the link's code and a copy-image action. */
export function LinkQr({ url, title }: { url: string; title: string }) {
  const [open, setOpen] = useState(false);
  const { copied, failed: blocked, copy } = useClipboard();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  usePopoverDismiss(open, { root: box, trigger: button, panel: card }, () => setOpen(false));

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`QR code for ${title}`}
        title="QR code"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`grid size-8 place-items-center rounded-control transition-colors pointer-coarse:size-11 hover:bg-surface-2 hover:text-fg motion-reduce:transition-none ${open ? "bg-surface-2 text-fg" : "text-muted"} ${FOCUS_RING}`}
      >
        <Icon name="qr" className="size-4" />
      </button>
      <AnimatePresence>
        {open ? (
          <m.div
            {...POPOVER_MOTION}
            ref={card}
            role="dialog"
            aria-label={`QR code for ${title}`}
            tabIndex={-1}
            className="absolute right-0 top-full z-30 mt-2 flex w-[216px] origin-top-right flex-col gap-3 rounded-[16px] border border-line bg-surface p-3 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)] outline-none"
          >
            {/** QR codes scan only as dark modules on a light background, so this tile stays white in dark mode. */}
            <div className="grid place-items-center rounded-control bg-white p-2.5">
              <QRCodeCanvas ref={canvas} value={url} size={QR_SIZE} marginSize={0} title={`QR code for ${title}`} />
            </div>
            <ActionButton
              variant="secondary"
              size="sm"
              done={copied}
              doneLabel="Copied"
              failed={blocked}
              onClick={() => {
                const qr = canvas.current;
                if (qr) void copy(() => canvasImage(qr));
              }}
            >
              <Icon name="copy" className="size-4" />
              Copy QR image
            </ActionButton>
            <ActionError message={blocked ? COPY_BLOCKED : null} />
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
