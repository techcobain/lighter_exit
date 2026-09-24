import { useMemo } from 'react'

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
}: {
  accounts: DetailedAccount[]
  names?: Map<number, string>
  namesPending?: boolean
  selected: number
  onSelect: (index: number) => void
}) {
  const sorted = useMemo(() => sortAccounts(accounts), [accounts])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={LABEL_CLASSNAME}>{accounts.length} Lighter accounts under this address</span>
        <span className="flex items-center gap-3 text-2xs text-faint">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-warn" /> still holds something
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" /> empty
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((a) => {
          const active = a.index === selected
          const busy = accountHasSomething(a)
          const isMain = a.account_type === ACCOUNT_TYPE.MASTER
          const name = accountDisplayName(a, names)
          return (
            <button
              key={a.index}
              type="button"
              onClick={() => onSelect(a.index)}
              className={cn(
                'flex items-center gap-2.5 rounded-modal border-[0.5px] px-3 py-2 text-left transition-colors',
                active ? 'border-ink/30 bg-ink/10 text-ink' : 'border-line bg-fill text-dim hover:bg-ink/6 hover:text-ink',
              )}
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', busy ? 'bg-warn' : 'bg-success')} aria-hidden />
              <span className="flex flex-col">
                <span className="text-sm font-medium">
                  {name}
                  {!isMain && name !== accountTypeLabel(a.account_type) && (
                    <span className="ml-1.5 text-2xs font-normal text-meta">{accountTypeLabel(a.account_type)}</span>
                  )}
                </span>
                <span className="font-mono text-2xs text-meta">
                  #{a.index} · {formatUsd(operatorValue(a).yours)}
                  {a.account_type === ACCOUNT_TYPE.PUBLIC_POOL && operatorValue(a).depositors > 0.005 && (
                    <span className="text-faint"> · {formatUsd(operatorValue(a).depositors)} depositors&apos;</span>
                  )}
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
