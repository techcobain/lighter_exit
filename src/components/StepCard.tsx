import { type ReactNode } from 'react'

import cn from '../lib/cn'
import { PAGE_CRISP_SURFACE_CLASSNAME } from '../lib/recipes'

export type StepState = 'todo' | 'active' | 'done' | 'empty' | 'loading'

const STATE_LABEL: Record<StepState, string> = {
  todo: 'To do',
  active: 'In progress',
  done: 'Done',
  empty: 'Nothing to do',
  loading: 'Loading',
}

const STATE_CLASS: Record<StepState, string> = {
  todo: 'border-warn/30 bg-warn/10 text-warn',
  active: 'border-link/30 bg-link/10 text-link animate-small-pulse',
  done: 'border-success/30 bg-success/10 text-success',
  empty: 'border-line bg-fill text-faint',
  loading: 'border-line bg-fill text-faint animate-pulse',
}

export function StepCard({
  step,
  title,
  description,
  state,
  aside,
  children,
}: {
  step: number
  title: string
  description?: ReactNode
  state: StepState
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <section
      className={cn(
        PAGE_CRISP_SURFACE_CLASSNAME,
        'flex flex-col gap-5 rounded-panel p-6',
        state === 'empty' && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span
            className={cn(
              'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-card border-[0.5px] font-mono text-sm tabular-nums',
              state === 'done'
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-line bg-surface text-meta',
            )}
          >
            {state === 'done' ? '✓' : step}
          </span>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-medium tracking-heading text-ink">{title}</h2>
            {description && <p className="max-w-[60ch] text-sm leading-md text-dim">{description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={cn(
              'rounded-pill border-[0.5px] px-2 py-1 text-2xs font-medium tracking-caps uppercase whitespace-nowrap',
              STATE_CLASS[state],
            )}
          >
            {STATE_LABEL[state]}
          </span>
          {aside}
        </div>
      </div>
      {children}
    </section>
  )
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'warn' | 'danger' | 'success' | 'info'
  children: ReactNode
}) {
  const toneClass = {
    neutral: 'border-line bg-fill text-dim',
    warn: 'border-warn/20 bg-warn/10 text-warn',
    danger: 'border-danger/20 bg-danger/10 text-danger',
    success: 'border-success/20 bg-success/10 text-success',
    info: 'border-link/20 bg-link/10 text-link',
  }[tone]
  return (
    <div className={cn('rounded-card border-[0.5px] px-3 py-2.5 text-sm leading-md', toneClass)}>
      {children}
    </div>
  )
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-2xs tracking-caps text-meta uppercase [&>th]:px-2 [&>th]:pb-2 [&>th]:font-medium">
            {head}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t-[0.5px] [&>tr]:border-line [&>tr>td]:px-2 [&>tr>td]:py-2.5 [&>tr>td]:align-middle">
          {children}
        </tbody>
      </table>
    </div>
  )
}
