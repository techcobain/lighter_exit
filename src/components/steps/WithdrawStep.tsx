import { useActions, isInFlight } from '../../hooks/useActions'
import { useExitAction, type ExitActionRequest } from '../../hooks/useExitAction'
import { accountKey, useWithdrawalDelay } from '../../hooks/useLighterData'
import { useSigningKeys } from '../../hooks/useSigningKeys'
import cn from '../../lib/cn'
import { API_KEY_INDEX, ROUTE_PERP, ROUTE_SPOT, TX_TYPE } from '../../lib/config'
import { formatAmount } from '../../lib/format'
import { BTN_PRIMARY_CLASSNAME, BTN_ROW_CLASSNAME, BTN_SECONDARY_CLASSNAME } from '../../lib/recipes'
import { signTransfer, signWithdraw } from '../../lib/signer'
import { assertFits, isPositiveDecimal, UINT64_MAX } from '../../lib/units'
import { ActionLine, StatusPill } from '../ActionStatus'
import { Notice, StepCard, Table, type StepState } from '../StepCard'

import type { ExitPlan, WithdrawItem } from '../../lib/plan'
import type { DetailedAccount } from '../../lib/types'

export function WithdrawStep({
  accountIndex,
  plan,
  canAct,
  reason,
  master,
}: {
  accountIndex: number
  plan: ExitPlan
  canAct: boolean
  reason: string | null
  /** For sub-accounts: the main account balances can be consolidated into. */
  master?: DetailedAccount
}) {
  const { actions } = useActions()
  const { keys, mode } = useSigningKeys()
  const { run, runSequence } = useExitAction()
  const delay = useWithdrawalDelay()
  const items = plan.withdrawals
  const withdrawable = items.filter((w) => !w.belowMinimum)
  const blockers = plan.positions.length > 0 || plan.poolShares.length > 0 || plan.openOrders > 0
  const canConsolidate = !!master && mode === 'api' && keys[accountIndex]?.stage === 'registered'

  const moveId = (w: WithdrawItem) => `mv-${accountIndex}-${w.assetId}-${w.route}`

  const withdrawRequest = (w: WithdrawItem): ExitActionRequest => {
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

  /** Same-main-account transfer into the main account's spot balance: no fee, no minimum, API only. */
  const moveRequest = (w: WithdrawItem): ExitActionRequest => ({
    id: moveId(w),
    label: `Move ${w.symbol} to main account`,
    accountIndex,
    l2: {
      txType: TX_TYPE.TRANSFER,
      sign: (nonce) =>
        signTransfer({
          accountIndex,
          toAccountIndex: master!.index,
          assetIndex: w.assetId,
          fromRouteType: w.route,
          toRouteType: ROUTE_SPOT,
          amount: w.units,
          nonce,
          apiKeyIndex: API_KEY_INDEX,
        }),
    },
    invalidate: [accountKey(accountIndex), accountKey(master!.index)],
  })

  const stateOf = (w: WithdrawItem) => actions[w.id] ?? actions[moveId(w)]
  const anyInFlight = items.some((w) => isInFlight(actions[w.id]) || isInFlight(actions[moveId(w)]))
  const settled = (w: WithdrawItem) => stateOf(w)?.status === 'executed'
  const pendingWithdraw = withdrawable.filter((w) => !isInFlight(stateOf(w)) && !settled(w))
  const pendingMove = items.filter((w) => !isInFlight(stateOf(w)) && !settled(w))
  const stepState: StepState = (canConsolidate ? items : withdrawable).length === 0 ? 'empty' : anyInFlight ? 'active' : 'todo'
  const delayText = delay.data && delay.data > 0 ? `${Math.max(1, Math.round(delay.data / 60))} minutes` : 'a while'

  return (
    <StepCard
      step={5}
      title={master ? 'Move to main account or withdraw' : 'Withdraw to your wallet'}
      description={
        master
          ? `Balances on a sub-account can be moved into the main account first (free, instant, and amounts below the withdrawal minimum can go too) so everything is withdrawn once from there, or withdrawn straight to your wallet. Withdrawals take about ${delayText} to arrive on Ethereum.`
          : `Withdraws each balance to the wallet that owns the account. Spot balances and perps collateral are separate routes, so an asset can appear twice. Lighter currently processes withdrawals in about ${delayText}, after which the tokens arrive on Ethereum.`
      }
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
          {master && !canConsolidate && (
            <Notice>
              {mode === 'l1'
                ? 'Moving to the main account needs the API; in Ethereum-only mode balances are withdrawn directly.'
                : 'Unlock API signing in step 0 to move balances into the main account; until then they can only be withdrawn directly.'}
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
              const state = stateOf(w)
              const done = settled(w)
              return (
                <tr key={w.id} className={cn((done || (w.belowMinimum && !canConsolidate)) && 'opacity-60')}>
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
                    {w.belowMinimum && !state ? (
                      <span className="text-2xs tracking-caps text-faint uppercase">below minimum</span>
                    ) : (
                      <StatusPill state={state} />
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {canConsolidate && (
                      <button
                        type="button"
                        disabled={!canAct || isInFlight(state) || done}
                        onClick={() => void run(moveRequest(w))}
                        className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_CLASSNAME, 'mr-1.5')}
                      >
                        {done && actions[moveId(w)] ? 'Moved' : 'Move'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!canAct || w.belowMinimum || isInFlight(state) || done}
                      onClick={() => void run(withdrawRequest(w))}
                      className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_CLASSNAME)}
                    >
                      {done && actions[w.id] ? 'Sent' : 'Withdraw'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </Table>
          <div className="flex flex-col gap-2">
            {items.map((w) => (stateOf(w) ? <ActionLine key={w.id} state={stateOf(w)} /> : null))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canConsolidate && (
              <button
                type="button"
                disabled={!canAct || pendingMove.length === 0 || anyInFlight}
                onClick={() => void runSequence(pendingMove.map(moveRequest))}
                className={BTN_PRIMARY_CLASSNAME}
              >
                Move all to main account {pendingMove.length > 1 ? `(${pendingMove.length})` : ''}
              </button>
            )}
            <button
              type="button"
              disabled={!canAct || pendingWithdraw.length === 0 || anyInFlight}
              onClick={() => void runSequence(pendingWithdraw.map(withdrawRequest))}
              className={canConsolidate ? BTN_SECONDARY_CLASSNAME : BTN_PRIMARY_CLASSNAME}
            >
              Withdraw all {pendingWithdraw.length > 1 ? `(${pendingWithdraw.length})` : ''}
            </button>
            {!canAct && reason && <span className="text-sm text-faint">{reason}</span>}
          </div>
          {items.some((w) => w.belowMinimum) && (
            <p className="text-sm leading-md text-faint">
              {canConsolidate
                ? "Amounts under an asset's minimum can't be withdrawn directly, but they can be moved to the main account and withdrawn from there once they add up."
                : "Amounts under an asset's minimum can't be withdrawn and will stay on the account as dust."}
            </p>
          )}
          {master && canConsolidate && (
            <p className="text-sm leading-md text-faint">
              If Lighter refuses the transfer for this account, withdraw directly instead; moving has no Ethereum fallback.
            </p>
          )}
        </div>
      )}
    </StepCard>
  )
}
