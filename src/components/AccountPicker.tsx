import { type ReactNode } from 'react'

import cn from '../lib/cn'
import { ACCOUNT_TYPE } from '../lib/config'
import { accountTypeLabel, formatUsd } from '../lib/format'
import { operatorValue } from '../lib/plan'
import { LABEL_CLASSNAME } from '../lib/recipes'

import type { DetailedAccount } from '../lib/types'

export function accountHasSomething(a: DetailedAccount): boolean {
  // For pools only the operator's part counts; depositors' money is not the owner's to act on.
  const isPool = a.account_type === ACCOUNT_TYPE.PUBLIC_POOL
  return (
    (a.positions?.length ?? 0) > 0 ||
    (a.shares?.some((s) => s.shares_amount > 0) ?? false) ||
    (a.total_order_count ?? 0) > 0 ||
    (a.pending_unlocks?.length ?? 0) > 0 ||
    (isPool ? operatorValue(a).yours > 0.005 : Number(a.total_asset_value) > 0) ||
    (!isPool && (a.assets?.some((x) => Number(x.balance) > 0) ?? false))
  )
}

/** Display name: Lighter's name when set (pools always, others once authenticated), else the type. */
export function accountDisplayName(a: DetailedAccount, names?: Map<number, string>): string {
  return names?.get(a.index) || a.name || accountTypeLabel(a.account_type)
}

/** Main account first, then by value held, descending. */
export function sortAccounts(accounts: DetailedAccount[]): DetailedAccount[] {
  return [...accounts].sort((a, b) => {
    const am = a.account_type === ACCOUNT_TYPE.MASTER ? 1 : 0
    const bm = b.account_type === ACCOUNT_TYPE.MASTER ? 1 : 0
    if (am !== bm) return bm - am
    return operatorValue(b).yours - operatorValue(a).yours || a.index - b.index
  })
}

export function AccountPicker({
  accounts,
  names,
  namesPending,
  selected,
  onSelect,
  tag,
}: {
  accounts: DetailedAccount[]
  names?: Map<number, string>
  namesPending?: boolean
  selected: number
  onSelect: (index: number) => void
  /** Deployment tag, when the page is not showing the deployment switch. */
  tag?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {tag}
          <span className={LABEL_CLASSNAME}>{accounts.length} accounts under this address</span>
        </span>
        <span className="flex items-center gap-3 text-2xs text-faint">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-warn" /> still holds something
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" /> empty
          </span>
        </span>
      </div>
      {/* Equal-width tiles, like the deployment switch, so any number of accounts fills tidy rows. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
        {accounts.map((a) => {
          const active = a.index === selected
          const busy = accountHasSomething(a)
          const isMain = a.account_type === ACCOUNT_TYPE.MASTER
          const name = accountDisplayName(a, names)
          const value = operatorValue(a)
          const depositors = a.account_type === ACCOUNT_TYPE.PUBLIC_POOL && value.depositors > 0.005 ? value.depositors : 0
          return (
            <button
              key={a.index}
              type="button"
              onClick={() => onSelect(a.index)}
              title={depositors > 0 ? `Your share ${formatUsd(value.yours)}; depositors hold another ${formatUsd(depositors)}` : undefined}
              className={cn(
                'flex min-w-0 items-start gap-2.5 rounded-modal border-[0.5px] px-3 py-2 text-left transition-colors',
                active ? 'border-ink/30 bg-ink/10 text-ink' : 'border-line bg-fill text-dim hover:bg-ink/6 hover:text-ink',
              )}
            >
              <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', busy ? 'bg-warn' : 'bg-success')} aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {name}
                  {!isMain && name !== accountTypeLabel(a.account_type) && (
                    <span className="ml-1.5 text-2xs font-normal text-meta">{accountTypeLabel(a.account_type)}</span>
                  )}
                </span>
                <span className="flex items-baseline justify-between gap-3 font-mono text-2xs text-meta">
                  <span className="truncate">#{a.index}</span>
                  <span className={cn('shrink-0 tabular-nums', active && 'text-ink')}>{formatUsd(value.yours)}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {namesPending && <span className="text-2xs text-faint">Loading sub-account names…</span>}
      {!names && accounts.some((a) => a.account_type === ACCOUNT_TYPE.SUB) && (
        <span className="text-2xs text-faint">Sub-account names appear once the main account&apos;s API signing is unlocked.</span>
      )}
    </div>
  )
}
