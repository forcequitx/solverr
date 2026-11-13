/** How Solverr introduces itself to wallets in the Reown and WalletConnect connection prompts. */
export function walletAppMetadata() {
  const origin = window.location.origin;
  return { name: "Solverr", description: "Pay with the coin you already hold", url: origin, icons: [`${origin}/icon.svg`] };
}
