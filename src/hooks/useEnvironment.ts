import { useMemo, useSyncExternalStore } from 'react'

import { useQueries } from '@tanstack/react-query'

import {
  ENVIRONMENT_LIST,
  activeEnvironment,
  subscribeEnvironment,
  type EnvironmentId,
  type LighterEnvironment,
  type PresenceStatus,
} from '../lib/environments'
import { fetchAccountsByL1Address } from '../lib/lighterApi'

import { accountsKey } from './useLighterData'

import type { DetailedAccount } from '../lib/types'

/** The Lighter deployment the page is currently working on. */
export function useEnvironment(): LighterEnvironment {
  return useSyncExternalStore(subscribeEnvironment, activeEnvironment, activeEnvironment)
}

export interface EnvironmentPresence {
  env: LighterEnvironment
  status: PresenceStatus
  accounts: DetailedAccount[]
  error: unknown
}

/**
 * Looks an address up on every deployment at once. Shares its cache entries
 * with useAccountsByAddress, so the deployment that ends up shown is not
 * fetched twice.
 */
export function useEnvironmentPresence(address: string | undefined): Record<EnvironmentId, EnvironmentPresence> {
  const results = useQueries({
    queries: ENVIRONMENT_LIST.map((env) => ({
      queryKey: accountsKey(address, env.id),
      queryFn: () => fetchAccountsByL1Address(address!, env),
      enabled: !!address,
      staleTime: 15_000,
    })),
  })
  return useMemo(() => {
    const out = {} as Record<EnvironmentId, EnvironmentPresence>
    ENVIRONMENT_LIST.forEach((env, i) => {
      const r = results[i]
      const accounts = r?.data ?? []
      // Accounts already seen stay "found" even if a later refetch fails.
      const status: PresenceStatus = accounts.length > 0 ? 'found' : !r || r.isPending ? 'pending' : r.isError ? 'error' : 'empty'
      out[env.id] = { env, status, accounts, error: r?.error ?? null }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => `${r.status}:${r.dataUpdatedAt}:${r.errorUpdatedAt}`).join(',')])
}
