import { http, createConfig } from 'wagmi'
import { mainnet, robinhood } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

import { WALLETCONNECT_PROJECT_ID } from './lib/config'
import { ENVIRONMENTS } from './lib/environments'

// Wallets announce themselves through EIP-6963; wagmi turns each into its own
// connector. The bare injected() connector is a fallback for wallets that
// only expose window.ethereum, and is hidden in the UI when better options exist.
export const wagmiConfig = createConfig({
  // One L1 per Lighter deployment: Ethereum for Lighter, Robinhood Chain for Lighter RH.
  chains: [mainnet, robinhood],
  transports: {
    [mainnet.id]: http(ENVIRONMENTS.mainnet.rpcUrl),
    [robinhood.id]: http(ENVIRONMENTS.rh.rpcUrl),
  },
  connectors: [
    injected(),
    ...(WALLETCONNECT_PROJECT_ID
      ? [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID, showQrModal: true })]
      : []),
  ],
})
