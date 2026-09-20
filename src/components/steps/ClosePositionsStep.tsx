import { useMemo, useState } from 'react'

import { useActions, isInFlight } from '../../hooks/useActions'
import { useExitAction, type ExitActionRequest } from '../../hooks/useExitAction'
import { accountKey } from '../../hooks/useLighterData'
import cn from '../../lib/cn'
import { TX_TYPE } from '../../lib/config'
import { ORDER_SIDE_ASK, ORDER_SIDE_BID, ORDER_TYPE_MARKET } from '../../lib/contract'
import { formatAmount, formatUsd } from '../../lib/format'
import {
  BTN_PRIMARY_CLASSNAME,
  BTN_ROW_CLASSNAME,
  BTN_SECONDARY_CLASSNAME,
  INPUT_CLASSNAME,
  LABEL_CLASSNAME,
} from '../../lib/recipes'
import { signCreateOrder } from '../../lib/signer'
import { assertFits, fromBaseUnits, UINT32_MAX, UINT48_MAX, worstPriceUnits } from '../../lib/units'
import { ActionLine, StatusPill } from '../ActionStatus'
import { Notice, StepCard, Table, type StepState } from '../StepCard'

import type { ClosePositionItem, ExitPlan } from '../../lib/plan'

const DEFAULT_SLIPPAGE = 5
/** Reduce-only orders accept 0 as "my whole position" (capped to the market's quote limit). */
const WHOLE_POSITION = 0n

interface Row {
  item: ClosePositionItem
  price: bigint | null
  problem: string | null
}

