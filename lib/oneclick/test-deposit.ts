/** Test deposit addresses start with this and are invalid on every chain, so real funds can never be sent to them. */
export const TEST_DEPOSIT_PREFIX = "TEST-";

export function isTestDepositAddress(address: string): boolean {
  return address.startsWith(TEST_DEPOSIT_PREFIX);
}
