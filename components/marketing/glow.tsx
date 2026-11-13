/** Soft blurred glow in the brand blues, cyan and lime; the parent positions and sizes it with `className`. `wide` blurs more, for a large faint wash. */
export function Glow({ className = "", wide = false }: { className?: string; wide?: boolean }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute ${className}`}>
      <div className={`absolute inset-0 rounded-full ${wide ? "blur-[120px]" : "blur-[70px]"} [background:conic-gradient(var(--chart-2),var(--accent),var(--chart-3),var(--logo-bottom),var(--chart-2))]`} />
      <div className={`absolute inset-[12.5%] rounded-full ${wide ? "blur-[70px]" : "blur-[32px]"} [background:conic-gradient(from_180deg,var(--logo-bottom),var(--chart-3),var(--accent),var(--logo-bottom))]`} />
    </div>
  );
}
