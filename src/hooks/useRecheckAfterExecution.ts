import { useEffect, useRef } from 'react'

import { RECHECK_AFTER_MS } from '../lib/settle'

/**
 * Reads the data again a few seconds after an action executed. The read made
 * right at execution can still be the old state; this later one is what lets
 * awaitingRefresh() release the item (or show that it is really gone).
 */
export function useRecheckAfterExecution(executedAt: number, recheck: () => void): void {
  const latest = useRef(recheck)
  useEffect(() => {
    latest.current = recheck
  })
  useEffect(() => {
    if (!executedAt) return
    const wait = executedAt + RECHECK_AFTER_MS - Date.now()
    if (wait <= 0) return
    const timer = setTimeout(() => latest.current(), wait)
    return () => clearTimeout(timer)
  }, [executedAt])
}
