/** Splits text into groups of about 4 characters, the leftover ones spread over the first groups, so every character is kept. */
export function groupsOfFour(text: string): string[] {
  const count = Math.max(1, Math.floor(text.length / 4));
  const base = Math.floor(text.length / count);
  const extra = text.length % count;
  const groups: string[] = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    groups.push(text.slice(start, start + size));
    start += size;
  }
  return groups.filter(Boolean);
}
