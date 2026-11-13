/** Near-black or white, whichever reads better on the hex background color. */
export function textOn(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#0a0a0a" : "#ffffff";
}
