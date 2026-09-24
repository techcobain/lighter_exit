// Turns a Lighter account snapshot into the list of things that must happen
// for it to be empty: orders to cancel, positions to close, pool shares to
// burn, stake to unstake, balances to withdraw.

import { ACCOUNT_TYPE, ROUTE_PERP, ROUTE_SPOT } from './config'
import { absDecimal, compareDecimal, isPositiveDecimal, toBaseUnits } from './units'

import type { AssetDetails, DetailedAccount, MarketDetails, PendingUnlock, PoolInfo } from './types'

export interface ClosePositionItem {
  id: string
  marketId: number
  symbol: string
  side: 'long' | 'short'
  /** Absolute size as reported by Lighter, in display units. */
  size: string
  sizeDecimals: number
  priceDecimals: number
  markPrice: number | null
  entryPrice: string
  positionValue: string
  unrealizedPnl: string
  openOrders: number
  isolated: boolean
  /** Size in market base units (what createOrder takes). */
  baseAmount: bigint
  /** 1 to sell (close a long), 0 to buy (close a short). */
  isAsk: 0 | 1
  /** Set when the market is missing or halted. */
  blocked: string | null
}

export interface PoolShareItem {
  id: string
  poolIndex: number
  poolName: string
  poolType: number | null
  shares: bigint
  principal: string
}

export interface WithdrawItem {
  id: string
  assetId: number
  symbol: string
  route: typeof ROUTE_PERP | typeof ROUTE_SPOT
  amount: string
  decimals: number
  units: bigint
  minWithdrawal: string
  belowMinimum: boolean
  lockedInOrders: string
}

export interface ExitPlan {
  openOrders: number
  positions: ClosePositionItem[]
  poolShares: PoolShareItem[]
  stakes: PoolShareItem[]
  /** Shares whose pool type is still loading. */
  unknownPools: PoolShareItem[]
  withdrawals: WithdrawItem[]
  pendingUnlocks: PendingUnlock[]
  /** True when there is nothing left on the account, apart from dust. */
  isEmpty: boolean
  dustOnly: boolean
}

const USDC_ASSET_ID = 3

/**
 * How much of a pool account's value is the operator's. Depositors' shares back
 * the rest and are never the operator's to withdraw. A frozen pool with no
 * shares left holds only leftovers, which the operator may move out.
 */
export function operatorValue(account: DetailedAccount): { yours: number; depositors: number; total: number } {
  const total = Number(account.total_asset_value) || 0
  const info = account.pool_info
  if (!info) return { yours: total, depositors: 0, total }
  if (info.total_shares <= 0) return { yours: total, depositors: 0, total }
  const yours = (total * info.operator_shares) / info.total_shares
  return { yours, depositors: total - yours, total }
}

