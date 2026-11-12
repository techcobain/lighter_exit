// Which way one exit action is sent. Kept free of React so it can be tested.

export interface RouteInput {
  /** 'l1' when the user opted out of registering a key (contract-only mode). */
  mode: 'api' | 'l1'
  /** This action always goes to the contract when it has a contract route (see alwaysContract). */
  forceL1: boolean
  /** The action can be sent as an API-signed L2 transaction. */
  hasL2: boolean
  /** The action has a contract route. */
  hasL1: boolean
  /** The account's signing key is registered. */
  keyReady: boolean
}

/**
 * Which actions are always sent to the contract, even though the API would take them:
 * none of them (API first for everything), the trading ones, or all of them.
 */
export type ContractScope = 'none' | 'trading' | 'all'

/** Whether the scope sends this action to the contract. `trading` marks the ones that place or cancel orders. */
export function alwaysContract(scope: ContractScope, trading: boolean): boolean {
  return scope === 'all' || (scope === 'trading' && trading)
}

export type Route =
  /** API first; the contract only if the API refuses the account. */
  | 'api'
  | 'l1'
  /** API-only action, and the key is registered but the API is switched off. */
  | 'api-only'
  /** API-only action, and no key is registered yet. */
  | 'needs-key'

export function chooseRoute({ mode, forceL1, hasL2, hasL1, keyReady }: RouteInput): Route {
  const apiUsable = mode === 'api' && hasL2 && keyReady
  if (apiUsable && !(forceL1 && hasL1)) return 'api'
  if (hasL1) return 'l1'
  return keyReady ? 'api-only' : 'needs-key'
}
