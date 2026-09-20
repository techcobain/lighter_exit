import { isPreview, isSamplePreview, previewAccountList, previewAssets, previewMarkets, previewNames, previewPools, previewState, PREVIEW_PUBLIC_KEY } from '../dev/preview'
import { API_KEY_INDEX, LIGHTER_API_BASE, RESTRICTION_ERROR_CODES } from './config'

import type {
  ApiKeyInfo,
  AssetDetails,
  DetailedAccount,
  L2Tx,
  MarketDetails,
  PoolInfo,
  SendTxResponse,
} from './types'

export class LighterApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly httpStatus: number,
  ) {
    super(message)
    this.name = 'LighterApiError'
  }
}

const NOT_FOUND_CODES = new Set([21100, 21109, 21500])

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${LIGHTER_API_BASE}/api/v1${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (err) {
    throw new LighterApiError(`Lighter API unreachable: ${err instanceof Error ? err.message : String(err)}`, 0, 0)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  const obj = (body ?? {}) as { code?: number; message?: string }
  const code = typeof obj.code === 'number' ? obj.code : res.ok ? 200 : res.status
  if (!res.ok || (code !== 200 && code !== 0)) {
    const message = obj.message || (text ? text.slice(0, 200) : `HTTP ${res.status}`)
    throw new LighterApiError(message, code, res.status)
  }
  return body as T
}

export function isNotFound(err: unknown): boolean {
  return err instanceof LighterApiError && NOT_FOUND_CODES.has(err.code)
}

/**
 * True when the API refused because of who is asking rather than what was
 * asked: blacklist / permission codes, an edge block (403, 451, or an HTML
 * page instead of JSON), or the API being unreachable at all. Those are the
 * cases where the same action is retried through the Ethereum contract.
 */
export function isRestrictionError(err: unknown): boolean {
  if (!(err instanceof LighterApiError)) return false
  if (RESTRICTION_ERROR_CODES.has(err.code)) return true
  if (err.httpStatus === 0 || err.httpStatus === 403 || err.httpStatus === 451) return true
  return false
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function fetchAccountsByL1Address(address: string): Promise<DetailedAccount[]> {
  if (isSamplePreview()) return previewAccountList()
  try {
    const res = await request<{ accounts: DetailedAccount[] }>(
      `/account?by=l1_address&value=${address}&active_only=true`,
    )
    return res.accounts ?? []
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
}

export async function fetchAccount(index: number): Promise<DetailedAccount> {
  if (isSamplePreview()) {
    const a = previewAccountList().find((x) => x.index === index)
    if (a) return a
    const pool = previewPools[index]
    if (pool) return { ...previewAccountList()[0]!, index, account_index: index, account_type: pool.account_type, name: pool.name, positions: [], shares: [], assets: [], pending_unlocks: [], total_order_count: 0 }
    throw new LighterApiError('account not found', 21100, 200)
  }
  const res = await request<{ accounts: DetailedAccount[] }>(
    `/account?by=index&value=${index}&active_only=true`,
  )
  const account = res.accounts?.[0]
  if (!account) throw new LighterApiError('account not found', 21100, 200)
  return account
}

export async function fetchPoolInfo(index: number): Promise<PoolInfo> {
  const account = await fetchAccount(index)
  return { index, name: account.name ?? '', account_type: account.account_type }
}

export async function fetchMarkets(): Promise<Map<number, MarketDetails>> {
  if (isSamplePreview()) return previewMarkets
  const res = await request<{
    order_book_details: MarketDetails[]
    spot_order_book_details?: MarketDetails[]
  }>('/orderBookDetails')
  const map = new Map<number, MarketDetails>()
  for (const m of res.order_book_details ?? []) map.set(m.market_id, { ...m, market_type: 'perp' })
  for (const m of res.spot_order_book_details ?? []) map.set(m.market_id, { ...m, market_type: 'spot' })
  return map
}

export async function fetchAssets(): Promise<Map<number, AssetDetails>> {
  if (isSamplePreview()) return previewAssets
  const res = await request<{ asset_details: AssetDetails[] }>('/assetDetails')
  return new Map((res.asset_details ?? []).map((a) => [a.asset_id, a]))
}

export async function fetchNextNonce(accountIndex: number, apiKeyIndex: number): Promise<number> {
  if (isPreview) return previewState.nonce++
  const res = await request<{ nonce: number }>(
    `/nextNonce?account_index=${accountIndex}&api_key_index=${apiKeyIndex}`,
  )
  return res.nonce
}

/** Public key registered at a given API key slot, or null when the slot is empty. */
export async function fetchApiKey(
  accountIndex: number,
  apiKeyIndex: number,
): Promise<ApiKeyInfo | null> {
  if (isPreview) {
    return previewState.registered.has(accountIndex)
      ? { account_index: accountIndex, api_key_index: API_KEY_INDEX, nonce: previewState.nonce, public_key: PREVIEW_PUBLIC_KEY }
      : null
  }
  try {
    const res = await request<{ api_keys: ApiKeyInfo[] }>(
      `/apikeys?account_index=${accountIndex}&api_key_index=${apiKeyIndex}`,
    )
    return res.api_keys?.find((k) => k.api_key_index === apiKeyIndex) ?? null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** Lighter's view of an L1 transaction, or null while it hasn't been picked up yet. */
export async function fetchTxFromL1Hash(l1TxHash: string): Promise<L2Tx | null> {
  if (isPreview) return { hash: l1TxHash, type: 0, info: '', event_info: '{"ae":""}', status: 3, queued_at: Date.now(), executed_at: Date.now() }
  try {
    return await request<L2Tx>(`/txFromL1TxHash?hash=${l1TxHash}`)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function fetchTxByHash(hash: string): Promise<L2Tx | null> {
  if (isPreview) return { hash, type: 0, info: '', event_info: '{"ae":""}', status: 3, queued_at: Date.now(), executed_at: Date.now() }
  try {
    return await request<L2Tx>(`/tx?by=hash&value=${hash}`)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/**
 * Names of every account under an address. Needs an auth token from any one
 * of those accounts (pool accounts are public, but this endpoint checks the
 * first account's type, so the token is required whenever a main account exists).
 */
export async function fetchAccountNames(address: string, authToken: string): Promise<Map<number, string>> {
  if (isSamplePreview()) return previewNames
  const res = await request<{ account_metadatas: { account_index: number; name: string }[] }>(
    `/accountMetadata?by=l1_address&value=${address}`,
    { headers: { authorization: authToken } },
  )
  return new Map((res.account_metadatas ?? []).filter((m) => m.name).map((m) => [m.account_index, m.name]))
}

export async function fetchWithdrawalDelaySeconds(): Promise<number | null> {
  if (isSamplePreview()) return 1017
  try {
    const res = await request<{ seconds: number }>('/withdrawalDelay')
    return typeof res.seconds === 'number' ? res.seconds : null
  } catch {
    return null
  }
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function sendTx(txType: number, txInfo: string): Promise<SendTxResponse> {
  if (isPreview) return { code: 200, tx_hash: `preview-${txType}-${Date.now()}` }
  const form = new URLSearchParams({ tx_type: String(txType), tx_info: txInfo })
  return request<SendTxResponse>('/sendTx', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
}

/**
 * Lighter records the outcome of executing a transaction in `event_info.ae`
 * (an "application error" JSON string). Empty means success.
 */
export function l2ExecutionError(tx: L2Tx): string | null {
  if (!tx.event_info) return null
  try {
    const info = JSON.parse(tx.event_info) as { ae?: string }
    if (!info.ae) return null
    try {
      const inner = JSON.parse(info.ae) as { message?: string; code?: number }
      return inner.message ? `${inner.message}${inner.code ? ` (code ${inner.code})` : ''}` : info.ae
    } catch {
      return info.ae
    }
  } catch {
    return null
  }
}

export function isExecuted(tx: L2Tx): boolean {
  return tx.executed_at > 0 || tx.status >= 3
}
