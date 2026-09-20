import { useActions, isInFlight } from '../../hooks/useActions'
import { useExitAction } from '../../hooks/useExitAction'
import { accountKey } from '../../hooks/useLighterData'
import { TX_TYPE } from '../../lib/config'
import { BTN_PRIMARY_CLASSNAME } from '../../lib/recipes'
import { signCancelAllOrders } from '../../lib/signer'
import { ActionLine } from '../ActionStatus'
import { Notice, StepCard, type StepState } from '../StepCard'

import type { ExitPlan } from '../../lib/plan'

export function CancelOrdersStep({
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
  const { run } = useExitAction()
  const id = `cancel-${accountIndex}-all`
  const state = actions[id]
  const hasOrders = plan.openOrders > 0
  const stepState: StepState = hasOrders
    ? isInFlight(state)
      ? 'active'
      : 'todo'
    : state?.status === 'executed'
      ? 'done'
      : 'empty'

  return (
    <StepCard
      step={1}
      title="Cancel open orders"
      description="Resting orders lock collateral and can re-open a position you just closed. One request cancels every order on this account across all markets."
      state={stepState}
    >
      {hasOrders ? (
        <div className="flex flex-col gap-3">
          <p className="text-md text-ink">
            <span className="font-mono tabular-nums">{plan.openOrders}</span> open order
            {plan.openOrders === 1 ? '' : 's'} on this account.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canAct || isInFlight(state)}
              onClick={() =>
                void run({
                  id,
                  label: 'Cancel all orders',
                  accountIndex,
                  l2: {
                    txType: TX_TYPE.CANCEL_ALL_ORDERS,
                    sign: (nonce) => signCancelAllOrders({ accountIndex, nonce }),
                  },
                  l1: {
                    id,
                    label: 'Cancel all orders',
                    functionName: 'cancelAllOrders',
                    args: [accountIndex],
                    invalidate: [accountKey(accountIndex)],
                  },
                  invalidate: [accountKey(accountIndex)],
                })
              }
              className={BTN_PRIMARY_CLASSNAME}
            >
              Cancel all orders
            </button>
            {!canAct && reason && <span className="text-sm text-faint">{reason}</span>}
          </div>
          <ActionLine state={state} />
        </div>
      ) : (
        <>
          <ActionLine state={state} />
          {!state && <Notice>No open orders.</Notice>}
        </>
      )}
    </StepCard>
  )
}
