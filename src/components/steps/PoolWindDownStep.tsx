import { useActions, isInFlight } from '../../hooks/useActions'
import { useExitAction } from '../../hooks/useExitAction'
import { accountKey } from '../../hooks/useLighterData'
import { useSigningKeys } from '../../hooks/useSigningKeys'
import { API_KEY_INDEX, POOL_STATUS, ROUTE_PERP, ROUTE_SPOT, TX_TYPE } from '../../lib/config'
import { formatAmount, formatUsd } from '../../lib/format'
import { BTN_PRIMARY_CLASSNAME, BTN_SECONDARY_CLASSNAME, LABEL_CLASSNAME } from '../../lib/recipes'
import { signBurnShares, signTransfer, signUpdatePublicPool } from '../../lib/signer'
import { isPositiveDecimal, toBaseUnits } from '../../lib/units'
import { ActionLine } from '../ActionStatus'
import { SigningKeyCard } from '../SigningKeyCard'
import { Notice, StepCard, type StepState } from '../StepCard'

import { operatorValue, type ExitPlan } from '../../lib/plan'
import type { DetailedAccount } from '../../lib/types'

/**
 * For a public pool the connected wallet operates: freeze it (an L2-only
 * request signed by the operator's main account), then burn the operator's
 * shares. Depositors burn their own shares from their own accounts; a frozen
 * pool lets the operator leave first regardless of the minimum share rate.
 */
