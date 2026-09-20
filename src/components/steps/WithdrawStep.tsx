import { useActions, isInFlight } from '../../hooks/useActions'
import { useExitAction, type ExitActionRequest } from '../../hooks/useExitAction'
import { accountKey, useWithdrawalDelay } from '../../hooks/useLighterData'
import cn from '../../lib/cn'
import { ROUTE_PERP, TX_TYPE } from '../../lib/config'
import { formatAmount } from '../../lib/format'
import { BTN_PRIMARY_CLASSNAME, BTN_ROW_CLASSNAME, BTN_SECONDARY_CLASSNAME } from '../../lib/recipes'
import { signWithdraw } from '../../lib/signer'
import { assertFits, isPositiveDecimal, UINT64_MAX } from '../../lib/units'
import { ActionLine, StatusPill } from '../ActionStatus'
import { Notice, StepCard, Table, type StepState } from '../StepCard'

import type { ExitPlan, WithdrawItem } from '../../lib/plan'

export function WithdrawStep({
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
  const delay = useWithdrawalDelay()
  const items = plan.withdrawals
  const withdrawable = items.filter((w) => !w.belowMinimum)
  const blockers = plan.positions.length > 0 || plan.poolShares.length > 0 || plan.openOrders > 0

  const request = (w: WithdrawItem): ExitActionRequest => {
    assertFits(w.units, UINT64_MAX, 'amount')
    const label = `Withdraw ${w.symbol}`
    return {
      id: w.id,
      label,
      accountIndex,
      l2: {
        txType: TX_TYPE.WITHDRAW,
        sign: (nonce) => signWithdraw({ accountIndex, assetIndex: w.assetId, routeType: w.route, amount: w.units, nonce }),
      },
      l1: {
        id: w.id,
        label,
        functionName: 'withdraw',
        args: [accountIndex, w.assetId, w.route, w.units],
        invalidate: [accountKey(accountIndex)],
      },
      invalidate: [accountKey(accountIndex)],
    }
  }

  const anyInFlight = items.some((w) => isInFlight(actions[w.id]))
  const pending = withdrawable.filter((w) => !isInFlight(actions[w.id]) && actions[w.id]?.status !== 'executed')
  const stepState: StepState = withdrawable.length === 0 ? 'empty' : anyInFlight ? 'active' : 'todo'
  const delayText = delay.data && delay.data > 0 ? `${Math.max(1, Math.round(delay.data / 60))} minutes` : 'a while'

  return (
    <StepCard
      step={5}
      title="Withdraw to your wallet"
      description={`Withdraws each balance to the wallet that owns the account. Spot balances and perps collateral are separate routes, so an asset can appear twice. Lighter currently processes withdrawals in about ${delayText}, after which the tokens arrive on Ethereum.`}
      state={stepState}
    >
      {items.length === 0 ? (
        <Notice>Nothing to withdraw on this account.</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          {blockers && (
            <Notice tone="warn">
              Positions, pool shares or orders are still open. Finish steps 1–3 first, then refresh: the amounts below will grow as collateral is released.
            </Notice>
          )}
          <Table
            head={
              <>
                <th>Asset</th>
                <th>From</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Minimum</th>
                <th className="text-right">Status</th>
                <th />
              </>
            }
          >
            {items.map((w) => {
              const state = actions[w.id]
              const done = state?.status === 'executed'
              return (
                <tr key={w.id} className={cn((done || w.belowMinimum) && 'opacity-60')}>
                  <td className="font-medium text-ink">{w.symbol}</td>
                  <td className="text-dim">{w.route === ROUTE_PERP ? 'Perps collateral' : 'Spot balance'}</td>
                  <td className="text-right font-mono tabular-nums text-ink">
                    {formatAmount(w.amount, w.decimals)}
                    {isPositiveDecimal(w.lockedInOrders) && (
                      <span className="ml-1.5 text-2xs text-warn">+{formatAmount(w.lockedInOrders, w.decimals)} locked</span>
                    )}
                  </td>
                  <td className="text-right font-mono tabular-nums text-faint">{formatAmount(w.minWithdrawal, w.decimals)}</td>
                  <td className="text-right">
                    {w.belowMinimum ? (
                      <span className="text-2xs tracking-caps text-faint uppercase">below minimum</span>
                    ) : (
                      <StatusPill state={state} />
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      disabled={!canAct || w.belowMinimum || isInFlight(state) || done}
                      onClick={() => void run(request(w))}
                      className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_CLASSNAME)}
                    >
                      {done ? 'Sent' : 'Withdraw'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </Table>
          <div className="flex flex-col gap-2">
            {items.map((w) => (actions[w.id] ? <ActionLine key={w.id} state={actions[w.id]} /> : null))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canAct || pending.length === 0 || anyInFlight}
              onClick={() => void runSequence(pending.map(request))}
              className={BTN_PRIMARY_CLASSNAME}
            >
              Withdraw all {pending.length > 1 ? `(${pending.length})` : ''}
            </button>
            {!canAct && reason && <span className="text-sm text-faint">{reason}</span>}
          </div>
          {items.some((w) => w.belowMinimum) && (
            <p className="text-sm leading-md text-faint">
              Amounts under an asset&apos;s minimum can&apos;t be withdrawn and will stay on the account as dust.
            </p>
          )}
        </div>
      )}
    </StepCard>
  )
}
