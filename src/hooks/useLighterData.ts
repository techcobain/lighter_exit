import { useMemo } from 'react'

import { useQueries, useQuery } from '@tanstack/react-query'

import { isPreview } from '../dev/preview'
import { API_KEY_INDEX } from '../lib/config'
import { activeEnvironment, type EnvironmentId } from '../lib/environments'
import { buildPlan } from '../lib/plan'
import { createAuthToken } from '../lib/signer'
import {
  fetchAccount,
  fetchAccountNames,
  fetchAccountsByL1Address,
  fetchAssets,
  fetchMarkets,
  fetchPoolInfo,
  fetchWithdrawalDelaySeconds,
} from '../lib/lighterApi'

import type { DetailedAccount, PoolInfo } from '../lib/types'

// Every key carries the deployment it was read from: account indexes, market
// ids and asset ids all repeat across deployments with different meanings.
const envId = (): EnvironmentId => activeEnvironment().id

export const accountsKey = (address: string | undefined, env: EnvironmentId = envId()) =>
  ['accounts', env, address?.toLowerCase()] as const
export const accountKey = (index: number) => ['account', envId(), index] as const

export function useAccountsByAddress(address: string | undefined) {
  return useQuery({
    queryKey: accountsKey(address),
    queryFn: () => fetchAccountsByL1Address(address!),
    enabled: !!address,
    staleTime: 15_000,
  })
}

/**
 * Names for the accounts under an address. Pool names are already on the
 * account objects; sub-account names need an auth token, available once any
 * account's signing key is registered.
 */
export function useAccountNames(address: string | undefined, tokenAccountIndex: number | undefined) {
  return useQuery({
    queryKey: ['accountNames', envId(), address?.toLowerCase(), tokenAccountIndex],
    queryFn: async () => {
      const token = isPreview ? 'preview' : (await createAuthToken(tokenAccountIndex!, API_KEY_INDEX)).token
      return fetchAccountNames(address!, token)
    },
    enabled: !!address && tokenAccountIndex !== undefined,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useLighterAccount(index: number | undefined, initial?: DetailedAccount) {
  return useQuery({
    queryKey: accountKey(index ?? -1),
    queryFn: () => fetchAccount(index!),
    enabled: index !== undefined,
    initialData: initial,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

/**
 * The latest copy of each account, in the order given. The by-address list is
 * fetched once; actions refresh the per-account queries, so anything that shows
 * what an account still holds (picker, summary) has to read those.
 */
export function useLiveAccounts(accounts: DetailedAccount[]): DetailedAccount[] {
  const results = useQueries({
    queries: accounts.map((a) => ({
      queryKey: accountKey(a.index),
      queryFn: () => fetchAccount(a.index),
      initialData: a,
      staleTime: 10_000,
    })),
  })
  return useMemo(
    () => results.map((r, i) => r.data ?? accounts[i]!),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, results.map((r) => r.dataUpdatedAt).join(',')],
  )
}

export function useMarkets() {
  return useQuery({
    queryKey: ['markets', envId()],
    queryFn: fetchMarkets,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useAssets() {
  return useQuery({ queryKey: ['assets', envId()], queryFn: fetchAssets, staleTime: 5 * 60_000 })
}

export function useWithdrawalDelay() {
  return useQuery({
    queryKey: ['withdrawalDelay', envId()],
    queryFn: fetchWithdrawalDelaySeconds,
    staleTime: 10 * 60_000,
  })
}

export function usePools(indexes: number[]) {
  const results = useQueries({
    queries: indexes.map((index) => ({
      queryKey: ['pool', envId(), index],
      queryFn: () => fetchPoolInfo(index),
      staleTime: Infinity,
    })),
  })
  return useMemo(() => {
    const map: Record<number, PoolInfo | undefined> = {}
    results.forEach((r, i) => {
      const index = indexes[i]
      if (index !== undefined && r.data) map[index] = r.data
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexes.join(','), results.map((r) => r.dataUpdatedAt).join(',')])
}

export function useExitPlan(account: DetailedAccount | undefined) {
  const markets = useMarkets()
  const assets = useAssets()
  const poolIndexes = useMemo(
    () => (account?.shares ?? []).filter((s) => s.shares_amount > 0).map((s) => s.public_pool_index),
    [account],
  )
  const pools = usePools(poolIndexes)
  const plan = useMemo(() => {
    if (!account || !markets.data || !assets.data) return null
    return buildPlan(account, markets.data, assets.data, pools)
  }, [account, markets.data, assets.data, pools])
  return {
    plan,
    isLoading: !plan && (markets.isPending || assets.isPending),
    error: markets.error ?? assets.error ?? null,
    markets: markets.data,
    assets: assets.data,
  }
}
