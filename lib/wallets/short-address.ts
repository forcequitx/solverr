/** A long wallet address as its first `head` and last `tail` characters ("0x1a2b…9f0e" by default); short addresses stay whole. */
export function shortAddress(address: string, head = 6, tail = 4): string {
  return address.length > 16 ? `${address.slice(0, head)}…${address.slice(-tail)}` : address;
}
