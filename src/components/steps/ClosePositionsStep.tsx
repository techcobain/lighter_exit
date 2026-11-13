import { useMemo, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { useActions, isInFlight } from '../../hooks/useActions'
import { useTradingOnContract } from '../../hooks/useContractScope'
import { useEnvironment } from '../../hooks/useEnvironment'
import { useExitAction, type ExitActionRequest } from '../../hooks/useExitAction'
import { accountKey, useRegionRestricted } from '../../hooks/useLighterData'
import { useRecheckAfterExecution } from '../../hooks/useRecheckAfterExecution'
import cn from '../../lib/cn'
import { TX_TYPE } from '../../lib/config'
import { ORDER_SIDE_ASK, ORDER_SIDE_BID, ORDER_TYPE_MARKET } from '../../lib/contract'
import { formatAmount, formatUsd } from '../../lib/format'
import {
  BTN_PRIMARY_CLASSNAME,
  BTN_ROW_FIXED_CLASSNAME,
  BTN_SECONDARY_CLASSNAME,
  COL_ACTION_CLASSNAME,
  COL_NUM_CLASSNAME,
  COL_STATUS_CLASSNAME,
  HELPER_CLASSNAME,
  INPUT_CLASSNAME,
  LABEL_CLASSNAME,
} from '../../lib/recipes'
import { awaitingRefresh, lastExecutedAt } from '../../lib/settle'
import { signCreateOrder } from '../../lib/signer'
import { assertFits, fromBaseUnits, UINT32_MAX, UINT48_MAX, worstPriceUnits } from '../../lib/units'
import { ActionLines, StatusPill } from '../ActionStatus'
import { ConfirmDialog } from '../ConfirmDialog'
import { Notice, StepCard, Table, type StepState } from '../StepCard'

import type { ClosePositionItem, ExitPlan } from '../../lib/plan'

const DEFAULT_SLIPPAGE = 5
/** Above this the user must confirm in a dialog before any order is sent. */
const SLIPPAGE_CONFIRM_ABOVE = 10
/** Hard ceiling: at 100% the bound for a long would be zero. */
const SLIPPAGE_MAX = 90
/** Reduce-only orders accept 0 as "my whole position" (capped to the market's quote limit). */
const WHOLE_POSITION = 0n

interface Row {
  item: ClosePositionItem
  price: bigint | null
  problem: string | null
}

/** Orders held back until the user confirms the slippage they were priced with. */
interface PendingConfirm {
  rows: Row[]
  sequence: boolean
  slippage: number
}

export function ClosePositionsStep({
  accountIndex,
  plan,
  canAct,
  reason,
  dataUpdatedAt,
  step = 2,
}: {
  accountIndex: number
  plan: ExitPlan
  canAct: boolean
  reason: string | null
  /** When the account data behind `plan` was last read. */
  dataUpdatedAt: number
  step?: number
}) {
  const { actions } = useActions()
  const queryClient = useQueryClient()
  const { run, runSequence } = useExitAction()
  const [slippageText, setSlippageText] = useState(String(DEFAULT_SLIPPAGE))
  const slippage = Number(slippageText)
  const slippageValid = Number.isFinite(slippage) && slippage >= 0.1 && slippage <= SLIPPAGE_MAX
  const effectiveSlippage = slippageValid ? slippage : DEFAULT_SLIPPAGE
  const needsConfirm = effectiveSlippage > SLIPPAGE_CONFIRM_ABOVE
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const rows = useMemo<Row[]>(
    () =>
      plan.positions.map((p) => {
        let price: bigint | null = null
        let problem = p.blocked
        if (!problem) {
          try {
            if (p.markPrice === null) throw new Error('Mark price unavailable')
            price = worstPriceUnits(p.markPrice, p.priceDecimals, p.side, effectiveSlippage)
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
    [plan.positions, effectiveSlippage],
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
      trading: true,
      // The market is missing from the browser's market list: contract only, the API is not tried.
      forceContract: p.contractOnly,
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
          BigInt(p.marketId),
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

  const execute = (targets: Row[], sequence: boolean) => {
    const requests = targets.map(request).filter((r): r is ExitActionRequest => r !== null)
    if (sequence) void runSequence(requests)
    else if (requests[0]) void run(requests[0])
  }

  /** Sends right away within the usual limit; above it, asks first and sends only on confirmation. */
  const attempt = (targets: Row[], sequence: boolean) => {
    if (needsConfirm) setPending({ rows: targets, sequence, slippage: effectiveSlippage })
    else execute(targets, sequence)
  }

  const pendingRows = pending?.rows.filter((r) => r.price !== null) ?? []
  const pendingWorstCost = pendingRows.reduce(
    (sum, r) => sum + Math.abs(Number(r.item.size)) * (r.item.markPrice ?? 0) * ((pending?.slippage ?? 0) / 100),
    0,
  )

  const regionRestricted = useRegionRestricted()
  const onContract = useTradingOnContract() || regionRestricted
  const contractOnly = plan.positions.filter((p) => p.contractOnly)
  const l1 = useEnvironment().l1Name
  const anyInFlight = rows.some((r) => isInFlight(actions[r.item.id]))
  // An executed close stays locked until a later read of the account; if that read still lists the
  // position (partly filled, or capped by the quote limit) it can be sent again for the rest.
  const settling = (r: Row) => awaitingRefresh(actions[r.item.id], dataUpdatedAt)
  const closable = rows.filter((r) => r.price !== null && !isInFlight(actions[r.item.id]) && !settling(r))
  useRecheckAfterExecution(lastExecutedAt(rows.map((r) => actions[r.item.id])), () => {
    void queryClient.invalidateQueries({ queryKey: accountKey(accountIndex) })
  })
  const stepState: StepState = plan.positions.length === 0 ? 'empty' : anyInFlight ? 'active' : 'todo'

  return (
    <StepCard
      step={step}
      title="Close perp positions"
      description={`Each position is closed with a reduce-only market order for the whole position (Lighter caps very large ones to the market's quote limit; send again if a remainder shows). The price is a bound on the average fill price: the order fills against the live book and stops if going further would push the average past it, leaving the rest open for another try.${
        onContract
          ? ` Each order is a transaction your wallet sends to the Lighter contract on ${l1}: it costs gas, and Lighter executes it a couple of minutes after it confirms, against the book as it is then.${
              regionRestricted ? ' Lighter does not accept API transactions from your region, so this goes through the contract.' : ''
            }`
          : ` Orders go to Lighter's API from your browser. If your browser cannot reach it, each order is sent as a transaction to the Lighter contract on ${l1} instead: it costs gas, and Lighter executes it a couple of minutes after it confirms.`
      }`}
      state={stepState}
    >
      {plan.positions.length === 0 ? (
        <Notice>No open perp positions. Spot balances don&apos;t need closing; withdraw them in step 5.</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          {!slippageValid && (
            <Notice tone="warn">Slippage must be between 0.1% and {SLIPPAGE_MAX}%. Using {DEFAULT_SLIPPAGE}% until fixed.</Notice>
          )}
          {needsConfirm && (
            <Notice tone="warn">
              Max slippage is above {SLIPPAGE_CONFIRM_ABOVE}%. Orders may fill far from the mark price, so you will be asked to confirm before anything is sent.
            </Notice>
          )}
          {contractOnly.length > 0 && !onContract && (
            <Notice tone="warn">
              {contractOnly.map((p) => p.symbol).join(', ')} can&apos;t be closed through the API from here, so{' '}
              {contractOnly.length === 1 ? 'that position is' : 'those positions are'} closed with a transaction to the Lighter
              contract on {l1}: it costs gas, and Lighter executes it a couple of minutes after it confirms.
            </Notice>
          )}
          {plan.positions.some((p) => p.openOrders > 0) && plan.openOrders > 0 && (
            <Notice tone="warn">Some of these markets still have open orders. Cancel them in step 1 first so they can&apos;t re-open the position.</Notice>
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
                <th className={COL_NUM_CLASSNAME}>Worst price</th>
                <th className={COL_STATUS_CLASSNAME}>Status</th>
                <th className={COL_ACTION_CLASSNAME} />
              </>
            }
          >
            {rows.map((row) => {
              const { item: p, price } = row
              const state = actions[p.id]
              const done = settling(row)
              const remainder = state?.status === 'executed' && !done
              return (
                <tr key={p.id} className={cn(done && 'opacity-60')}>
                  <td data-cell="primary" className="font-medium text-ink">
                    {p.symbol}
                    {p.isolated && <span className="ml-1.5 text-2xs text-meta uppercase">iso</span>}
                  </td>
                  <td data-label="Side" className={p.side === 'long' ? 'text-up' : 'text-down'}>{p.side}</td>
                  <td data-label="Size" className="text-right font-mono tabular-nums text-ink">{formatAmount(p.size, p.sizeDecimals)}</td>
                  <td data-mobile="hide" className="text-right font-mono tabular-nums text-dim">{formatAmount(p.entryPrice, p.priceDecimals)}</td>
                  <td data-label="Mark" className="text-right font-mono tabular-nums text-dim">
                    {p.markPrice !== null ? formatAmount(p.markPrice.toFixed(p.priceDecimals), p.priceDecimals) : '—'}
                  </td>
                  <td data-label="uPnL" className={cn('text-right font-mono tabular-nums', Number(p.unrealizedPnl) >= 0 ? 'text-up' : 'text-down')}>
                    {formatUsd(p.unrealizedPnl)}
                  </td>
                  <td data-label="Worst price" className="text-right font-mono tabular-nums text-ink">
                    {price !== null ? formatAmount(fromBaseUnits(price, p.priceDecimals), p.priceDecimals) : '—'}
                  </td>
                  <td data-label="Status" className="text-right">
                    <StatusPill state={state} />
                  </td>
                  <td data-cell="action" className="text-right">
                    <button
                      type="button"
                      disabled={!canAct || price === null || isInFlight(state) || done}
                      title={!canAct ? (reason ?? undefined) : undefined}
                      onClick={() => attempt([row], false)}
                      className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_FIXED_CLASSNAME)}
                    >
                      {done ? 'Closed' : remainder ? 'Close rest' : 'Close'}
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
          <ActionLines states={rows.map((r) => actions[r.item.id])} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <button
              type="button"
              disabled={!canAct || closable.length === 0 || anyInFlight}
              title={!canAct ? (reason ?? undefined) : undefined}
              onClick={() => attempt(closable, true)}
              className={BTN_PRIMARY_CLASSNAME}
            >
              Close all {closable.length > 1 ? `(${closable.length})` : ''}
            </button>
            {canAct && closable.length > 1 && <span className={HELPER_CLASSNAME}>
                {onContract ? 'One wallet confirmation per position, one after another.' : 'Positions are closed one after another.'}
              </span>}
            {/* Beside the buttons it prices; the Worst price column follows it. */}
            <label className={cn(LABEL_CLASSNAME, 'ml-auto flex items-center gap-2 max-mobile:ml-0 max-mobile:w-full max-mobile:justify-between')}>
              Max slippage
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={0.1}
                  max={SLIPPAGE_MAX}
                  step={0.5}
                  value={slippageText}
                  onChange={(e) => setSlippageText(e.target.value)}
                  aria-invalid={!slippageValid}
                  className={cn(INPUT_CLASSNAME, 'h-8 w-20 px-2 text-right font-mono text-sm normal-case')}
                />
                %
              </span>
            </label>
          </div>
          <ConfirmDialog
            open={pending !== null}
            title={`Close with ${pending?.slippage ?? 0}% max slippage?`}
            confirmLabel={pendingRows.length > 1 ? `Send ${pendingRows.length} orders anyway` : 'Send order anyway'}
            onCancel={() => setPending(null)}
            onConfirm={() => {
              if (pending) execute(pending.rows, pending.sequence)
              setPending(null)
            }}
          >
            <p>
              You set the max slippage to <span className="font-medium text-warn">{pending?.slippage}%</span>, above the
              usual {SLIPPAGE_CONFIRM_ABOVE}% limit. Each order may fill at an average price up to that far from the
              mark price. On a thin order book this could cost up to about{' '}
              <span className="font-medium text-warn">{formatUsd(pendingWorstCost)}</span> compared with closing at mark.
            </p>
            <ul className="flex flex-col gap-1.5 rounded-card border-[0.5px] border-line bg-fill px-3 py-2.5">
              {pendingRows.map((r) => (
                <li key={r.item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className="font-medium text-ink">
                    {r.item.symbol} <span className={r.item.side === 'long' ? 'text-up' : 'text-down'}>{r.item.side}</span>
                  </span>
                  <span className="font-mono text-2xs tabular-nums text-dim">
                    mark {r.item.markPrice !== null ? formatAmount(r.item.markPrice.toFixed(r.item.priceDecimals), r.item.priceDecimals) : '—'}
                    {' → '}worst{' '}
                    <span className="text-ink">
                      {r.price !== null ? formatAmount(fromBaseUnits(r.price, r.item.priceDecimals), r.item.priceDecimals) : '—'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p>Lower the max slippage to {SLIPPAGE_CONFIRM_ABOVE}% or less to send without this check.</p>
          </ConfirmDialog>
        </div>
      )}
    </StepCard>
  )
}
