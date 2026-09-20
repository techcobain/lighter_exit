import { useMemo } from 'react'

import { useReadContracts } from 'wagmi'
import { mainnet } from 'wagmi/chains'

import { useActions, isInFlight } from '../../hooks/useActions'
import { useL1Action, type L1ActionRequest } from '../../hooks/useL1Action'
import { useAssets } from '../../hooks/useLighterData'
import { isSamplePreview, previewState } from '../../dev/preview'
import cn from '../../lib/cn'
import { LIGHTER_CONTRACT } from '../../lib/config'
import { lighterAbi } from '../../lib/contract'
import { formatAmount } from '../../lib/format'
import { BTN_PRIMARY_CLASSNAME, BTN_ROW_CLASSNAME, BTN_SECONDARY_CLASSNAME } from '../../lib/recipes'
import { fromBaseUnits } from '../../lib/units'
import { ActionLine, StatusPill } from '../ActionStatus'
import { Notice, StepCard, Table, type StepState } from '../StepCard'

export function PendingBalancesStep({
  address,
  canAct,
  reason,
}: {
  address: `0x${string}`
  canAct: boolean
  reason: string | null
}) {
  const assets = useAssets()
  const { actions } = useActions()
  const { run, runSequence } = useL1Action()
  const assetList = useMemo(
    () => [...(assets.data?.values() ?? [])].sort((a, b) => a.asset_id - b.asset_id),
    [assets.data],
  )

  const reads = useReadContracts({
    contracts: assetList.map((a) => ({
      address: LIGHTER_CONTRACT,
      abi: lighterAbi,
      functionName: 'getPendingBalance' as const,
      args: [address, a.asset_id] as const,
      chainId: mainnet.id,
    })),
    query: { enabled: assetList.length > 0 && !isSamplePreview(), refetchInterval: 30_000 },
  })
  // In preview the fixture store is the source of truth; re-read it on every action change.
  const previewTick = Object.values(actions).filter((a) => a.status === 'executed').length

  const rows = useMemo(
    () =>
      assetList
        .map((a, i) => {
          const r = reads.data?.[i]
          const amount = isSamplePreview() ? (previewState.pendingL1.get(a.asset_id) ?? 0n) : r?.status === 'success' ? (r.result as bigint) : 0n
          return { asset: a, amount, id: `claim-${address.toLowerCase()}-${a.asset_id}` }
        })
        .filter((r) => r.amount > 0n),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, assetList, reads.data, previewTick],
  )

  const request = (row: (typeof rows)[number]): L1ActionRequest<'withdrawPendingBalance'> => ({
    id: row.id,
    label: `Claim ${row.asset.symbol}`,
    functionName: 'withdrawPendingBalance',
    args: [address, row.asset.asset_id, row.amount],
    l1Only: true,
  })

  const anyInFlight = rows.some((r) => isInFlight(actions[r.id]))
  const pending = rows.filter((r) => !isInFlight(actions[r.id]))
  const stepState: StepState = !isSamplePreview() && reads.isPending && assetList.length > 0 ? 'loading' : rows.length === 0 ? 'empty' : anyInFlight ? 'active' : 'todo'

  return (
    <StepCard
      step={6}
      title="Claim balances waiting on Ethereum"
      description="Sometimes a withdrawal can't be pushed to a wallet and Lighter parks it in the contract instead. Anything sitting there under your address is listed here; claiming is a plain Ethereum transaction and doesn't involve Lighter's servers. This card is checked every 30 seconds, so keep an eye on it after your withdrawals go through."
      state={stepState}
    >
      {rows.length === 0 ? (
        <Notice>{!isSamplePreview() && reads.isPending && assetList.length > 0 ? 'Reading the contract…' : 'Nothing is waiting to be claimed for this address.'}</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <Table
            head={
              <>
                <th>Asset</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Status</th>
                <th />
              </>
            }
          >
            {rows.map((r) => {
              const state = actions[r.id]
              return (
                <tr key={r.id}>
                  <td className="font-medium text-ink">{r.asset.symbol}</td>
                  <td className="text-right font-mono tabular-nums text-ink">
                    {formatAmount(fromBaseUnits(r.amount, r.asset.l1_decimals), 8)}
                  </td>
                  <td className="text-right">
                    <StatusPill state={state} />
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      disabled={!canAct || isInFlight(state)}
                      onClick={() => void run(request(r))}
                      className={cn(BTN_SECONDARY_CLASSNAME, BTN_ROW_CLASSNAME)}
                    >
                      Claim
                    </button>
                  </td>
                </tr>
              )
            })}
          </Table>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (actions[r.id] ? <ActionLine key={r.id} state={actions[r.id]} /> : null))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canAct || pending.length === 0 || anyInFlight}
              onClick={() => void runSequence(pending.map(request) as L1ActionRequest[])}
              className={BTN_PRIMARY_CLASSNAME}
            >
              Claim all
            </button>
            {!canAct && reason && <span className="text-sm text-faint">{reason}</span>}
          </div>
        </div>
      )}
    </StepCard>
  )
}