export function ClosePositionsStep({
  accountIndex,
  plan,
  canAct,
  reason,
  step = 2,
}: {
  accountIndex: number
  plan: ExitPlan
  canAct: boolean
  reason: string | null
  step?: number
}) {
  const { actions } = useActions()
  const { run, runSequence } = useExitAction()
  const [slippageText, setSlippageText] = useState(String(DEFAULT_SLIPPAGE))
  const slippage = Number(slippageText)
  const slippageValid = Number.isFinite(slippage) && slippage >= 0.1 && slippage <= 90

  const rows = useMemo<Row[]>(
    () =>
      plan.positions.map((p) => {
        let price: bigint | null = null
        let problem = p.blocked
        if (!problem) {
          try {
            if (p.markPrice === null) throw new Error('Mark price unavailable')
            price = worstPriceUnits(p.markPrice, p.priceDecimals, p.side, slippageValid ? slippage : DEFAULT_SLIPPAGE)
            assertFits(price, UINT32_MAX, 'price')
            assertFits(p.baseAmount, UINT48_MAX, 'size')
            if (p.baseAmount <= 0n) throw new Error('Size rounds to zero')
          } catch (err) {
            problem = err instanceof Error ? err.message : String(err)
            price = null
          }
        }
        return { item: p, price, problem }
      }),
    [plan.positions, slippage, slippageValid],
  )

  const request = (row: Row): ExitActionRequest | null => {
    const price = row.price
    if (price === null) return null
    const p = row.item
    const label = `Close ${p.side} ${p.symbol}`
    return {
      id: p.id,
      label,
      accountIndex,
      l2: {
        txType: TX_TYPE.CREATE_ORDER,
        sign: (nonce) =>
          signCreateOrder({
            accountIndex,
            marketIndex: p.marketId,
            clientOrderIndex: Date.now(),
            baseAmount: WHOLE_POSITION,
            price,
            isAsk: p.isAsk,
            reduceOnly: true,
            nonce,
          }),
      },
      l1: {
        id: p.id,
        label,
        functionName: 'createOrder',
        args: [
          accountIndex,
          p.marketId,
          Number(WHOLE_POSITION),
          Number(price),
          p.isAsk === 1 ? ORDER_SIDE_ASK : ORDER_SIDE_BID,
          ORDER_TYPE_MARKET,
        ],
        invalidate: [accountKey(accountIndex)],
      },
      invalidate: [accountKey(accountIndex)],
    }
  }

  const anyInFlight = rows.some((r) => isInFlight(actions[r.item.id]))
  const closable = rows.filter((r) => r.price !== null && !isInFlight(actions[r.item.id]))
  const stepState: StepState = plan.positions.length === 0 ? 'empty' : anyInFlight ? 'active' : 'todo'

  return (
    <StepCard
      step={step}
      title="Close perp positions"
      description="Each position is closed with a reduce-only market order for the whole position (Lighter caps very large ones to the market's quote limit; send again if a remainder shows). The price is a bound on the average fill price: the order fills against the live book and stops if going further would push the average past it, leaving the rest open for another try."
      state={stepState}
      aside={
        plan.positions.length > 0 ? (
          <label className="flex items-center gap-2 text-2xs tracking-caps text-meta uppercase">
            Max slippage
            <input
              type="number"
              min={0.1}
              max={90}
              step={0.5}
              value={slippageText}
              onChange={(e) => setSlippageText(e.target.value)}
              aria-invalid={!slippageValid}
              className={cn(INPUT_CLASSNAME, 'h-8 w-20 px-2 text-right font-mono text-sm normal-case')}
            />
            %
          </label>
        ) : null
      }
    >
      {plan.positions.length === 0 ? (
        <Notice>No open perp positions. Spot balances don&apos;t need closing; withdraw them in step 5.</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          {!slippageValid && (
            <Notice tone="warn">Slippage must be between 0.1% and 90%. Using {DEFAULT_SLIPPAGE}% until fixed.</Notice>
          )}
          <Table
            head={
              <>
                <th>Market</th>
                <th>Side</th>
                <th className="text-right">Size</th>
                <th className="text-right">Entry</th>
                <th className="text-right">Mark</th>
                <th className="text-right">uPnL</th>
                <th className="text-right">Worst price</th>
                <th className="text-right">Status</th>
                <th />
              </>
            }
          >
            {rows.map((row) => {
              const { item: p, price } = row
              const state = actions[p.id]
              const done = state?.status === 'executed'
              return (
                <tr key={p.id} className={cn(done && 'opacity-60')}>
                  <td className="font-medium text-ink">
                    {p.symbol}
                    {p.isolated && <span className="ml-1.5 text-2xs text-meta uppercase">iso</span>}
                  </td>
                  <td className={p.side === 'long' ? 'text-up' : 'text-down'}>{p.side}</td>
                  <td className="text-right font-mono tabular-nums text-ink">{formatAmount(p.size, p.sizeDecimals)}</td>
                  <td className="text-right font-mono tabular-nums text-dim">{formatAmount(p.entryPrice, p.priceDecimals)}</td>
                  <td className="text-right font-mono tabular-nums text-dim">
                    {p.markPrice !== null ? formatAmount(p.markPrice.toFixed(p.priceDecimals), p.priceDecimals) : '—'}
                  </td>
                  <td className={cn('text-right font-mono tabular-nums', Number(p.unrealizedPnl) >= 0 ? 'text-up' : 'text-down')}>
                    {formatUsd(p.unrealizedPnl)}
                  </td>
                  <td className="text-right font-mono tabular-nums text-ink">
                    {price !== null ? formatAmount(fromBaseUnits(price, p.priceDecimals), p.priceDecimals) : '—'}
                  </td>
                  <td className="text-right">
                    <StatusPill state={state} />
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      disabled={!canAct || price === null || isInFlight(state) || done}
                      onClick={() => {
                        const req = request(row)
                        if (req) void run(req)
                      }}
                      className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_CLASSNAME)}
                    >
                      {done ? 'Closed' : 'Close'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </Table>
          {rows.some((r) => r.problem) && (
            <div className="flex flex-col gap-1">
              {rows
                .filter((r) => r.problem)
                .map((r) => (
                  <p key={r.item.id} className="text-sm text-warn">
                    {r.item.symbol}: {r.problem}
                  </p>
                ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {rows.map((r) => (actions[r.item.id] ? <ActionLine key={r.item.id} state={actions[r.item.id]} /> : null))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canAct || closable.length === 0 || anyInFlight}
              onClick={() => void runSequence(closable.map(request).filter((r): r is ExitActionRequest => r !== null))}
              className={BTN_PRIMARY_CLASSNAME}
            >
              Close all {closable.length > 1 ? `(${closable.length})` : ''}
            </button>
            {!canAct && reason && <span className="text-sm text-faint">{reason}</span>}
            {canAct && closable.length > 1 && (
              <span className={`${LABEL_CLASSNAME} normal-case`}>Positions are closed one after another.</span>
            )}
          </div>
          {plan.positions.some((p) => p.openOrders > 0) && plan.openOrders > 0 && (
            <Notice tone="warn">Some of these markets still have open orders. Cancel them in step 1 first so they can&apos;t re-open the position.</Notice>
          )}
        </div>
      )}
    </StepCard>
  )
}
