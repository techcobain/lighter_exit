// Values shared by every Lighter deployment. What differs between them (API,
// contract, chain ids, explorers) lives in environments.ts.

const env = import.meta.env

/** API key slot this page registers for L2-signed actions (unstaking). */
export const API_KEY_INDEX = Number((env.VITE_API_KEY_INDEX as string | undefined)?.trim() || 250)

export const WALLETCONNECT_PROJECT_ID =
  (env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || undefined

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

/**
 * Testing aid, off unless the build sets VITE_FORCE_L1_OPTION. When on, the
 * page shows a switch that sends actions to the contract as if the API had
 * refused the account: either only the trading ones (closing positions,
 * cancelling orders) or every action with a contract route.
 */
export const FORCE_L1_OPTION = /^(1|true|yes|on)$/i.test((env.VITE_FORCE_L1_OPTION as string | undefined)?.trim() ?? '')
