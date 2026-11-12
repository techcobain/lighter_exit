import { useSyncExternalStore } from 'react'

import { DEFAULT_CONTRACT_SCOPE, FORCE_L1_OPTION } from '../lib/config'
import { alwaysContract, type ContractScope } from '../lib/route'

// Module-level so a tester's choice survives switching between Lighter
// deployments (which remounts the providers). It is gone on reload, on purpose.
let scope: ContractScope = DEFAULT_CONTRACT_SCOPE
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = (): ContractScope => (FORCE_L1_OPTION ? scope : DEFAULT_CONTRACT_SCOPE)

/** Only has an effect in builds that show the testing switch. */
export function setContractScope(next: ContractScope): void {
  if (scope === next) return
  scope = next
  for (const listener of [...listeners]) listener()
}

/** Which actions always go to the contract. Fixed at the default unless the build shows the testing switch. */
export function useContractScope(): ContractScope {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** True when cancelling orders and closing positions are sent to the contract rather than the API. */
export function useTradingOnContract(): boolean {
  return alwaysContract(useContractScope(), true)
}
