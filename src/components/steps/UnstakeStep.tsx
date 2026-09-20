import { useEffect, useState } from 'react'

import { useActions, isInFlight } from '../../hooks/useActions'
import { useExitAction, type ExitActionRequest } from '../../hooks/useExitAction'
import { accountKey } from '../../hooks/useLighterData'
import { useSigningKeys } from '../../hooks/useSigningKeys'
import cn from '../../lib/cn'
import { TX_TYPE, UNSTAKE_PERIOD_DAYS } from '../../lib/config'
import { formatAmount, formatCountdown, formatDateTime, formatUsd } from '../../lib/format'
import { BTN_PRIMARY_CLASSNAME, BTN_ROW_CLASSNAME, BTN_SECONDARY_CLASSNAME, LABEL_CLASSNAME } from '../../lib/recipes'
import { signUnstakeAssets } from '../../lib/signer'
import { toMillis } from '../../lib/time'
import { ActionLine, StatusPill } from '../ActionStatus'
import { Notice, StepCard, Table, type StepState } from '../StepCard'

import type { ExitPlan, PoolShareItem } from '../../lib/plan'
import type { AssetDetails } from '../../lib/types'

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export function UnstakeStep({
  accountIndex,
  plan,
  assets,
  canAct,
  reason,
}: {
  accountIndex: number
  plan: ExitPlan
  assets: Map<number, AssetDetails> | undefined
  canAct: boolean
  reason: string | null
}) {
  const { actions } = useActions()
  const { keys, mode } = useSigningKeys()
  const { run, runSequence } = useExitAction()
  const now = useNow()
  const stakes = plan.stakes
  const loading = plan.unknownPools.length > 0
  const keyReady = mode === 'api' && keys[accountIndex]?.stage === 'registered'
  const anyInFlight = stakes.some((s) => isInFlight(actions[s.id]))

  const request = (s: PoolShareItem): ExitActionRequest => ({
    id: s.id,
    label: `Unstake from ${s.poolName}`,
    accountIndex,
    l2: {
      txType: TX_TYPE.UNSTAKE_ASSETS,
      sign: (nonce) => signUnstakeAssets({ accountIndex, stakingPoolIndex: s.poolIndex, shareAmount: s.shares, nonce }),
    },
    invalidate: [accountKey(accountIndex)],
  })

  const pending = stakes.filter((s) => !isInFlight(actions[s.id]) && actions[s.id]?.status !== 'executed')
  const stepState: StepState =
    stakes.length === 0
      ? loading
        ? 'loading'
        : plan.pendingUnlocks.length > 0
          ? 'active'
          : 'empty'
      : anyInFlight
        ? 'active'
        : 'todo'

  return (
    <StepCard
      step={4}
      title="Unstake from the staking pool"
      description={
        <>
          Unstaking only exists as an API request, signed with the key from step 0. Unlocked assets land in this
          account&apos;s spot balance after the {UNSTAKE_PERIOD_DAYS}-day unstaking period and can then be withdrawn in
          step 5.
        </>
      }
      state={stepState}
    >
      {stakes.length === 0 && plan.pendingUnlocks.length === 0 ? (
        <Notice>{loading ? 'Checking pool types…' : 'Nothing staked on this account.'}</Notice>
      ) : (
        <div className="flex flex-col gap-5">
          {stakes.length > 0 && (
            <>
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
                {stakes.map((s) => {
                  const state = actions[s.id]
                  const done = state?.status === 'executed'
                  return (
                    <tr key={s.id} className={cn(done && 'opacity-60')}>
                      <td>
                        <span className="font-medium text-ink">{s.poolName}</span>
                        <span className="ml-2 text-2xs text-meta">#{s.poolIndex}</span>
                      </td>
                      <td className="text-right font-mono tabular-nums text-ink">{formatAmount(s.shares.toString(), 0)}</td>
                      <td className="text-right font-mono tabular-nums text-dim">{formatUsd(s.principal)}</td>
                      <td className="text-right">
                        <StatusPill state={state} />
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          disabled={!canAct || !keyReady || isInFlight(state) || done}
                          onClick={() => void run(request(s))}
                          className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_CLASSNAME)}
                        >
                          {done ? 'Unstaked' : 'Unstake'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </Table>
              <div className="flex flex-col gap-2">
                {stakes.map((s) => (actions[s.id] ? <ActionLine key={s.id} state={actions[s.id]} /> : null))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!canAct || !keyReady || pending.length === 0 || anyInFlight}
                  onClick={() => void runSequence(pending.map(request))}
                  className={BTN_PRIMARY_CLASSNAME}
                >
                  Unstake everything
                </button>
                {!canAct && reason ? (
                  <span className="text-sm text-faint">{reason}</span>
                ) : !keyReady ? (
                  <span className="text-sm text-faint">
                    {mode === 'l1' ? 'Switch back to the API in step 0 to unstake.' : 'Unlock API signing in step 0 first.'}
                  </span>
                ) : null}
              </div>
            </>
          )}

          {plan.pendingUnlocks.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className={LABEL_CLASSNAME}>Unlocking</span>
              <Table
                head={
                  <>
                    <th>Asset</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Unlocks</th>
                    <th className="text-right">Remaining</th>
                  </>
                }
              >
                {plan.pendingUnlocks.map((u, i) => {
                  const asset = assets?.get(u.asset_index)
                  const remaining = toMillis(u.unlock_timestamp) - now
                  return (
                    <tr key={`${u.asset_index}-${u.unlock_timestamp}-${i}`}>
                      <td className="font-medium text-ink">{asset?.symbol ?? `asset ${u.asset_index}`}</td>
                      <td className="text-right font-mono tabular-nums text-ink">{formatAmount(u.amount, asset?.decimals ?? 6)}</td>
                      <td className="text-right text-dim">{formatDateTime(u.unlock_timestamp)}</td>
                      <td className={cn('text-right font-mono tabular-nums', remaining <= 0 ? 'text-success' : 'text-warn')}>
                        {remaining <= 0 ? 'ready' : formatCountdown(remaining)}
                      </td>
                    </tr>
                  )
                })}
              </Table>
              <p className="text-sm leading-md text-faint">
                When the timer ends the assets are credited to this account&apos;s spot balance automatically. Come back then and withdraw them in step 5.
              </p>
            </div>
          )}
        </div>
      )}
    </StepCard>
  )
}
