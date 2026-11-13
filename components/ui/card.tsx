import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`relative rounded-card border border-line bg-surface shadow-card ${className}`} {...props} />;
}
