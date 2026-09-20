// Preview harness: open the page with ?preview to walk through every step on
// fixture data without a wallet or the Lighter API. Actions are simulated and
// mutate the fixtures so the page evolves like the real thing. Enabled in
// dev builds always, in production only with VITE_ENABLE_PREVIEW=1.

import type { AccountPoolInfo, AssetDetails, DetailedAccount, MarketDetails, PoolInfo } from '../lib/types'

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
export const isPreview =
  !!params?.has('preview') && (import.meta.env.DEV || import.meta.env.VITE_ENABLE_PREVIEW === '1')

export type PreviewSource = 'sample' | 'live'

/** Set from the preview card: 'sample' serves fixtures, 'live' reads the real API for the typed address. */
let source: PreviewSource = 'sample'
let address = ''
export function setPreviewSource(next: PreviewSource, addr: string): void {
  source = next
  address = addr
  for (const a of previewState.accounts.values()) a.l1_address = addr
}
export const isSamplePreview = (): boolean => isPreview && source === 'sample'
export const previewAddress = (): string => address

export const PREVIEW_PUBLIC_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'

const MASTER = 100001
const SUB = 281474976620771
const POOL = 281474976624683
const LLP = 281474976710654
const STAKING = 281474976624800

const now = Date.now()

function asset(id: number, symbol: string, l1: number, dec: number, min: string, margin = 'disabled'): AssetDetails {
  return { asset_id: id, symbol, l1_decimals: l1, decimals: dec, min_withdrawal_amount: min, margin_mode: margin, l1_address: '0x0000000000000000000000000000000000000000', index_price: '1' }
}

export const previewAssets = new Map<number, AssetDetails>([
  [1, asset(1, 'ETH', 18, 8, '0.00100000', 'enabled')],
  [2, asset(2, 'LIT', 18, 8, '1.00000000')],
  [3, asset(3, 'USDC', 6, 6, '1.000000', 'enabled')],
])

export const previewMarkets = new Map<number, MarketDetails>([
  [0, { market_id: 0, symbol: 'ETH', market_type: 'perp', status: 'active', supported_size_decimals: 4, supported_price_decimals: 2, min_base_amount: '0.0020', mark_price: '2571.09' }],
  [1, { market_id: 1, symbol: 'BTC', market_type: 'perp', status: 'active', supported_size_decimals: 5, supported_price_decimals: 1, min_base_amount: '0.00020', mark_price: '109842.5' }],
])

export const previewPools: Record<number, PoolInfo> = {
  [LLP]: { index: LLP, name: 'Lighter Liquidity Provider (LLP)', account_type: 3 },
  [STAKING]: { index: STAKING, name: '', account_type: 4 },
}

export const previewNames = new Map<number, string>([[SUB, 'Trading bot']])

const poolInfo: AccountPoolInfo = { status: 0, operator_fee: '10.0000', min_operator_share_rate: '5.0000', total_shares: 20_000_000, operator_shares: 4_000_000 }

function base(index: number, type: number, extra: Partial<DetailedAccount>): DetailedAccount {
  return {
    index,
    account_index: index,
    account_type: type,
    l1_address: '',
    status: 1,
    name: '',
    collateral: '0',
    available_balance: '0',
    total_asset_value: '0',
    total_order_count: 0,
    pending_order_count: 0,
    positions: [],
    assets: [],
    shares: [],
    pending_unlocks: [],
    ...extra,
  }
}

