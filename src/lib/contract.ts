import { getAddress, parseAbi, type Address, type Hex } from 'viem'

// Neither contract is source-verified; these signatures were recovered from the
// 4-byte selectors in their bytecode and cross-checked against real transactions
// and eth_call simulations, on mainnet and on the Sepolia testnet.

/**
 * L1 Priority Transactions on L1CoreMessaging, where Lighter moved them on
 * 2026-11-08 (Sepolia first). Callers always build arguments in this shape;
 * resolveL1Call() adapts them for the old ZkLighter entry points if needed.
 */
export const coreMessagingAbi = parseAbi([
  // Reduce-only market order; the price is a bound, not a limit to rest at.
  // The market index widened from uint16 to uint64 with the move.
  'function createOrder(uint48 _accountIndex, uint64 _marketIndex, uint48 _baseAmount, uint32 _price, uint8 _isAsk, uint8 _orderType)',
  'function cancelAllOrders(uint48 _accountIndex)',
  'function burnShares(uint48 _accountIndex, uint48 _publicPoolIndex, uint64 _shareAmount)',
  // routeType: 0 = perps collateral, 1 = spot balance. Amount in the asset's L2 decimals.
  'function withdraw(uint48 _accountIndex, uint16 _assetId, uint8 _routeType, uint64 _amount)',
  // Registers a Lighter API public key (40 bytes) at an API key slot.
  'function changePubKey(uint48 _accountIndex, uint8 _apiKeyIndex, bytes _pubKey)',
  'function zkLighter() view returns (address)',
])

/** What stays on ZkLighter after the move: deposits, pending balances, reads. */
export const zkLighterAbi = parseAbi([
  // Funds Lighter could not push to the wallet sit here until claimed (L1 token decimals).
  'function getPendingBalance(address _owner, uint16 _assetId) view returns (uint128)',
  'function withdrawPendingBalance(address _owner, uint16 _assetId, uint128 _amount)',
  'function addressToAccountIndex(address _address) view returns (uint48)',
])

/** Priority Transactions as ZkLighter exposed them before the move (they revert there after). */
export const legacyPriorityAbi = parseAbi([
  'function createOrder(uint48 _accountIndex, uint16 _marketIndex, uint48 _baseAmount, uint32 _price, uint8 _isAsk, uint8 _orderType)',
  'function cancelAllOrders(uint48 _accountIndex)',
  'function burnShares(uint48 _accountIndex, uint48 _publicPoolIndex, uint64 _shareAmount)',
  'function withdraw(uint48 _accountIndex, uint16 _assetId, uint8 _routeType, uint64 _amount)',
  'function changePubKey(uint48 _accountIndex, uint8 _apiKeyIndex, bytes _pubKey)',
])

/** Every L1 write the page can request, in the post-move argument shapes. */
export const l1Abi = [...coreMessagingAbi, ...zkLighterAbi] as const

export const PRIORITY_FUNCTIONS: ReadonlySet<string> = new Set([
  'createOrder',
  'cancelAllOrders',
  'burnShares',
  'withdraw',
  'changePubKey',
])

/** Where Priority Transactions go: L1CoreMessaging, or ZkLighter before the move. */
export type PriorityRoute = 'core' | 'legacy'

export interface L1Addresses {
  zkLighter: Address
  /** Absent on deployments that never moved the Priority Transactions off ZkLighter. */
  coreMessaging?: Address
}

/** Picks the contract, ABI and argument encoding for one L1 write. */
export function resolveL1Call(
  functionName: string,
  args: readonly unknown[],
  route: PriorityRoute,
  addresses: L1Addresses,
) {
  if (!PRIORITY_FUNCTIONS.has(functionName)) {
    return { address: addresses.zkLighter, abi: zkLighterAbi, functionName, args } as const
  }
  if (route === 'core') {
    if (!addresses.coreMessaging) throw new Error('This Lighter deployment has no L1CoreMessaging contract')
    return { address: addresses.coreMessaging, abi: coreMessagingAbi, functionName, args } as const
  }
  const legacyArgs = functionName === 'createOrder' ? [args[0], Number(args[1]), ...args.slice(2)] : args
  return { address: addresses.zkLighter, abi: legacyPriorityAbi, functionName, args: legacyArgs } as const
}

/** EIP-1967 implementation slot: keccak256('eip1967.proxy.implementation') - 1. */
export const EIP1967_IMPLEMENTATION_SLOT: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

/**
 * Priority Transactions stay on ZkLighter only while its proxy still points at
 * the implementation that had them; any other implementation means the move
 * happened. Without a readable slot, fall back to the announced cut-over time.
 */
export function priorityRouteFor(
  implementationSlot: Hex | undefined,
  legacyImplementation: Address,
  cutoverMs: number,
  nowMs: number,
): PriorityRoute {
  if (implementationSlot && BigInt(implementationSlot) !== 0n) {
    const impl = getAddress(`0x${implementationSlot.slice(-40)}`)
    return impl === getAddress(legacyImplementation) ? 'legacy' : 'core'
  }
  return nowMs >= cutoverMs ? 'core' : 'legacy'
}

export const ORDER_TYPE_MARKET = 1
export const ORDER_SIDE_ASK = 1
export const ORDER_SIDE_BID = 0
