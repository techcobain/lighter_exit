// When an action may be sent a second time. Repeats matter most on the
// contract route, where every send costs gas, so the rule is the same for
// both routes: nothing is re-sent on stale information.

/** How long after "executed" a read must have been made before it is trusted to show the result. */
export const SETTLE_MS = 5_000
/** When to read again after an action executes, so the lock below lifts by itself. */
export const RECHECK_AFTER_MS = SETTLE_MS + 1_000

interface Settling {
  status: string
  updatedAt: number
}

/**
 * True while an executed action's effect may not be visible yet: the data on
 * screen was read before, or only just after, Lighter reported it executed.
 * Until a later read arrives the item stays locked. If that later read still
 * lists it (a partly filled close, say), it can be sent again.
 */
export function awaitingRefresh(state: Settling | undefined, dataUpdatedAt: number): boolean {
  return state?.status === 'executed' && dataUpdatedAt < state.updatedAt + SETTLE_MS
}

/** Latest "executed" time among some actions, or 0 when none has executed. */
export function lastExecutedAt(states: (Settling | undefined)[]): number {
  return states.reduce((latest, s) => (s?.status === 'executed' ? Math.max(latest, s.updatedAt) : latest), 0)
}
