// What the proxy is willing to forward to a Lighter API. Everything else is
// refused here and never reaches Lighter, so this server cannot be used as a
// general relay: it carries the reads the page needs and the transaction types
// the page sends through the API, nothing more.
//
// Pure functions, no I/O, so the rules can be tested (tests/proxyPolicy.test.ts).

/** Proxy prefix → the Lighter API it forwards to unless LIGHTER_API_URL / LIGHTER_RH_API_URL say otherwise. */
export const DEFAULT_UPSTREAMS = {
  '/lighter-api': 'https://mainnet.zklighter.elliot.ai',
  '/lighter-api-rh': 'https://api.rh.lighter.xyz',
}

/** Reads the page makes, by path under /api/v1. `auth` marks the ones that carry the user's auth token. */
export const ALLOWED_READS = new Map([
  ['/api/v1/account', { auth: false }],
  ['/api/v1/accountMetadata', { auth: true }],
  ['/api/v1/apikeys', { auth: false }],
  ['/api/v1/assetDetails', { auth: false }],
  ['/api/v1/nextNonce', { auth: false }],
  ['/api/v1/orderBookDetails', { auth: false }],
  ['/api/v1/tx', { auth: false }],
  ['/api/v1/txFromL1TxHash', { auth: false }],
  ['/api/v1/withdrawalDelay', { auth: false }],
])

export const SEND_TX_PATH = '/api/v1/sendTx'

/**
 * Lighter transaction types the page sends through the API (src/lib/config.ts
 * TX_TYPE): 8 ChangePubKey, 11 UpdatePublicPool, 12 Transfer, 13 Withdraw,
 * 19 BurnShares, 36 UnstakeAssets. Orders are not here on purpose: creating
 * (14) and cancelling (16) them goes through the contract from the user's
 * own wallet, never through this server.
 */
export const DEFAULT_ALLOWED_TX_TYPES = [8, 11, 12, 13, 19, 36]

/** PROXY_ALLOWED_TX_TYPES="8,11,12" replaces the default list (a staging build that tests orders through the API adds 14 and 16). */
export function parseAllowedTxTypes(value) {
  const text = (value ?? '').trim()
  if (!text) return new Set(DEFAULT_ALLOWED_TX_TYPES)
  const parts = text.split(',').map((p) => p.trim())
  if (parts.some((p) => !/^\d{1,3}$/.test(p))) {
    throw new Error(`PROXY_ALLOWED_TX_TYPES must be a comma-separated list of transaction type numbers, got "${text}"`)
  }
  return new Set(parts.map(Number))
}

const refuse = (status, message) => ({ ok: false, status, message })

/**
 * Decides one proxied request. On success returns what to send upstream:
 * the query string to keep, whether to pass the Authorization header, and for
 * a transaction the body rebuilt from the two fields that were checked.
 *
 * @param {{ method: string, path: string, search: string, contentType?: string, body?: string }} req
 * @param {Set<number>} allowedTxTypes
 */
export function checkProxyRequest(req, allowedTxTypes) {
  if (req.method === 'GET') {
    const read = ALLOWED_READS.get(req.path)
    if (!read) return refuse(404, 'This server does not relay that endpoint.')
    return { ok: true, search: req.search, forwardAuth: read.auth }
  }
  if (req.method !== 'POST') return refuse(405, 'Method not allowed.')
  if (req.path !== SEND_TX_PATH) return refuse(404, 'This server does not relay that endpoint.')

  const contentType = (req.contentType ?? '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/x-www-form-urlencoded') return refuse(415, 'Transactions must be sent as form data.')

  const form = new URLSearchParams(req.body ?? '')
  const types = form.getAll('tx_type')
  const infos = form.getAll('tx_info')
  // Exactly one of each, written as a plain number: no room for this server and Lighter to read the form differently.
  if (types.length !== 1 || infos.length !== 1 || !/^\d{1,3}$/.test(types[0]) || !infos[0]) {
    return refuse(400, 'Malformed transaction request.')
  }
  const txType = Number(types[0])
  if (!allowedTxTypes.has(txType)) {
    return refuse(403, `This server does not relay transaction type ${txType}. Orders are placed and cancelled through the Lighter contract.`)
  }
  return {
    ok: true,
    // Rebuilt rather than passed through: only the two checked fields go upstream, and no query string.
    search: '',
    forwardAuth: false,
    body: new URLSearchParams({ tx_type: String(txType), tx_info: infos[0] }).toString(),
    contentType: 'application/x-www-form-urlencoded',
  }
}

/**
 * The address a request is rate limited by. `headerValue` is what the trusted
 * proxy in front of this server put in its client-address header. The LAST
 * entry is used: a load balancer appends the address it saw to whatever the
 * client sent (X-Forwarded-For), so earlier entries can be forged. A
 * single-valued header (Railway's X-Real-IP) reads the same either way.
 *
 * @param {string | string[] | undefined} headerValue
 * @param {string | undefined} remoteAddress
 */
export function clientAddress(headerValue, remoteAddress) {
  const joined = Array.isArray(headerValue) ? headerValue.join(',') : (headerValue ?? '')
  const fromHeader = joined.split(',').map((v) => v.trim()).filter(Boolean).pop()
  let ip = fromHeader || remoteAddress || 'unknown'
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  // One IPv6 subscriber usually holds a whole /64, so limit by prefix.
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':')
  return ip
}

// Rate limits, per Lighter's docs (developers/reference/rate-limits, "Rate limit
// exceeding behavior"): an exceeded limit answers 429 or 405. The 405 comes from
// Lighter's firewall, which blocks the calling address for a fixed 60 seconds.
// A 429 comes from the API servers, which recover in about one request's worth
// of budget (weight / (budget / 60) seconds). Reads are limited per IP address,
// so through this proxy every user shares one allowance. sendTx is not limited
// per IP at all, only per L1 address: a 429 there is about that user's wallet.

/** How long Lighter's firewall blocks an address after answering 405. */
export const FIREWALL_COOLDOWN_MS = 60_000
/** Pause after an API-server 429 that gave no Retry-After; its documented cooldown is shorter. */
export const API_LIMIT_COOLDOWN_MS = 5_000
const MAX_COOLDOWN_MS = 120_000

/**
 * Set on a 429 this server sends when its own route to Lighter is limited (or
 * when this client is over the server's per-client limit), as opposed to a 429
 * Lighter returned about the user's own wallet. Only the first kind is worth
 * retrying straight from the browser.
 */
export const ROUTE_LIMIT_HEADER = 'x-exit-route-limited'
export const UPSTREAM_RATE_LIMIT_MESSAGE = 'Lighter is rate limiting requests right now. Wait a minute and try again.'

/**
 * What an upstream answer means for this server's route to that Lighter API.
 * 'server': the server's address is limited; stop forwarding for `ms`.
 * 'address': a sendTx limit on the user's wallet; pass the answer through.
 * null: not a rate limit.
 *
 * @param {number} status
 * @param {string} path upstream path, e.g. /api/v1/sendTx
 * @param {string | null | undefined} retryAfter the upstream Retry-After header
 */
export function upstreamLimit(status, path, retryAfter) {
  if (status === 405) return { scope: 'server', ms: FIREWALL_COOLDOWN_MS }
  if (status !== 429) return null
  if (path === SEND_TX_PATH) return { scope: 'address' }
  const seconds = Number(retryAfter)
  return { scope: 'server', ms: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_COOLDOWN_MS) : API_LIMIT_COOLDOWN_MS }
}