export function buildPlan(
  account: DetailedAccount,
  markets: Map<number, MarketDetails>,
  assets: Map<number, AssetDetails>,
  pools: Record<number, PoolInfo | undefined>,
): ExitPlan {
  const positions: ClosePositionItem[] = []
  for (const p of account.positions ?? []) {
    if (!isPositiveDecimal(absDecimal(p.position))) continue
    const market = markets.get(p.market_id)
    const sizeDecimals = market?.supported_size_decimals ?? 0
    const priceDecimals = market?.supported_price_decimals ?? 0
    const mark = market?.mark_price ? Number(market.mark_price) : null
    const side = p.sign < 0 ? 'short' : 'long'
    let blocked: string | null = null
    if (!market) blocked = 'Market metadata unavailable'
    else if (market.status && market.status !== 'active') blocked = `Market is ${market.status}`
    positions.push({
      id: `pos-${account.index}-${p.market_id}`,
      marketId: p.market_id,
      symbol: p.symbol || market?.symbol || `#${p.market_id}`,
      side,
      size: absDecimal(p.position),
      sizeDecimals,
      priceDecimals,
      markPrice: mark && Number.isFinite(mark) && mark > 0 ? mark : null,
      entryPrice: p.avg_entry_price,
      positionValue: p.position_value,
      unrealizedPnl: p.unrealized_pnl,
      openOrders: p.open_order_count ?? 0,
      isolated: p.margin_mode === 1,
      baseAmount: market ? toBaseUnits(absDecimal(p.position), sizeDecimals) : 0n,
      isAsk: side === 'long' ? 1 : 0,
      blocked,
    })
  }

  const poolShares: PoolShareItem[] = []
  const stakes: PoolShareItem[] = []
  const unknownPools: PoolShareItem[] = []
  for (const s of account.shares ?? []) {
    if (!s.shares_amount || s.shares_amount <= 0) continue
    const info = pools[s.public_pool_index]
    const item: PoolShareItem = {
      id: `shares-${account.index}-${s.public_pool_index}`,
      poolIndex: s.public_pool_index,
      poolName: info?.name || (info?.account_type === ACCOUNT_TYPE.STAKING_POOL ? 'Staking pool' : `Pool ${s.public_pool_index}`),
      poolType: info?.account_type ?? null,
      shares: BigInt(s.shares_amount),
      principal: s.principal_amount,
    }
    if (!info) unknownPools.push(item)
    else if (info.account_type === ACCOUNT_TYPE.STAKING_POOL) stakes.push(item)
    else poolShares.push(item)
  }

  const withdrawals: WithdrawItem[] = []
  const pushWithdrawal = (
    assetId: number,
    symbol: string,
    route: typeof ROUTE_PERP | typeof ROUTE_SPOT,
    amount: string,
    locked: string,
  ) => {
    if (!isPositiveDecimal(amount)) return
    const asset = assets.get(assetId)
    const decimals = asset?.decimals ?? 6
    const minWithdrawal = asset?.min_withdrawal_amount ?? '0'
    withdrawals.push({
      id: `wd-${account.index}-${assetId}-${route}`,
      assetId,
      symbol: symbol || asset?.symbol || `asset ${assetId}`,
      route,
      amount,
      decimals,
      units: toBaseUnits(amount, decimals),
      minWithdrawal,
      belowMinimum: isPositiveDecimal(minWithdrawal) && compareDecimal(amount, minWithdrawal) < 0,
      lockedInOrders: locked,
    })
  }
  for (const a of account.assets ?? []) {
    pushWithdrawal(a.asset_id, a.symbol, ROUTE_SPOT, a.balance, a.locked_balance ?? '0')
    // Perps collateral: USDC is reported on the account itself; other
    // margin-enabled assets carry their own margin_balance.
    if (a.asset_id !== USDC_ASSET_ID && a.margin_mode === 'enabled') {
      pushWithdrawal(a.asset_id, a.symbol, ROUTE_PERP, a.margin_balance, '0')
    }
  }
  const usdc = assets.get(USDC_ASSET_ID)
  if (isPositiveDecimal(account.available_balance)) {
    pushWithdrawal(USDC_ASSET_ID, usdc?.symbol ?? 'USDC', ROUTE_PERP, account.available_balance, '0')
  }
  withdrawals.sort((a, b) => a.route - b.route || a.assetId - b.assetId)

  const openOrders = Math.max(account.total_order_count ?? 0, 0)
  const pendingUnlocks = account.pending_unlocks ?? []
  const withdrawable = withdrawals.filter((w) => !w.belowMinimum)
  const isEmpty =
    openOrders === 0 &&
    positions.length === 0 &&
    poolShares.length === 0 &&
    stakes.length === 0 &&
    unknownPools.length === 0 &&
    withdrawable.length === 0 &&
    pendingUnlocks.length === 0
  const dustOnly = isEmpty && withdrawals.length > 0

  return {
    openOrders,
    positions,
    poolShares,
    stakes,
    unknownPools,
    withdrawals,
    pendingUnlocks,
    isEmpty,
    dustOnly,
  }
}
