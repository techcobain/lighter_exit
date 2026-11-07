import { getAddress } from 'viem'

const env = import.meta.env

/** Lighter's zkLighter contract on Ethereum mainnet (EIP-1967 proxy). */
export const LIGHTER_CONTRACT = getAddress(
  (env.VITE_LIGHTER_CONTRACT as string | undefined)?.trim() ||
    '0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7',
)

/**
 * L1CoreMessaging proxy on Ethereum mainnet, which takes over the Priority
 * Transactions (createOrder, cancelAllOrders, withdraw, changePubKey,
 * burnShares) from ZkLighter. Implementation 0x15c3FEA3…; never call that directly.
 */
export const L1_CORE_MESSAGING_CONTRACT = getAddress(
  (env.VITE_L1_CORE_MESSAGING_CONTRACT as string | undefined)?.trim() ||
    '0x183ef7195d443a3dA7EC1d7003BaCa1ff490757D',
)

/**
 * The ZkLighter implementation that still exposes the Priority Transactions.
 * While the proxy points here they go to ZkLighter, otherwise to L1CoreMessaging.
 */
export const LEGACY_ZKLIGHTER_IMPL = getAddress(
  (env.VITE_LEGACY_ZKLIGHTER_IMPL as string | undefined)?.trim() ||
    '0x45a06c03eedc123c34a66bad4691d7ddb26a80a6',
)

/** Announced move of the Priority Transactions; only used if the proxy slot cannot be read. */
export const PRIORITY_CUTOVER_MS = Date.parse('2026-11-08T13:00:00Z')

/** 'auto' (default) follows the ZkLighter upgrade; 'core' or 'legacy' force a route. */
export const PRIORITY_ROUTE_OVERRIDE = ((env.VITE_PRIORITY_ROUTE as string | undefined)?.trim() || 'auto') as
  | 'auto'
  | 'core'
  | 'legacy'

/** Lighter L2 chain id used when hashing L2 transactions (304 = mainnet). */
export const LIGHTER_CHAIN_ID = Number(
  (env.VITE_LIGHTER_CHAIN_ID as string | undefined)?.trim() || 304,
)

/** API key slot this page registers for L2-signed actions (unstaking). */
export const API_KEY_INDEX = Number((env.VITE_API_KEY_INDEX as string | undefined)?.trim() || 250)

/** Base URL for the Lighter REST API, without the /api/v1 suffix. */
export const LIGHTER_API_BASE = (
  (env.VITE_LIGHTER_API_BASE as string | undefined)?.trim() || '/lighter-api'
).replace(/\/$/, '')

export const ETH_RPC_URL = (env.VITE_ETH_RPC_URL as string | undefined)?.trim() || undefined

export const WALLETCONNECT_PROJECT_ID =
  (env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || undefined

export const ETHERSCAN_TX = 'https://etherscan.io/tx/'

/** Lighter's own explorer for L2 transactions. */
export const LIGHTER_EXPLORER_TX = 'https://scan.lighter.xyz/tx/'

/** Unstaking period announced by Lighter for the staking pool. */
export const UNSTAKE_PERIOD_DAYS = 3

/** Typical time between an L1 transaction confirming and Lighter executing it. */
export const L1_TO_L2_TYPICAL_SECONDS = 120

/** Give up tracking an L1 transaction on L2 after this long. */
export const L1_TRACK_TIMEOUT_MS = 15 * 60 * 1000

/** Route types accepted by withdraw(): 0 = perps collateral, 1 = spot balance. */
export const ROUTE_PERP = 0
export const ROUTE_SPOT = 1

/** Lighter account types as returned by the account API. */
export const ACCOUNT_TYPE = {
  MASTER: 0,
  SUB: 1,
  PUBLIC_POOL: 2,
  LLP: 3,
  STAKING_POOL: 4,
} as const

/** L2 transaction types (types/txtypes/constants.go in lighter-go). */
export const TX_TYPE = {
  CHANGE_PUB_KEY: 8,
  UPDATE_PUBLIC_POOL: 11,
  TRANSFER: 12,
  WITHDRAW: 13,
  CREATE_ORDER: 14,
  CANCEL_ALL_ORDERS: 16,
  BURN_SHARES: 19,
  UNSTAKE_ASSETS: 36,
} as const

/** Public pool status values. */
export const POOL_STATUS = { ACTIVE: 0, FROZEN: 1 } as const

/**
 * API error codes that mean "this account may not use the API for this", in
 * which case the same action is sent through the Ethereum contract instead.
 * 52001: blacklist blocks the action. 23100: permission forbidden.
 */
export const RESTRICTION_ERROR_CODES: ReadonlySet<number> = new Set([52001, 23100])
