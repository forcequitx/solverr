import Link from "next/link";
import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";
import { FOCUS_RING } from "@/components/ui/focus-ring";

type Variant = "primary" | "secondary" | "strong" | "soft" | "ghost" | "danger" | "succeeded" | "failed";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-fg hover:bg-surface-2",
  /** Dark on light pages and light on dark ones, like the strong segmented look. */
  strong: "bg-fg text-bg hover:bg-fg/85",
  soft: "bg-surface-2 text-fg hover:bg-accent/10",
  ghost: "text-fg hover:bg-surface-2",
  danger: "border border-line bg-surface text-danger hover:bg-danger-bg",
  /** Outcome states an action button switches to after it runs. */
  succeeded: "bg-success-solid text-white",
  failed: "bg-danger-solid text-white",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm pointer-coarse:h-11",
  md: "h-11 px-5 text-[15px]",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className = ""): string {
  return [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-heading font-semibold transition-colors",
    `${FOCUS_RING} disabled:pointer-events-none disabled:opacity-50`,
    VARIANTS[variant],
    SIZES[size],
    className,
  ].join(" ");
}

export function Button({ variant, size, className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

/** Internal paths navigate client-side with `next/link`; external, `uri:` and new-tab links stay plain anchors. */
export function ButtonLink({ variant, size, className, href = "", ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  const classes = buttonClass(variant, size, className);
  if (href.startsWith("/") && !href.startsWith("//") && props.target !== "_blank") return <Link href={href} className={classes} {...props} />;
  return <a href={href} className={classes} {...props} />;
}
