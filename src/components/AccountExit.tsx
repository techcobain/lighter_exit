import { useEffect, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { isInFlight, useActions } from '../hooks/useActions'
import { accountKey, useExitPlan, useLighterAccount } from '../hooks/useLighterData'
import { useWalletGuard } from '../hooks/useWalletGuard'
import cn from '../lib/cn'
import { ACCOUNT_TYPE } from '../lib/config'
import { accountTypeLabel, formatAmount, formatCountdown, formatDateTime, formatUsd, shortenAddress } from '../lib/format'
import { LABEL_CLASSNAME } from '../lib/recipes'
import { toMillis } from '../lib/time'

import { SigningKeyCard } from './SigningKeyCard'
import { Notice } from './StepCard'
import { BurnSharesStep } from './steps/BurnSharesStep'
import { CancelOrdersStep } from './steps/CancelOrdersStep'
import { ClosePositionsStep } from './steps/ClosePositionsStep'
import { PoolWindDownStep } from './steps/PoolWindDownStep'
import { UnstakeStep } from './steps/UnstakeStep'
import { WithdrawStep } from './steps/WithdrawStep'

import type { DetailedAccount } from '../lib/types'

export function AccountExit({
  initial,
  master,
  displayName,
}: {
  initial: DetailedAccount
  master: DetailedAccount | undefined
  displayName?: string
}) {
  const accountQuery = useLighterAccount(initial.index, initial)
  const account = accountQuery.data ?? initial
  const { plan, isLoading, error, assets } = useExitPlan(account)
  const guard = useWalletGuard(account.l1_address)
  const { actions } = useActions()
  const queryClient = useQueryClient()
  const isPool = account.account_type === ACCOUNT_TYPE.PUBLIC_POOL

  // Poll faster while one of this account's transactions is being processed.
  const busy = Object.entries(actions).some(([id, s]) => id.includes(`-${account.index}`) && isInFlight(s))
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => void queryClient.invalidateQueries({ queryKey: accountKey(account.index) }), 15_000)
    return () => clearInterval(t)
  }, [busy, account.index, queryClient])

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ageSec = Math.max(0, Math.floor((now - accountQuery.dataUpdatedAt) / 1000))

  const canAct = guard.ready || !!guard.wrongChain
  const reason = guard.ready ? null : guard.reason

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-[0.5px] border-line pb-5">
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASSNAME}>
            {displayName || account.name || accountTypeLabel(account.account_type)} · #{account.index}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-5xl font-medium tracking-display text-ink tabular-nums">
              {formatUsd(account.total_asset_value)}
            </span>
            <span className="text-md text-meta">total value</span>
          </div>
          <span className="font-mono text-2xs text-faint">owner {shortenAddress(account.l1_address)}</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-faint">
          <span className={cn(accountQuery.isFetching && 'animate-pulse')}>
            {accountQuery.isFetching ? 'Refreshing…' : `Updated ${ageSec}s ago`}
          </span>
          <button type="button" onClick={() => void accountQuery.refetch()} className="cursor-pointer text-muted transition-colors hover:text-ink">
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <Notice tone="danger">Couldn&apos;t load market data from Lighter: {error instanceof Error ? error.message : String(error)}</Notice>
      )}
      {guard.wrongChain && <Notice tone="warn">{guard.reason}</Notice>}

      {plan && plan.pendingUnlocks.length > 0 && (
        <Notice tone="info">
          Unstaking in progress:{' '}
          {plan.pendingUnlocks.map((u, i) => {
            const asset = assets?.get(u.asset_index)
            const remaining = toMillis(u.unlock_timestamp) - now
            return (
              <span key={`${u.asset_index}-${u.unlock_timestamp}-${i}`}>
                {i > 0 && '; '}
                <span className="font-mono tabular-nums">{formatAmount(u.amount, asset?.decimals ?? 8)}</span>{' '}
                {asset?.symbol ?? `asset ${u.asset_index}`} unlocks {formatDateTime(u.unlock_timestamp)}
                {remaining > 0 ? ` (in ${formatCountdown(remaining)})` : ' (ready, refresh to see it in the spot balance)'}
              </span>
            )
          })}
        </Notice>
      )}

      {plan?.isEmpty && !isPool && (
        <Notice tone="success">
          {plan.dustOnly
            ? 'Everything that can be moved has been moved. Only balances below the withdrawal minimum remain.'
            : 'This account is empty. Nothing left to do here.'}
        </Notice>
      )}

      {isLoading || !plan ? (
        <div className="flex flex-col gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-panel border-[0.5px] border-line bg-fill" />
          ))}
        </div>
      ) : isPool ? (
        <div className="flex flex-col gap-5">
          <Notice tone="info">
            This is a public pool you operate. Its positions and orders are handled with the pool&apos;s own key; freezing and burning your operator shares are signed by your main account.
          </Notice>
          <SigningKeyCard accountIndex={account.index} label={`pool #${account.index}`} canAct={canAct} reason={reason} />
          <CancelOrdersStep accountIndex={account.index} plan={plan} canAct={canAct} reason={reason} />
          <ClosePositionsStep accountIndex={account.index} plan={plan} canAct={canAct} reason={reason} />
          <PoolWindDownStep pool={account} master={master} plan={plan} canAct={canAct} reason={reason} />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <SigningKeyCard accountIndex={account.index} canAct={canAct} reason={reason} />
          <CancelOrdersStep accountIndex={account.index} plan={plan} canAct={canAct} reason={reason} />
          <ClosePositionsStep accountIndex={account.index} plan={plan} canAct={canAct} reason={reason} />
          <BurnSharesStep accountIndex={account.index} plan={plan} canAct={canAct} reason={reason} />
          <UnstakeStep accountIndex={account.index} plan={plan} assets={assets} canAct={canAct} reason={reason} />
          <WithdrawStep accountIndex={account.index} plan={plan} canAct={canAct} reason={reason} master={account.account_type === ACCOUNT_TYPE.SUB ? master : undefined} />
        </div>
      )}
    </div>
  )
}
