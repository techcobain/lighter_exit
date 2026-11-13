import { isPreview, isSamplePreview, previewAccountList, previewAssets, previewMarkets, previewNames, previewPools, previewState, PREVIEW_PUBLIC_KEY } from '../dev/preview'
import { DEFAULT_ALLOWED_TX_TYPES } from '../../server/policy.mjs'

import { newApiRouteState, sendDirectFirst, type ApiRouteState, type Failure } from './apiFallback'
import { API_KEY_INDEX, RESTRICTION_ERROR_CODES } from './config'
import { activeEnvironment, type EnvironmentId, type LighterEnvironment } from './environments'

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
    public readonly limit: Pick<Failure, 'retryAfterSec' | 'walletLimited'> = {},
  ) {
    super(message)
    this.name = 'LighterApiError'
  }
}

const RATE_LIMITED_MESSAGE = 'Lighter is rate limiting requests right now. Wait a minute and try again.'

const NOT_FOUND_CODES = new Set([21100, 21109, 21500])

/**
 * A read sent straight to Lighter that has not answered by then is treated as
 * unreachable, so a block that drops the connection does not leave the page
 * waiting on the browser's own, much longer, timeout.
 */
const DIRECT_READ_TIMEOUT_MS = 15_000

/** One request to a Lighter API at `base`: Lighter itself, or this site's proxy. */
async function send<T>(base: string, path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}/api/v1${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    })
  } catch (err) {
    throw new LighterApiError(`Lighter API unreachable: ${err instanceof Error ? err.message : String(err)}`, 0, 0)
  }
  const retryAfter = Number(res.headers.get('retry-after'))
  const retryAfterSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
  // Lighter limits transactions per wallet, so a 429 on sendTx is the same from any address.
  const limit = { retryAfterSec, walletLimited: res.status === 429 && path.startsWith('/sendTx') }
  // Lighter's firewall answers 405 with a browser challenge page when it is rate limiting the caller.
  if (res.status === 405) throw new LighterApiError(RATE_LIMITED_MESSAGE, 429, 405, limit)
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
    throw new LighterApiError(message, code, res.status, limit)
  }
  return body as T
}

// Per deployment: whether the browser can reach Lighter itself right now.
const routeStates = new Map<EnvironmentId, ApiRouteState>()

function routeState(env: LighterEnvironment): ApiRouteState {
  let state = routeStates.get(env.id)
  if (!state) routeStates.set(env.id, (state = newApiRouteState()))
  return state
}

/**
 * Where a deployment's API is. A relative API base is this site's server. An
 * absolute one (the IPFS build) is Lighter itself, so that build has no server
 * route and calls Lighter directly.
 */
function apiBases(env: LighterEnvironment): { direct: string | null; server: string | null } {
  const viaProxy = env.apiBase.startsWith('/')
  return { direct: viaProxy ? env.directApiBase : env.apiBase, server: viaProxy ? env.apiBase : null }
}

/** Code Lighter's edge answers (with HTTP 403) to a region it restricts. */
const RESTRICTED_JURISDICTION_CODE = 20558

/**
 * Calls the active deployment's API unless another one is named. Goes straight
 * to Lighter from the browser; through this site's server when the browser is
 * blocked or rate limited (see apiFallback.ts), unless `serverAllowed` is false.
 */
async function request<T>(
  path: string,
  init?: RequestInit,
  env: LighterEnvironment = activeEnvironment(),
  serverAllowed = true,
): Promise<T> {
  const { direct, server } = apiBases(env)
  const write = (init?.method ?? 'GET') !== 'GET'
  // Only reads time out: a transaction may already have reached Lighter, and a resend would fail on its nonce.
  const timeout = write ? undefined : DIRECT_READ_TIMEOUT_MS
  return sendDirectFirst({
    direct: direct ? () => send<T>(direct, path, init, timeout) : null,
    viaServer: serverAllowed && server ? () => send<T>(server, path, init) : null,
    state: routeState(env),
    write,
    failureOf: (err) =>
      err instanceof LighterApiError
        ? { httpStatus: err.code === RESTRICTED_JURISDICTION_CODE ? 403 : err.httpStatus, ...err.limit }
        : null,
    noRoute: (reason) =>
      reason === 'limited'
        ? new LighterApiError(RATE_LIMITED_MESSAGE, 429, 429)
        : new LighterApiError('Lighter does not accept transactions from this browser', 0, 0),
  })
}

/**
 * Whether Lighter restricts this browser's region, from the check Lighter's own
 * app uses: GET /geoLocation answers 200 unless the edge blocks the caller (403,
 * code 20558). Asked straight from the browser, never through the server, whose
 * region says nothing about the user's. When restricted, transactions skip the
 * direct route from then on (reads keep using it), so trading goes to the
 * contract without a refused attempt first. Unknown (no direct route, an outage)
 * counts as not restricted: a refused transaction still finds out.
 */
export async function fetchRegionRestricted(env: LighterEnvironment = activeEnvironment()): Promise<boolean> {
  if (isPreview) return false
  const { direct } = apiBases(env)
  if (!direct) return false
  try {
    await send(direct, '/geoLocation', undefined, DIRECT_READ_TIMEOUT_MS)
    return false
  } catch (err) {
    if (!(err instanceof LighterApiError)) return false
    const restricted = err.code === RESTRICTED_JURISDICTION_CODE || err.httpStatus === 403 || err.httpStatus === 451
    if (restricted) routeState(env).directWritesBlocked = true
    return restricted
  }
}

/**
 * Transaction types this site's server relays (server/policy.mjs). The rest,
 * trading (orders and cancels), go to Lighter only from the user's own browser:
 * relaying them would let a blocked user trade from the server's address.
 */
const SERVER_TX_TYPES: ReadonlySet<number> = new Set(DEFAULT_ALLOWED_TX_TYPES)

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

/** Accounts owned by an address on one deployment (the active one unless named). */
export async function fetchAccountsByL1Address(
  address: string,
  env: LighterEnvironment = activeEnvironment(),
): Promise<DetailedAccount[]> {
  // The fixtures model a Lighter (Ethereum) user.
  if (isSamplePreview()) return env.id === 'mainnet' ? previewAccountList() : []
  try {
    const res = await request<{ accounts: DetailedAccount[] }>(
      `/account?by=l1_address&value=${address}&active_only=true`,
      undefined,
      env,
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
  return marketsFrom(await request<OrderBookDetails>('/orderBookDetails'))
}

type OrderBookDetails = { order_book_details: MarketDetails[]; spot_order_book_details?: MarketDetails[] }

function marketsFrom(res: OrderBookDetails): Map<number, MarketDetails> {
  const map = new Map<number, MarketDetails>()
  for (const m of res.order_book_details ?? []) map.set(m.market_id, { ...m, market_type: 'perp' })
  for (const m of res.spot_order_book_details ?? []) map.set(m.market_id, { ...m, market_type: 'spot' })
  return map
}

/**
 * Markets as this site's server sees them. For a position whose market is
 * missing from the browser's list, the page needs the market's decimals and
 * mark price to close it through the contract (never through the API). Empty
 * when there is no server (the IPFS build).
 */
export async function fetchServerMarkets(env: LighterEnvironment = activeEnvironment()): Promise<Map<number, MarketDetails>> {
  const { server } = apiBases(env)
  if (isSamplePreview() || !server) return new Map()
  return marketsFrom(await send<OrderBookDetails>(server, '/orderBookDetails'))
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
  return request<SendTxResponse>(
    '/sendTx',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    },
    activeEnvironment(),
    SERVER_TX_TYPES.has(txType),
  )
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
