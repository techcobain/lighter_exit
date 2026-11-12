import { type ReactNode } from 'react'

import cn from '../lib/cn'
import { PAGE_CRISP_SURFACE_CLASSNAME, PROSE_CLASSNAME } from '../lib/recipes'

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
  children,
}: {
  step: number
  title: string
  description?: ReactNode
  state: StepState
  children?: ReactNode
}) {
  return (
    <section
      className={cn(
        PAGE_CRISP_SURFACE_CLASSNAME,
        'flex flex-col gap-5 rounded-panel p-6 max-mobile:p-4',
        state === 'empty' && 'opacity-70',
      )}
    >
      {/* Everything in the card shares one left edge: the badge sits on the title line, not in a gutter. */}
      <header className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-card border-[0.5px] font-mono text-sm tabular-nums',
                state === 'done'
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-line bg-surface text-meta',
              )}
            >
              {state === 'done' ? '✓' : step}
            </span>
            <h2 className="min-w-0 pt-0.5 text-xl font-medium tracking-heading text-ink">{title}</h2>
          </div>
          <span
            className={cn(
              'mt-0.5 shrink-0 rounded-pill border-[0.5px] px-2 py-1 text-2xs font-medium tracking-caps uppercase whitespace-nowrap',
              STATE_CLASS[state],
            )}
          >
            {STATE_LABEL[state]}
          </span>
        </div>
        {description && <p className={cn(PROSE_CLASSNAME, 'text-sm leading-md text-dim')}>{description}</p>}
      </header>
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

/**
 * Data table for a step. Lines and text stop at the card's padding edge. On
 * phones each row becomes a small stacked block (see .stack-table in
 * index.css): the cell marked data-cell="primary" and the one marked
 * data-cell="action" share the first line, and every cell with a data-label
 * follows as a "label … value" line. data-mobile="hide" drops a cell there.
 */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <table className="stack-table w-full border-collapse border-b-[0.5px] border-line text-sm">
      <thead>
        <tr className="text-left text-2xs tracking-caps text-meta uppercase [&>th]:px-2 [&>th]:pb-2 [&>th]:font-medium [&>th]:whitespace-nowrap [&>th:first-child]:pl-0 [&>th:last-child]:pr-0">
          {head}
        </tr>
      </thead>
      <tbody className="[&>tr]:border-t-[0.5px] [&>tr]:border-line [&>tr>td]:px-2 [&>tr>td]:py-2.5 [&>tr>td]:align-middle [&>tr>td:first-child]:pl-0 [&>tr>td:last-child]:pr-0">
        {children}
      </tbody>
    </table>
  )
}
