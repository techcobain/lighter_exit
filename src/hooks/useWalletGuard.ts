import { mainnet } from 'wagmi/chains'
import { useAccount } from 'wagmi'

import { isPreview } from '../dev/preview'

/**
 * Whether the connected wallet is allowed to act on a given Lighter account:
 * it must be the account's L1 owner and sit on Ethereum mainnet.
 */
export function useWalletGuard(ownerAddress: string | undefined) {
  const { address, chainId, isConnected } = useAccount()
  if (isPreview) return { ready: true, reason: null }
  const owner = ownerAddress?.toLowerCase()
  const connected = address?.toLowerCase()
  if (!isConnected || !connected) return { ready: false, reason: 'Connect the wallet that owns this account to act.' }
  if (owner && connected !== owner) {
    return { ready: false, reason: 'Connected wallet is not the owner of this account.' }
  }
  if (chainId !== mainnet.id) {
    return { ready: false, reason: 'Your wallet will be asked to switch to Ethereum mainnet.', wrongChain: true }
  }
  return { ready: true, reason: null }
}
