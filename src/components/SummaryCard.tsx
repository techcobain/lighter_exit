import { useEffect, useMemo, useState } from 'react'

import { useQueries } from '@tanstack/react-query'

import { useActions, isInFlight, type ActionState } from '../hooks/useActions'
import { accountKey, useAssets, useWithdrawalDelay } from '../hooks/useLighterData'
import cn from '../lib/cn'
import { UNSTAKE_PERIOD_DAYS } from '../lib/config'
import { accountTypeLabel, formatAmount, formatCountdown, formatDateTime } from '../lib/format'
import { fetchAccount } from '../lib/lighterApi'
import { LABEL_CLASSNAME, PAGE_CRISP_SURFACE_CLASSNAME } from '../lib/recipes'
import { toMillis } from '../lib/time'

import { ActionLine } from './ActionStatus'
import { Notice } from './StepCard'

import type { DetailedAccount } from '../lib/types'

const KIND_LABEL: Record<string, string> = {
  regkey: 'Signing keys registered',
  cancel: 'Order cancellations',
  pos: 'Positions closed',
  shares: 'Pool exits',
  unstake: 'Unstake requests',
  mv: 'Moved to main account',
  wd: 'Withdrawals',
  claim: 'Ethereum claims',
  freeze: 'Pool freezes',
  opburn: 'Operator share burns',
}

const KIND_ORDER = ['regkey', 'cancel', 'pos', 'shares', 'unstake', 'freeze', 'opburn', 'mv', 'wd', 'claim']

/** Action ids are `<kind>-…`; unstakes share the `shares-` prefix, so tell them apart by label. */
function kindOf(id: string, state: ActionState): string {
  const kind = id.split('-')[0] ?? ''
  if (kind === 'shares' && /^Unstake/i.test(state.label)) return 'unstake'
  return kind
}

