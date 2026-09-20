import { useMemo } from 'react'

import { useQueries, useQuery } from '@tanstack/react-query'

import { isPreview } from '../dev/preview'
import { API_KEY_INDEX } from '../lib/config'
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

export const accountsKey = (address: string | undefined) => ['accounts', address?.toLowerCase()] as const
export const accountKey = (index: number) => ['account', index] as const

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
    queryKey: ['accountNames', address?.toLowerCase(), tokenAccountIndex],
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

export function useMarkets() {
  return useQuery({
    queryKey: ['markets'],
    queryFn: fetchMarkets,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useAssets() {
  return useQuery({ queryKey: ['assets'], queryFn: fetchAssets, staleTime: 5 * 60_000 })
}

export function useWithdrawalDelay() {
  return useQuery({
    queryKey: ['withdrawalDelay'],
    queryFn: fetchWithdrawalDelaySeconds,
    staleTime: 10 * 60_000,
  })
}

export function usePools(indexes: number[]) {
  const results = useQueries({
    queries: indexes.map((index) => ({
      queryKey: ['pool', index],
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
