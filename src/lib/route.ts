// Which way one exit action is sent. Kept free of React so it can be tested.

export interface RouteInput {
  /** 'l1' when the user opted out of registering a key (contract-only mode). */
  mode: 'api' | 'l1'
  /** Testing switch: send to the contract whenever the action has a contract route. */
  forceL1: boolean
  /** The action can be sent as an API-signed L2 transaction. */
  hasL2: boolean
  /** The action has a contract route. */
  hasL1: boolean
  /** The account's signing key is registered. */
  keyReady: boolean
}

/** Testing switch: which actions are sent to the contract even though the API would take them. */
export type ForceL1Scope = 'off' | 'trading' | 'all'

/** Whether the testing switch claims this action. `trading` marks the ones that place or cancel orders. */
export function forcesL1(scope: ForceL1Scope, trading: boolean): boolean {
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
