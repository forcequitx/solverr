import { CopyIconButton } from "@/components/dashboard/copy-buttons";
import { MiddleEllipsis } from "@/components/dashboard/detail/middle-ellipsis";

/** Long value such as an ID or address in monospace, cut in the middle when it does not fit, with a copy button named by `ariaLabel`. */
export function CopyableValue({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <MiddleEllipsis value={value} className="font-mono text-meta" />
      <CopyIconButton text={value} ariaLabel={ariaLabel} />
    </span>
  );
}
