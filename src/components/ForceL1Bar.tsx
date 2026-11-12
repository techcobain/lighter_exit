import { isInFlight, useActions } from '../hooks/useActions'
import { useEnvironment } from '../hooks/useEnvironment'
import { setContractScope, useContractScope } from '../hooks/useContractScope'
import cn from '../lib/cn'
import { FORCE_L1_OPTION } from '../lib/config'
import { HELPER_CLASSNAME, LABEL_CLASSNAME } from '../lib/recipes'

import type { ContractScope } from '../lib/route'

const OPTIONS: { scope: ContractScope; label: string }[] = [
  { scope: 'none', label: 'API first' },
  { scope: 'trading', label: 'Trading on contract' },
  { scope: 'all', label: 'All on contract' },
]

function describe(scope: ContractScope, l1: string): string {
  switch (scope) {
    case 'none':
      return `Testing only: every step tries the API first, cancelling orders and closing positions included. The ${l1} contract is used only when the API refuses the account.`
    case 'trading':
      return `What the live site does: cancelling orders and closing positions are sent to the ${l1} contract and cost gas. Key registration, withdrawals, transfers and pool steps try the API first.`
    case 'all':
      return `Testing only: key registration and every step with a contract route are sent to the ${l1} contract and cost gas, as if the API had refused this account. Unstaking and freezing a pool still use the API.`
  }
}

/**
 * Testing switch, rendered only when the build sets VITE_FORCE_L1_OPTION.
 * It changes which actions are always sent to the contract; without it the
 * page stays on DEFAULT_CONTRACT_SCOPE.
 */
export function ForceL1Bar() {
  const scope = useContractScope()
  const { actions } = useActions()
  const l1 = useEnvironment().l1Name
  if (!FORCE_L1_OPTION) return null
  const busy = Object.values(actions).some(isInFlight)

  return (
    <div className="flex flex-col gap-2 rounded-modal border-[0.5px] border-dashed border-line bg-fill px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className={LABEL_CLASSNAME}>Testing · contract routing</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Contract routing">
          {OPTIONS.map((option) => {
            const active = option.scope === scope
            return (
              <button
                key={option.scope}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy && !active}
                onClick={() => setContractScope(option.scope)}
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
