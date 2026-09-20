// Shapes of the Lighter REST responses this page reads. Only the fields we use.

export interface AccountPosition {
  market_id: number
  symbol: string
  sign: 1 | -1
  position: string
  avg_entry_price: string
  position_value: string
  unrealized_pnl: string
  open_order_count: number
  margin_mode: number
  allocated_margin: string
  liquidation_price: string
}

export interface AccountAsset {
  symbol: string
  asset_id: number
  balance: string
  locked_balance: string
  margin_balance: string
  margin_mode: string
}

export interface PoolShare {
  public_pool_index: number
  shares_amount: number
  entry_usdc: string
  principal_amount: string
  entry_timestamp: number
}

export interface PendingUnlock {
  unlock_timestamp: number
  asset_index: number
  amount: string
}

export interface AccountPoolInfo {
  status: number
  operator_fee: string
  min_operator_share_rate: string
  total_shares: number
  operator_shares: number
}

export interface DetailedAccount {
  index: number
  account_index: number
  account_type: number
  l1_address: string
  status: number
  name: string
  collateral: string
  available_balance: string
  total_asset_value: string
  total_order_count: number
  pending_order_count: number
  positions: AccountPosition[]
  assets: AccountAsset[]
  shares: PoolShare[]
  pending_unlocks: PendingUnlock[]
  /** Present on pool accounts (types 2, 3 and 4). */
  pool_info?: AccountPoolInfo
}

export interface MarketDetails {
  market_id: number
  symbol: string
  market_type: 'perp' | 'spot'
  status: string
  supported_size_decimals: number
  supported_price_decimals: number
  min_base_amount: string
  mark_price?: string
  last_trade_price?: number
}

export interface AssetDetails {
  asset_id: number
  symbol: string
  l1_decimals: number
  decimals: number
  min_withdrawal_amount: string
  margin_mode: string
  l1_address: string
  index_price: string
}

export interface PoolInfo {
  index: number
  name: string
  account_type: number
}

export interface ApiKeyInfo {
  account_index: number
  api_key_index: number
  nonce: number
  public_key: string
}

export interface L2Tx {
  hash: string
  type: number
  info: string
  event_info: string
  status: number
  queued_at: number
  executed_at: number
  l1_address?: string
  account_index?: number
}

export interface SendTxResponse {
  code: number
  message?: string
  tx_hash: string
  predicted_execution_time_ms?: number
}
