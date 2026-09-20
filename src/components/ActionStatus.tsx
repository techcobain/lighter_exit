import cn from '../lib/cn'
import { ETHERSCAN_TX, LIGHTER_EXPLORER_TX } from '../lib/config'
import { LINK_CLASSNAME } from '../lib/recipes'

import type { ActionState, ActionStatus as Status } from '../hooks/useActions'

const LABEL: Record<Status, string> = {
  idle: '',
  preparing: 'Preparing',
  signing: 'Sign in wallet',
  pending: 'On Ethereum',
  confirmed: 'Confirmed',
  'l2-waiting': 'Lighter processing',
  executed: 'Executed',
  'l2-failed': 'Rejected by Lighter',
  error: 'Failed',
}

const CLASS: Record<Status, string> = {
  idle: '',
  preparing: 'border-line bg-fill text-dim animate-pulse',
  signing: 'border-link/30 bg-link/10 text-link animate-pulse',
  pending: 'border-link/30 bg-link/10 text-link animate-pulse',
  confirmed: 'border-warn/30 bg-warn/10 text-warn',
  'l2-waiting': 'border-link/30 bg-link/10 text-link animate-small-pulse',
  executed: 'border-success/30 bg-success/10 text-success',
  'l2-failed': 'border-danger/30 bg-danger/10 text-danger',
  error: 'border-danger/30 bg-danger/10 text-danger',
}

export function StatusPill({ state }: { state: ActionState | undefined }) {
  if (!state || state.status === 'idle') return null
  return (
    <span
      className={cn(
        'inline-flex rounded-pill border-[0.5px] px-2 py-0.5 text-2xs font-medium tracking-caps uppercase whitespace-nowrap',
        CLASS[state.status],
      )}
    >
      {LABEL[state.status]}
    </span>
  )
}

/** One-line status with the message and explorer links; goes under a row or button. */
export function ActionLine({ state }: { state: ActionState | undefined }) {
  if (!state || state.status === 'idle') return null
  const danger = state.status === 'error' || state.status === 'l2-failed'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-md">
      <StatusPill state={state} />
      {state.route && (
        <span className="text-2xs tracking-caps text-faint uppercase">via {state.route === 'api' ? 'API' : 'Ethereum'}</span>
      )}
      {state.message && <span className={danger ? 'text-danger' : 'text-dim'}>{state.message}</span>}
      {state.txHash && (
        <a
          href={`${ETHERSCAN_TX}${state.txHash}`}
          target="_blank"
          rel="noreferrer"
          className={`${LINK_CLASSNAME} font-mono text-2xs`}
        >
          etherscan ↗
        </a>
      )}
      {state.l2Hash && (
        <a
          href={`${LIGHTER_EXPLORER_TX}${state.l2Hash}`}
          target="_blank"
          rel="noreferrer"
          className={`${LINK_CLASSNAME} font-mono text-2xs`}
        >
          lighter scan ↗
        </a>
      )}
    </div>
  )
}