export function SummaryCard({ accounts }: { accounts: DetailedAccount[] }) {
  const { actions } = useActions()
  const delay = useWithdrawalDelay()
  const assets = useAssets()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Fresh copies of every account, so unlocks started this session show up.
  const fresh = useQueries({
    queries: accounts.map((a) => ({
      queryKey: accountKey(a.index),
      queryFn: () => fetchAccount(a.index),
      initialData: a,
      staleTime: 10_000,
    })),
  })
  const liveAccounts = fresh.map((q, i) => q.data ?? accounts[i]!)

  const entries = Object.entries(actions).filter(([, s]) => s.status !== 'idle')
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; state: ActionState }[]>()
    for (const [id, state] of entries) {
      const kind = kindOf(id, state)
      if (!map.has(kind)) map.set(kind, [])
      map.get(kind)!.push({ id, state })
    }
    return [...map.entries()].sort(([a], [b]) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
  }, [entries])

  const executedWithdrawals = entries.filter(([id, s]) => id.startsWith('wd-') && s.status === 'executed')
  const failed = entries.filter(([, s]) => s.status === 'error' || s.status === 'l2-failed')
  const inFlight = entries.filter(([, s]) => isInFlight(s))
  const delayMs = (delay.data ?? 0) * 1000
  const unlocks = liveAccounts.flatMap((a) =>
    (a.pending_unlocks ?? []).map((u) => ({ account: a, ...u })),
  )

  const nothing = entries.length === 0 && unlocks.length === 0

  return (
    <section className={cn(PAGE_CRISP_SURFACE_CLASSNAME, 'flex flex-col gap-5 rounded-panel p-6')}>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-medium tracking-heading text-ink">Summary</h2>
        <p className="max-w-[60ch] text-sm leading-md text-dim">
          Everything processed in this session, and what still has to happen on Lighter&apos;s side before your funds are in your wallet.
        </p>
      </div>

      {nothing ? (
        <Notice>No actions yet. Work through the steps above; this card fills in as you go.</Notice>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className={LABEL_CLASSNAME}>Processed</span>
              <div className="flex flex-col divide-y-[0.5px] divide-line">
                {groups.map(([kind, items]) => {
                  const done = items.filter((x) => x.state.status === 'executed').length
                  const bad = items.filter((x) => x.state.status === 'error' || x.state.status === 'l2-failed').length
                  const busy = items.filter((x) => isInFlight(x.state)).length
                  const viaApi = items.filter((x) => x.state.route === 'api').length
                  return (
                    <div key={kind} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                      <span className="text-ink">
                        {KIND_LABEL[kind] ?? kind}
                        <span className="ml-2 text-2xs text-faint">{items.map((x) => x.state.label).join(', ')}</span>
                      </span>
                      <span className="font-mono text-2xs tabular-nums text-meta">
                        {done > 0 && <span className="text-success">{done} done</span>}
                        {busy > 0 && <span className="ml-2 text-link">{busy} in progress</span>}
                        {bad > 0 && <span className="ml-2 text-danger">{bad} failed</span>}
                        <span className="ml-2">
                          {viaApi === items.length ? 'via API' : viaApi === 0 ? 'via Ethereum' : 'API + Ethereum'}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {failed.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className={LABEL_CLASSNAME}>Needs attention</span>
              {failed.map(([id, s]) => (
                <ActionLine key={id} state={s} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className={LABEL_CLASSNAME}>What happens next</span>
            <ul className="flex flex-col gap-2 text-sm leading-md text-dim">
              {inFlight.length > 0 && (
                <li>
                  <span className="text-link">{inFlight.length}</span> action{inFlight.length === 1 ? ' is' : 's are'} still being processed. Keep this tab open; each one updates in its step above.
                </li>
              )}
              {executedWithdrawals.map(([id, s]) => {
                const eta = s.updatedAt + delayMs
                const remaining = eta - now
                return (
                  <li key={id}>
                    <span className="text-ink">{s.label}</span>: Lighter&apos;s secure withdrawal delay is{' '}
                    {delay.data ? `${Math.max(1, Math.round(delay.data / 60))} min` : 'unknown'}, so expect the tokens in your wallet around{' '}
                    <span className="font-mono tabular-nums text-ink">{formatDateTime(eta)}</span>
                    {remaining > 0 ? (
                      <> (in <span className="font-mono tabular-nums text-warn">{formatCountdown(remaining)}</span>).</>
                    ) : (
                      <span className="text-success"> (should have arrived).</span>
                    )}{' '}
                    If they don&apos;t show up, they will appear in step 6 instead; that card checks the contract every 30 seconds and you claim them with one Ethereum transaction.
                  </li>
                )
              })}
              {unlocks.map((u, i) => {
                const asset = assets.data?.get(u.asset_index)
                const remaining = toMillis(u.unlock_timestamp) - now
                return (
                  <li key={`${u.account.index}-${u.unlock_timestamp}-${i}`}>
                    <span className="text-ink">
                      Unstaking {formatAmount(u.amount, asset?.decimals ?? 8)} {asset?.symbol ?? `asset ${u.asset_index}`}
                    </span>{' '}
                    on {u.account.name || accountTypeLabel(u.account.account_type)} #{u.account.index}: unlocks{' '}
                    <span className="font-mono tabular-nums text-ink">{formatDateTime(u.unlock_timestamp)}</span>
                    {remaining > 0 ? (
                      <> (in <span className="font-mono tabular-nums text-warn">{formatCountdown(remaining)}</span>)</>
                    ) : (
                      <span className="text-success"> (ready)</span>
                    )}
                    . The {UNSTAKE_PERIOD_DAYS}-day period ends with the {asset?.symbol ?? 'asset'} credited to that account&apos;s spot balance. Come back then, select the account and withdraw it in step 5, then wait the withdrawal delay again.
                  </li>
                )
              })}
              {executedWithdrawals.length === 0 && unlocks.length === 0 && inFlight.length === 0 && (
                <li>Nothing pending on Lighter&apos;s side. Anything still listed in the steps above is yours to send.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
