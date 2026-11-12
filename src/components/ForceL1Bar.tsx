import { isInFlight, useActions } from '../hooks/useActions'
import { useEnvironment } from '../hooks/useEnvironment'
import { setForceL1Scope, useForceL1Scope } from '../hooks/useForceL1'
import cn from '../lib/cn'
import { FORCE_L1_OPTION } from '../lib/config'
import { HELPER_CLASSNAME, LABEL_CLASSNAME } from '../lib/recipes'

import type { ForceL1Scope } from '../lib/route'

const OPTIONS: { scope: ForceL1Scope; label: string }[] = [
  { scope: 'off', label: 'Off' },
  { scope: 'trading', label: 'Trading only' },
  { scope: 'all', label: 'Everything' },
]

function describe(scope: ForceL1Scope, l1: string): string {
  switch (scope) {
    case 'off':
      return `The API is tried first and the ${l1} contract is used only when the API refuses the account.`
    case 'trading':
      return `Closing positions and cancelling orders are sent to the ${l1} contract and cost gas. Key registration, withdrawals, transfers and pool steps still try the API first.`
    case 'all':
      return `Key registration and every step with a contract route are sent to the ${l1} contract and cost gas, as if the API had refused this account. Unstaking and freezing a pool still use the API.`
  }
}

/**
 * Testing switch, rendered only when the build sets VITE_FORCE_L1_OPTION.
 * It makes the page behave as if the API had refused the account, for the
 * trading actions only or for everything.
 */
export function ForceL1Bar() {
  const scope = useForceL1Scope()
  const { actions } = useActions()
  const l1 = useEnvironment().l1Name
  if (!FORCE_L1_OPTION) return null
  const busy = Object.values(actions).some(isInFlight)

  return (
    <div className="flex flex-col gap-2 rounded-modal border-[0.5px] border-dashed border-line bg-fill px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className={LABEL_CLASSNAME}>Testing · force contract calls</span>
        <div className="flex gap-1" role="radiogroup" aria-label="Force contract calls">
          {OPTIONS.map((option) => {
            const active = option.scope === scope
            return (
              <button
                key={option.scope}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy && !active}
                onClick={() => setForceL1Scope(option.scope)}
                className={cn(
                  'rounded-pill border-[0.5px] px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50',
                  active ? 'border-ink/30 bg-ink/10 text-ink' : 'border-line text-dim hover:bg-ink/6 hover:text-ink',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
      <span className={HELPER_CLASSNAME}>
        {busy ? 'Wait for the running actions to finish before changing this.' : describe(scope, l1)}
      </span>
    </div>
  )
}