export function PoolWindDownStep({
  pool,
  master,
  plan,
  canAct,
  reason,
}: {
  pool: DetailedAccount
  master: DetailedAccount | undefined
  plan: ExitPlan
  canAct: boolean
  reason: string | null
}) {
  const { actions } = useActions()
  const { keys, mode } = useSigningKeys()
  const { run } = useExitAction()
  const info = pool.pool_info
  const masterIndex = master?.index
  const masterKeyReady = masterIndex !== undefined && mode === 'api' && keys[masterIndex]?.stage === 'registered'
  const frozen = info?.status === POOL_STATUS.FROZEN
  const operatorShares = BigInt(info?.operator_shares ?? 0)
  const flat = plan.positions.length === 0 && plan.openOrders === 0
  const freezeId = `freeze-${pool.index}`
  const burnId = `opburn-${pool.index}`
  const sweepId = `sweep-${pool.index}`
  const freezeState = actions[freezeId]
  const burnState = actions[burnId]
  const sweepState = actions[sweepId]
  const totalShares = BigInt(info?.total_shares ?? 0)
  const remaining = isPositiveDecimal(pool.available_balance) ? pool.available_balance : '0'
  const hasRemaining = isPositiveDecimal(remaining)
  // Once every share is gone, whatever USDC is left (fees, rounding) may be moved out by the operator.
  const canSweep = frozen && totalShares === 0n && hasRemaining
  const poolKeyReady = mode === 'api' && keys[pool.index]?.stage === 'registered'

  const stepState: StepState = !info
    ? 'empty'
    : isInFlight(freezeState) || isInFlight(burnState) || isInFlight(sweepState)
      ? 'active'
      : canSweep
        ? 'todo'
        : operatorShares === 0n && frozen
          ? 'done'
          : 'todo'

  const sweep = () => {
    if (masterIndex === undefined || !canSweep) return
    void run({
      id: sweepId,
      label: 'Move leftover USDC to main account',
      accountIndex: pool.index,
      l2: {
        txType: TX_TYPE.TRANSFER,
        sign: (nonce) =>
          signTransfer({
            accountIndex: pool.index,
            toAccountIndex: masterIndex,
            assetIndex: 3,
            fromRouteType: ROUTE_PERP,
            toRouteType: ROUTE_SPOT,
            amount: toBaseUnits(remaining, 6),
            nonce,
            apiKeyIndex: API_KEY_INDEX,
          }),
      },
      invalidate: [accountKey(pool.index), accountKey(masterIndex)],
    })
  }

  const freeze = () => {
    if (masterIndex === undefined || !info) return
    void run({
      id: freezeId,
      label: 'Freeze pool',
      accountIndex: masterIndex,
      l2: {
        txType: TX_TYPE.UPDATE_PUBLIC_POOL,
        sign: (nonce) =>
          signUpdatePublicPool({
            accountIndex: masterIndex,
            publicPoolIndex: pool.index,
            status: POOL_STATUS.FROZEN,
            // Same encoding the Lighter app uses: percent × 10000 and percent × 100.
            operatorFee: Math.round(Number(info.operator_fee) * 10000),
            minOperatorShareRate: Math.round(Number(info.min_operator_share_rate) * 100),
            nonce,
          }),
      },
      invalidate: [accountKey(pool.index)],
    })
  }

  const burn = () => {
    if (masterIndex === undefined || operatorShares === 0n) return
    void run({
      id: burnId,
      label: 'Burn operator shares',
      accountIndex: masterIndex,
      l2: {
        txType: TX_TYPE.BURN_SHARES,
        sign: (nonce) => signBurnShares({ accountIndex: masterIndex, publicPoolIndex: pool.index, shareAmount: operatorShares, nonce }),
      },
      l1: {
        id: burnId,
        label: 'Burn operator shares',
        functionName: 'burnShares',
        args: [masterIndex, pool.index, operatorShares],
        invalidate: [accountKey(pool.index), accountKey(masterIndex)],
      },
      invalidate: [accountKey(pool.index), accountKey(masterIndex)],
    })
  }

  return (
    <StepCard
      step={3}
      title="Wind the pool down"
      description="A pool has no delete button. Once it holds no positions or orders, freeze it: depositors can then only burn, and you, as operator, may burn all of your shares even while others still hold theirs. Freezing is signed by your main account and only exists as an API request; burning falls back to the Ethereum contract if the API refuses."
      state={stepState}
    >
      {!info ? (
        <Notice>Pool details unavailable.</Notice>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 max-mobile:grid-cols-1">
            <Stat label="Status" value={frozen ? 'Frozen' : 'Active'} tone={frozen ? 'text-warn' : 'text-success'} />
            <Stat label="Your share of the pool" value={formatUsd(operatorValue(pool).yours)} />
            <Stat label="Depositors' share" value={formatUsd(operatorValue(pool).depositors)} tone="text-dim" />
            <Stat label="Your operator shares" value={`${formatAmount(operatorShares.toString(), 0)} of ${formatAmount(String(info.total_shares), 0)}`} />
          </div>

          {masterIndex === undefined ? (
            <Notice tone="warn">The main account that operates this pool was not found under this wallet.</Notice>
          ) : (
            <SigningKeyCard accountIndex={masterIndex} label={`main account #${masterIndex}`} canAct={canAct} reason={reason} compact />
          )}

          <div className="flex flex-col gap-3">
            <span className={LABEL_CLASSNAME}>1 · Freeze</span>
            {frozen ? (
              <p className="text-sm text-success">Pool is frozen. No new deposits; only burns are allowed.</p>
            ) : (
              <>
                {!flat && (
                  <Notice tone="warn">Close the pool&apos;s positions and cancel its orders (cards 1 and 2 above) before freezing.</Notice>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!canAct || !masterKeyReady || !flat || isInFlight(freezeState)}
                    onClick={freeze}
                    className={BTN_PRIMARY_CLASSNAME}
                  >
                    Freeze pool
                  </button>
                  {!masterKeyReady && canAct && (
                    <span className="text-sm text-faint">
                      {mode === 'l1' ? 'Freezing needs the API; switch back to it.' : 'Unlock API signing for the main account first.'}
                    </span>
                  )}
                </div>
                <ActionLine state={freezeState} />
              </>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <span className={LABEL_CLASSNAME}>2 · Burn your operator shares</span>
            {operatorShares === 0n ? (
              <p className="text-sm text-success">No operator shares left in this pool.</p>
            ) : (
              <>
                <p className="max-w-[60ch] text-sm leading-md text-dim">
                  Burns all {formatAmount(operatorShares.toString(), 0)} operator shares back to your main account&apos;s
                  perps collateral. {!frozen && 'While the pool is active, Lighter keeps you above the minimum operator share rate, so the burn may be rejected until you freeze.'}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!canAct || isInFlight(burnState) || (mode === 'api' && !masterKeyReady)}
                    onClick={burn}
                    className={frozen ? BTN_PRIMARY_CLASSNAME : BTN_SECONDARY_CLASSNAME}
                  >
                    Burn operator shares
                  </button>
                  {!canAct && reason && <span className="text-sm text-faint">{reason}</span>}
                </div>
                <ActionLine state={burnState} />
              </>
            )}
          </div>

          {frozen && operatorShares === 0n && totalShares > 0n && hasRemaining && (
            <Notice>
              {formatUsd(remaining)} remains in the pool, but it belongs to the depositors who still hold{' '}
              {formatAmount(totalShares.toString(), 0)} shares. Nothing here is yours to withdraw; each depositor burns their shares from their own account
              (this page&apos;s step 3 when they connect). Once all shares are gone, any leftover can be moved out from here.
            </Notice>
          )}

          {canSweep && (
            <div className="flex flex-col gap-3">
              <span className={LABEL_CLASSNAME}>3 · Move the leftover out</span>
              <p className="max-w-[60ch] text-sm leading-md text-dim">
                All shares are burned and {formatUsd(remaining)} USDC is left in the pool (fees and rounding). Lighter allows a frozen, share-less pool
                to transfer it; this sends it to your main account&apos;s spot balance, signed with the pool&apos;s key (step 0 above).
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={!canAct || !poolKeyReady || isInFlight(sweepState)} onClick={sweep} className={BTN_PRIMARY_CLASSNAME}>
                  Move {formatUsd(remaining)} to main account
                </button>
                {!poolKeyReady && canAct && <span className="text-sm text-faint">Unlock API signing for the pool first.</span>}
              </div>
              <ActionLine state={sweepState} />
            </div>
          )}
        </div>
      )}
    </StepCard>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border-[0.5px] border-line bg-surface/60 px-3 py-2.5">
      <span className={LABEL_CLASSNAME}>{label}</span>
      <span className={`font-mono text-md tabular-nums ${tone ?? 'text-ink'}`}>{value}</span>
    </div>
  )
}
