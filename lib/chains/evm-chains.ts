import type { Chain } from "viem";
import { abstract, arbitrum, avalanche, base, berachain, bsc, gnosis, hyperEvm, mainnet, monad, optimism, plasma, polygon, scroll, xLayer } from "viem/chains";

/** EVM networks a connected wallet can pay on; Ethereum first, as the Reown modal's default. */
export const EVM_CHAINS: [Chain, ...Chain[]] = [mainnet, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis, berachain, monad, xLayer, scroll, plasma, abstract, hyperEvm];

export const EVM_CHAIN_BY_ID = new Map(EVM_CHAINS.map((chain) => [chain.id, chain]));