/** Mutable fixture state; `apply()` edits it when a simulated action executes. */
export const previewState = {
  accounts: new Map<number, DetailedAccount>([
    [
      MASTER,
      base(MASTER, 0, {
        collateral: '1450.20',
        available_balance: '1210.55',
        total_asset_value: '3118.42',
        total_order_count: 3,
        positions: [
          { market_id: 0, symbol: 'ETH', sign: 1, position: '0.5000', avg_entry_price: '2402.10', position_value: '1285.55', unrealized_pnl: '84.50', open_order_count: 2, margin_mode: 0, allocated_margin: '0', liquidation_price: '1210.3' },
          { market_id: 1, symbol: 'BTC', sign: -1, position: '0.02000', avg_entry_price: '111250.0', position_value: '2196.85', unrealized_pnl: '28.15', open_order_count: 1, margin_mode: 1, allocated_margin: '400', liquidation_price: '128900.0' },
        ],
        assets: [
          { symbol: 'ETH', asset_id: 1, balance: '0.15000000', locked_balance: '0', margin_balance: '0', margin_mode: 'disabled' },
          { symbol: 'LIT', asset_id: 2, balance: '0.40000000', locked_balance: '0', margin_balance: '0', margin_mode: 'disabled' },
          { symbol: 'USDC', asset_id: 3, balance: '250.500000', locked_balance: '25.000000', margin_balance: '1450.20', margin_mode: 'disabled' },
        ],
        shares: [
          { public_pool_index: LLP, shares_amount: 5_000_000, entry_usdc: '500', principal_amount: '500', entry_timestamp: now - 20 * 86400_000 },
          { public_pool_index: STAKING, shares_amount: 194_600, entry_usdc: '0', principal_amount: '2', entry_timestamp: 0 },
        ],
        pending_unlocks: [{ unlock_timestamp: now + 2 * 86400_000 + 14 * 3600_000, asset_index: 2, amount: '1230.75692856' }],
      }),
    ],
    [SUB, base(SUB, 1, { total_asset_value: '12.00', available_balance: '0', assets: [{ symbol: 'USDC', asset_id: 3, balance: '12.000000', locked_balance: '0', margin_balance: '0', margin_mode: 'disabled' }] })],
    [
      POOL,
      base(POOL, 2, {
        name: 'Preview Strategy',
        total_asset_value: '20412.00',
        collateral: '20412.00',
        available_balance: '17200.00',
        total_order_count: 1,
        positions: [{ market_id: 0, symbol: 'ETH', sign: -1, position: '1.2000', avg_entry_price: '2610.00', position_value: '3085.31', unrealized_pnl: '46.69', open_order_count: 1, margin_mode: 0, allocated_margin: '0', liquidation_price: '9800' }],
        pool_info: { ...poolInfo },
      }),
    ],
  ]),
  pendingL1: new Map<number, bigint>([[3, 3_920_000n]]),
  registered: new Set<number>(),
  nonce: 0,
}

export function previewAccountList(): DetailedAccount[] {
  return [...previewState.accounts.values()].map((a) => structuredClone(a))
}

/** Mutates fixtures to reflect an executed action, keyed by the action id conventions. */
export function previewApply(id: string): void {
  if (source !== 'sample') return
  const [kind, ...rest] = id.split('-')
  const accountIndex = Number(rest[0])
  const acc = previewState.accounts.get(accountIndex)
  switch (kind) {
    case 'cancel':
      if (acc) {
        acc.total_order_count = 0
        acc.positions.forEach((p) => (p.open_order_count = 0))
        acc.assets.forEach((a) => (a.locked_balance = '0'))
      }
      break
    case 'pos': {
      const marketId = Number(rest[1])
      if (acc) {
        const p = acc.positions.find((x) => x.market_id === marketId)
        acc.positions = acc.positions.filter((x) => x.market_id !== marketId)
        if (p) acc.available_balance = (Number(acc.available_balance) + Number(p.position_value) * 0.2).toFixed(2)
      }
      break
    }
    case 'shares': {
      const pool = Number(rest[1])
      if (acc) {
        const s = acc.shares.find((x) => x.public_pool_index === pool)
        acc.shares = acc.shares.filter((x) => x.public_pool_index !== pool)
        if (s && pool === STAKING) acc.pending_unlocks.push({ unlock_timestamp: Date.now() + 3 * 86400_000, asset_index: 2, amount: '2.00000000' })
        else if (s) acc.available_balance = (Number(acc.available_balance) + Number(s.principal_amount)).toFixed(2)
      }
      break
    }
    case 'wd': {
      const assetId = Number(rest[1])
      const route = Number(rest[2])
      if (acc) {
        if (route === 1) acc.assets.forEach((a) => a.asset_id === assetId && (a.balance = '0'))
        else if (assetId === 3) acc.available_balance = '0'
        else acc.assets.forEach((a) => a.asset_id === assetId && (a.margin_balance = '0'))
        previewState.pendingL1.set(assetId, (previewState.pendingL1.get(assetId) ?? 0n) + 1_000_000n)
      }
      break
    }
    case 'claim':
      previewState.pendingL1.delete(Number(rest[rest.length - 1]))
      break
    case 'freeze': {
      const pool = previewState.accounts.get(Number(rest[0]))
      if (pool?.pool_info) pool.pool_info.status = 1
      break
    }
    case 'opburn': {
      const pool = previewState.accounts.get(Number(rest[0]))
      if (pool?.pool_info) pool.pool_info.operator_shares = 0
      break
    }
  }
}

export function previewMasterIndex(): number {
  return MASTER
}
