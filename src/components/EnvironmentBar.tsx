import { isInFlight, useActions } from '../hooks/useActions'
import cn from '../lib/cn'
import { ENVIRONMENT_LIST, type EnvironmentId, type LighterEnvironment } from '../lib/environments'
import { formatUsd } from '../lib/format'
import { operatorValue } from '../lib/plan'
import { LABEL_CLASSNAME } from '../lib/recipes'

import type { EnvironmentPresence } from '../hooks/useEnvironment'

/** Small label naming a Lighter deployment and the chain its contract is on. */
export function EnvironmentTag({ env, title }: { env: LighterEnvironment; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-pill border-[0.5px] border-line bg-fill px-2 py-1 text-2xs font-medium tracking-caps whitespace-nowrap text-ink uppercase"
    >
      <span className="size-1.5 rounded-full bg-link" aria-hidden />
      {env.tag}
    </span>
  )
}

function summary(p: EnvironmentPresence): string {
  switch (p.status) {
    case 'pending':
      return 'checking…'
    case 'error':
      return "couldn't check"
    case 'empty':
      return 'no account'
    case 'found': {
      const total = p.accounts.reduce((sum, a) => sum + operatorValue(a).yours, 0)
      return `${p.accounts.length} ${p.accounts.length === 1 ? 'account' : 'accounts'} · ${formatUsd(total)}`
    }
  }
}

/** What the lookup on the deployment that is not shown came back with, for the tag's tooltip. */
export function otherDeploymentNote(other: EnvironmentPresence): string {
  return other.status === 'pending'
    ? `Checking ${other.env.name} (${other.env.l1Name}) too…`
    : `This address has no account on ${other.env.name} (${other.env.l1Name}).`
}

/**
 * Two-way switch between the Lighter deployments. Rendered only when there is
 * something to choose (see offersSwitch); otherwise the page shows an
 * EnvironmentTag next to the account list instead.
 */
export function EnvironmentBar({
  presence,
  current,
  onSwitch,
}: {
  presence: Record<EnvironmentId, EnvironmentPresence>
  current: EnvironmentId
  onSwitch: (id: EnvironmentId) => void
}) {
  const { actions } = useActions()
  const busy = Object.values(actions).some(isInFlight)
  const shown = presence[current]
  const other = presence[current === 'mainnet' ? 'rh' : 'mainnet']

  const both = shown.status === 'found' && other.status === 'found'
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL_CLASSNAME}>
        {both ? 'This address has accounts on both Lighter deployments' : 'Lighter deployment'}
      </span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Lighter deployment">
        {ENVIRONMENT_LIST.map((env) => {
          const active = env.id === current
          return (
            <button
              key={env.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy && !active}
              onClick={() => !active && onSwitch(env.id)}
              className={cn(
                'flex min-w-[200px] flex-1 flex-col gap-0.5 rounded-modal border-[0.5px] px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50',
                active ? 'border-ink/30 bg-ink/10 text-ink' : 'border-line bg-fill text-dim hover:bg-ink/6 hover:text-ink',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-link' : 'bg-ink/20')} aria-hidden />
                {env.name}
                <span className="text-2xs font-normal text-meta">{env.l1Name}</span>
              </span>
              <span className="pl-3.5 font-mono text-2xs text-meta">{summary(presence[env.id])}</span>
            </button>
          )
        })}
      </div>
      <span className="text-2xs leading-md text-faint">
        {busy
          ? 'Wait for the running actions to finish before switching.'
          : 'These are separate exchanges, each with its own accounts, signing key and wallet network. Everything below applies to the selected one only.'}
      </span>
    </div>
  )
}
