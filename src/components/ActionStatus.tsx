import cn from '../lib/cn'
import { useEnvironment } from '../hooks/useEnvironment'
import { LINK_CLASSNAME } from '../lib/recipes'

import type { ActionState, ActionStatus as Status } from '../hooks/useActions'

const LABEL: Record<Status, string> = {
  idle: '',
  preparing: 'Preparing',
  signing: 'Sign in wallet',
  pending: 'On L1',
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
  const env = useEnvironment()
  if (!state || state.status === 'idle') return null
  return (
    <span
      className={cn(
        'inline-flex rounded-pill border-[0.5px] px-2 py-0.5 text-2xs font-medium tracking-caps uppercase whitespace-nowrap',
        CLASS[state.status],
      )}
    >
      {state.status === 'pending' ? `On ${env.l1Name}` : LABEL[state.status]}
    </span>
  )
}

/** One-line status with the message and explorer links; goes under a row or button. */
export function ActionLine({ state }: { state: ActionState | undefined }) {
  const env = useEnvironment()
  if (!state || state.status === 'idle') return null
  const danger = state.status === 'error' || state.status === 'l2-failed'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-md">
      <StatusPill state={state} />
      {state.route && (
        <span className="text-2xs tracking-caps text-faint uppercase">via {state.route === 'api' ? 'API' : env.l1Name}</span>
      )}
      {state.message && <span className={danger ? 'text-danger' : 'text-dim'}>{state.message}</span>}
      {state.txHash && (
        <a
          href={`${env.l1ExplorerTx}${state.txHash}`}
          target="_blank"
          rel="noreferrer"
          className={`${LINK_CLASSNAME} font-mono text-2xs`}
        >
          {env.l1ExplorerName} ↗
        </a>
      )}
      {state.l2Hash && env.l2ExplorerTx && (
        <a
          href={`${env.l2ExplorerTx}${state.l2Hash}`}
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

/** The status lines of several actions; renders nothing (so takes no space) when none has started. */
export function ActionLines({ states }: { states: (ActionState | undefined)[] }) {
  const started = states.filter((s): s is ActionState => !!s && s.status !== 'idle')
  if (started.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {started.map((s, i) => (
        <ActionLine key={i} state={s} />
      ))}
    </div>
  )
}
