import { useActions, isInFlight } from '../../hooks/useActions'
import { useExitAction, type ExitActionRequest } from '../../hooks/useExitAction'
import { accountKey } from '../../hooks/useLighterData'
import cn from '../../lib/cn'
import { TX_TYPE } from '../../lib/config'
import { accountTypeLabel, formatAmount, formatUsd } from '../../lib/format'
import { BTN_PRIMARY_CLASSNAME, BTN_ROW_CLASSNAME, BTN_SECONDARY_CLASSNAME } from '../../lib/recipes'
import { signBurnShares } from '../../lib/signer'
import { assertFits, UINT64_MAX } from '../../lib/units'
import { ActionLine, StatusPill } from '../ActionStatus'
import { Notice, StepCard, Table, type StepState } from '../StepCard'

import type { ExitPlan, PoolShareItem } from '../../lib/plan'

export function BurnSharesStep({
  accountIndex,
  plan,
  canAct,
  reason,
}: {
  accountIndex: number
  plan: ExitPlan
  canAct: boolean
  reason: string | null
}) {
  const { actions } = useActions()
  const { run, runSequence } = useExitAction()
  const items = plan.poolShares
  const loading = plan.unknownPools.length > 0

  const request = (s: PoolShareItem): ExitActionRequest => {
    assertFits(s.shares, UINT64_MAX, 'shares')
    const label = `Burn shares of ${s.poolName}`
    return {
      id: s.id,
      label,
      accountIndex,
      l2: {
        txType: TX_TYPE.BURN_SHARES,
        sign: (nonce) => signBurnShares({ accountIndex, publicPoolIndex: s.poolIndex, shareAmount: s.shares, nonce }),
      },
      l1: {
        id: s.id,
        label,
        functionName: 'burnShares',
        args: [accountIndex, s.poolIndex, s.shares],
        invalidate: [accountKey(accountIndex)],
      },
      invalidate: [accountKey(accountIndex)],
    }
  }

  const anyInFlight = items.some((s) => isInFlight(actions[s.id]))
  const pending = items.filter((s) => !isInFlight(actions[s.id]) && actions[s.id]?.status !== 'executed')
  const stepState: StepState = items.length === 0 ? (loading ? 'loading' : 'empty') : anyInFlight ? 'active' : 'todo'

  return (
    <StepCard
      step={3}
      title="Exit public pools"
      description="Burning your shares in a public pool (LLP or a trader-run pool) returns your part of the pool's assets to this account's balances. The staking pool is handled separately in step 4."
      state={stepState}
    >
      {items.length === 0 ? (
        <Notice>{loading ? 'Checking which pools these shares belong to…' : 'No public pool shares on this account.'}</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <Table
            head={
              <>
                <th>Pool</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Principal</th>
                <th className="text-right">Status</th>
                <th />
              </>
            }
          >
            {items.map((s) => {
              const state = actions[s.id]
              const done = state?.status === 'executed'
              return (
                <tr key={s.id} className={cn(done && 'opacity-60')}>
                  <td>
                    <span className="font-medium text-ink">{s.poolName}</span>
                    <span className="ml-2 text-2xs text-meta">
                      {s.poolType !== null ? accountTypeLabel(s.poolType) : ''} · #{s.poolIndex}
                    </span>
                  </td>
                  <td className="text-right font-mono tabular-nums text-ink">{formatAmount(s.shares.toString(), 0)}</td>
                  <td className="text-right font-mono tabular-nums text-dim">{formatUsd(s.principal)}</td>
                  <td className="text-right">
                    <StatusPill state={state} />
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      disabled={!canAct || isInFlight(state) || done}
                      onClick={() => void run(request(s))}
                      className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_CLASSNAME)}
                    >
                      {done ? 'Burned' : 'Burn'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </Table>
          <div className="flex flex-col gap-2">
            {items.map((s) => (actions[s.id] ? <ActionLine key={s.id} state={actions[s.id]} /> : null))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canAct || pending.length === 0 || anyInFlight}
              onClick={() => void runSequence(pending.map(request))}
              className={BTN_PRIMARY_CLASSNAME}
            >
              Burn all {pending.length > 1 ? `(${pending.length})` : ''}
            </button>
            {!canAct && reason && <span className="text-sm text-faint">{reason}</span>}
          </div>
        </div>
      )}
    </StepCard>
  )
}
