import { useEnvironment } from '../hooks/useEnvironment'
import { useContractScope } from '../hooks/useContractScope'
import { KEY_BUSY_STAGES, useSigningKeys } from '../hooks/useSigningKeys'
import { useActions } from '../hooks/useActions'
import cn from '../lib/cn'
import { API_KEY_INDEX } from '../lib/config'
import { BTN_PRIMARY_CLASSNAME, BTN_SECONDARY_CLASSNAME, HELPER_CLASSNAME, LABEL_CLASSNAME, PROSE_CLASSNAME } from '../lib/recipes'

import { ActionLine } from './ActionStatus'
import { StepCard, type StepState } from './StepCard'

/**
 * Step 0 for an account: derive and register the signing key that lets the
 * steps that use the API go through it. Also hosts the contract-only switch.
 */
export function SigningKeyCard({
  accountIndex,
  label,
  canAct,
  reason,
  compact = false,
}: {
  accountIndex: number
  label?: string
  canAct: boolean
  reason: string | null
  compact?: boolean
}) {
  const { keys, mode, setMode, unlock, recheck } = useSigningKeys()
  const { actions } = useActions()
  const l1 = useEnvironment().l1Name
  const scope = useContractScope()
  const state = keys[accountIndex] ?? { stage: 'idle' as const }
  const busy = KEY_BUSY_STAGES.has(state.stage)
  const registered = state.stage === 'registered'
  const l1Only = mode === 'l1'

  const stepState: StepState = l1Only ? 'empty' : registered ? 'done' : busy ? 'active' : 'todo'

  const body = (
    <div className="flex flex-col gap-3">
      {registered ? (
        <p className="text-sm text-success">
          Key registered on account #{accountIndex}.{' '}
          {scope === 'all'
            ? 'Testing: every step with a contract route goes to the contract. Only unstaking and freezing a pool use the API.'
            : scope === 'trading'
              ? `Pool exits, unstaking, transfers and withdrawals go through the API and need no gas. Cancelling orders and closing positions are sent to the ${l1} contract.`
              : 'Actions go through the API and need no gas.'}
          <span className="ml-2 font-mono text-2xs text-meta">{state.key?.publicKey.slice(0, 16)}…</span>
        </p>
      ) : busy ? (
        <p className="animate-pulse text-sm text-dim">{state.message ?? 'Working…'}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {state.message && <p className="text-sm text-danger">{state.message}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canAct || l1Only}
              title={!canAct ? (reason ?? undefined) : undefined}
              onClick={() => void unlock(accountIndex)}
              className={BTN_PRIMARY_CLASSNAME}
            >
              {state.stage === 'idle' ? `Unlock API signing${label ? ` for ${label}` : ''}` : 'Try again'}
            </button>
            {state.key && (
              <button type="button" onClick={() => void recheck(accountIndex)} className="text-sm text-muted hover:text-ink">
                Check again
              </button>
            )}
          </div>
        </div>
      )}
      <ActionLine state={actions[`regkey-${accountIndex}`]} />
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-[0.5px] border-line pt-3">
          <p className={cn(PROSE_CLASSNAME, HELPER_CLASSNAME, 'min-w-0 flex-1 basis-[36ch]')}>
            {l1Only
              ? `${l1}-only mode: every step is sent to the contract and costs gas. Unstaking and freezing a pool are not possible this way.`
              : `Prefer not to register a key? Every step except unstaking and freezing a pool can also be sent straight to the ${l1} contract.`}
          </p>
          <button
            type="button"
            onClick={() => setMode(l1Only ? 'api' : 'l1')}
            className={cn(BTN_SECONDARY_CLASSNAME, 'h-8 px-3 text-sm/4 max-mobile:h-8')}
          >
            {l1Only ? 'Use the API instead' : `Use ${l1} only`}
          </button>
        </div>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className="flex flex-col gap-3 rounded-card border-[0.5px] border-line bg-surface/60 p-4">
        <span className={LABEL_CLASSNAME}>Signing key · {label ?? `account #${accountIndex}`}</span>
        {body}
      </div>
    )
  }

  return (
    <StepCard
      step={0}
      title="Unlock API signing"
      description={
        <>
          Your wallet signs a message that derives a Lighter signing key for this account. The key is registered at
          API slot {API_KEY_INDEX} (the official apps use the low slots) and lets{' '}
          {scope === 'trading' ? 'pool exits, unstaking, transfers and withdrawals' : 'the steps below'} go through
          Lighter&apos;s API: no gas, instant results. Whenever the API refuses this account, the same action is sent
          through the {l1} contract automatically.
          {scope === 'trading' &&
            ` Cancelling orders and closing positions don't need the key: they always go through the ${l1} contract.`}
        </>
      }
      state={stepState}
    >
      {body}
    </StepCard>
  )
}
