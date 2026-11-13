const METHOD_COLORS: Record<string, string> = {
  get: "bg-success-bg text-success",
  post: "bg-accent/15 text-accent-text",
  put: "bg-warn-bg text-warn",
  patch: "bg-warn-bg text-warn",
  delete: "bg-danger-bg text-danger",
};

/** HTTP method pill for API reference links. */
export function MethodBadge({ method }: { method: string }) {
  const colors = METHOD_COLORS[method.toLowerCase()] ?? "bg-surface-2 text-muted";
  return (
    <span className={`inline-flex w-[42px] shrink-0 justify-center rounded-[6px] py-0.5 text-[10px] font-bold uppercase leading-4 tracking-wide ${colors}`}>
      {method}
    </span>
  );
}
