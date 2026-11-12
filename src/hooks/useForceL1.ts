import { useSyncExternalStore } from 'react'

import { FORCE_L1_OPTION } from '../lib/config'

import type { ForceL1Scope } from '../lib/route'

// Module-level so the choice survives switching between Lighter deployments
// (which remounts the providers). It is gone on reload, on purpose.
let scope: ForceL1Scope = 'off'
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = (): ForceL1Scope => (FORCE_L1_OPTION ? scope : 'off')

export function setForceL1Scope(next: ForceL1Scope): void {
  if (scope === next) return
  scope = next
  for (const listener of [...listeners]) listener()
}

/** Which actions the tester asked to send to the contract; always 'off' unless the build enables the option. */
export function useForceL1Scope(): ForceL1Scope {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
