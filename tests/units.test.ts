import { describe, expect, it } from 'vitest'

import { formatAmount } from '../src/lib/format'
import { toMillis } from '../src/lib/time'
import { buildPlan } from '../src/lib/plan'
import {
  compareDecimal,
  fromBaseUnits,
  isPositiveDecimal,
  toBaseUnits,
  worstPriceUnits,
} from '../src/lib/units'

import type { AssetDetails, DetailedAccount, MarketDetails } from '../src/lib/types'

describe('toBaseUnits', () => {
  it('scales by the market size decimals (0.0022 ETH → 22 with 4 decimals)', () => {
    expect(toBaseUnits('0.0022', 4)).toBe(22n)
  })
  it('handles integers, missing leading zero and truncation', () => {
    expect(toBaseUnits('382.7829', 4)).toBe(3827829n)
    expect(toBaseUnits('.5', 2)).toBe(50n)
    expect(toBaseUnits('4', 6)).toBe(4000000n)
    expect(toBaseUnits('4.00350259476', 6)).toBe(4003502n)
  })
  it('round-trips through fromBaseUnits', () => {
    expect(fromBaseUnits(4003502n, 6)).toBe('4.003502')
    expect(fromBaseUnits(22n, 4)).toBe('0.0022')
    expect(fromBaseUnits(0n, 8)).toBe('0')
  })
  it('rejects garbage', () => {
    expect(() => toBaseUnits('abc', 2)).toThrow()
  })
})

describe('decimal helpers', () => {
  it('compares and detects positives', () => {
    expect(compareDecimal('0.009', '1.0')).toBe(-1)
    expect(compareDecimal('2', '2.000')).toBe(0)
    expect(isPositiveDecimal('0.000000')).toBe(false)
    expect(isPositiveDecimal('0.000001')).toBe(true)
    expect(isPositiveDecimal('')).toBe(false)
  })
  it('formats amounts', () => {
    expect(formatAmount('1234567.891234567', 4)).toBe('1,234,567.8912')
    expect(formatAmount('4.000000')).toBe('4')
    expect(formatAmount('-0.5')).toBe('-0.5')
  })
})

describe('toMillis', () => {
  it('detects seconds, milliseconds and microseconds by magnitude', () => {
    expect(toMillis(1737098583)).toBe(1737098583000) // pool created_at (s)
    expect(toMillis(1790154438635)).toBe(1790154438635) // pending unlock (ms)
    expect(toMillis(1789899079318755)).toBe(1789899079318) // api key transaction_time (µs)
    expect(toMillis(0)).toBe(0)
  })
})

describe('worstPriceUnits', () => {
  it('goes below mark to close a long and above to close a short', () => {
    // ETH at 2579.52 with 2 price decimals, 3% slippage.
    expect(worstPriceUnits(2579.52, 2, 'long', 3)).toBe(250213n)
    expect(worstPriceUnits(2579.52, 2, 'short', 3)).toBe(265691n)
  })
  it('never returns zero', () => {
    expect(worstPriceUnits(0.00001, 2, 'long', 50)).toBe(1n)
  })
})

describe('buildPlan', () => {
  const markets = new Map<number, MarketDetails>([
    [
      0,
      {
        market_id: 0,
        symbol: 'ETH',
        market_type: 'perp',
        status: 'active',
        supported_size_decimals: 4,
        supported_price_decimals: 2,
        min_base_amount: '0.0020',
        mark_price: '2579.52',
      },
    ],
  ])
  const assets = new Map<number, AssetDetails>([
    [3, asset(3, 'USDC', 6, '1.000000')],
    [2, asset(2, 'LIT', 8, '1.00000000')],
    [1, asset(1, 'ETH', 8, '0.00100000')],
  ])
  const account: DetailedAccount = {
    index: 718994,
    account_index: 718994,
    account_type: 0,
    l1_address: '0x575D52804a214e276E6559fE11e7AeC0Ec93d437',
    status: 1,
    name: '',
    collateral: '0.005287',
    available_balance: '0.005287',
    total_asset_value: '0.005287',
    total_order_count: 0,
    pending_order_count: 0,
    positions: [
      {
        market_id: 0,
        symbol: 'ETH',
        sign: 1,
        position: '0.0022',
        avg_entry_price: '2500.00',
        position_value: '5.67',
        unrealized_pnl: '0.17',
        open_order_count: 0,
        margin_mode: 0,
        allocated_margin: '0',
        liquidation_price: '0',
      },
    ],
    assets: [
      { symbol: 'ETH', asset_id: 1, balance: '0.000099104', locked_balance: '0', margin_balance: '0', margin_mode: 'disabled' },
      { symbol: 'LIT', asset_id: 2, balance: '0.00906683', locked_balance: '0', margin_balance: '0', margin_mode: 'disabled' },
      { symbol: 'USDC', asset_id: 3, balance: '4.00350259476', locked_balance: '0', margin_balance: '0.005287', margin_mode: 'disabled' },
    ],
    shares: [
      { public_pool_index: 281474976624800, shares_amount: 194600, entry_usdc: '0', principal_amount: '2', entry_timestamp: 0 },
      { public_pool_index: 281474976710654, shares_amount: 10, entry_usdc: '0', principal_amount: '1', entry_timestamp: 0 },
    ],
    pending_unlocks: [],
  }

  it('produces close, burn, unstake and withdraw items in base units', () => {
    const plan = buildPlan(account, markets, assets, {
      281474976624800: { index: 281474976624800, name: '', account_type: 4 },
      281474976710654: { index: 281474976710654, name: 'LLP', account_type: 3 },
    })
    expect(plan.positions).toHaveLength(1)
    expect(plan.positions[0]?.baseAmount).toBe(22n)
    expect(plan.positions[0]?.isAsk).toBe(1)
    expect(plan.stakes.map((s) => s.poolIndex)).toEqual([281474976624800])
    expect(plan.poolShares.map((s) => s.poolName)).toEqual(['LLP'])
    const usdcSpot = plan.withdrawals.find((w) => w.assetId === 3 && w.route === 1)
    expect(usdcSpot?.units).toBe(4003502n)
    expect(usdcSpot?.belowMinimum).toBe(false)
    const usdcPerp = plan.withdrawals.find((w) => w.assetId === 3 && w.route === 0)
    expect(usdcPerp?.units).toBe(5287n)
    expect(usdcPerp?.belowMinimum).toBe(true)
    const lit = plan.withdrawals.find((w) => w.assetId === 2)
    expect(lit?.belowMinimum).toBe(true)
    expect(plan.isEmpty).toBe(false)
  })

  it('reports an account holding only dust as empty', () => {
    const plan = buildPlan(
      { ...account, positions: [], shares: [], available_balance: '0', assets: account.assets.filter((a) => a.asset_id !== 3) },
      markets,
      assets,
      {},
    )
    expect(plan.isEmpty).toBe(true)
    expect(plan.dustOnly).toBe(true)
  })
})

function asset(id: number, symbol: string, decimals: number, min: string): AssetDetails {
  return {
    asset_id: id,
    symbol,
    l1_decimals: 18,
    decimals,
    min_withdrawal_amount: min,
    margin_mode: 'disabled',
    l1_address: '0x0000000000000000000000000000000000000000',
    index_price: '1',
  }
}
