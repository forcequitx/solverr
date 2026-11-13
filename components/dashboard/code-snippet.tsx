import { CopyAction } from "@/components/dashboard/copy-buttons";
import { Icon } from "@/components/ui/icon";

/** Titled block of code with a copy button; `minHeight` keeps the block one size while its code changes. */
export function CodeSnippet({ title, code, minHeight = "" }: { title: string; code: string; minHeight?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm font-medium">{title}</p>
        <CopyAction text={code} variant="secondary" size="sm">
          <Icon name="copy" className="size-4" />
          Copy
        </CopyAction>
      </div>
      <pre className={`whitespace-pre-wrap rounded-[14px] border border-line bg-surface-2 p-4 font-mono text-meta leading-relaxed text-fg [overflow-wrap:anywhere] ${minHeight}`}>{code}</pre>
    </div>
  );
}
