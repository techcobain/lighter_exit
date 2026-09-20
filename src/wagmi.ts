import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

import { ETH_RPC_URL, WALLETCONNECT_PROJECT_ID } from './lib/config'

// Wallets announce themselves through EIP-6963; wagmi turns each into its own
// connector. The bare injected() connector is a fallback for wallets that
// only expose window.ethereum, and is hidden in the UI when better options exist.
export const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http(ETH_RPC_URL) },
  connectors: [
    injected(),
    ...(WALLETCONNECT_PROJECT_ID
      ? [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID, showQrModal: true })]
      : []),
  ],
})

/**
 * Wallets that inject an EVM provider but sign or broadcast unreliably against
 * this contract. Matched against connector id, rdns and name.
 */
const BLOCKED_WALLETS = /phantom|solflare|backpack|keplr|glow|magic ?eden/i

export function isSupportedConnector(c: { id: string; name: string; rdns?: string | readonly string[] }): boolean {
  const rdns = Array.isArray(c.rdns) ? c.rdns.join(' ') : ((c.rdns as string | undefined) ?? '')
  return !BLOCKED_WALLETS.test(`${c.id} ${c.name} ${rdns}`)
}
