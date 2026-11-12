// What the proxy is willing to forward to a Lighter API. Everything else is
// refused here and never reaches Lighter, so this server cannot be used as a
// general relay: it carries the reads the page needs and the transaction types
// the page sends through the API, nothing more.
//
// Pure functions, no I/O, so the rules can be tested (tests/proxyPolicy.test.ts).

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

/**
 * Lighter's edge answers 405 with a browser challenge page (not JSON) when it
 * is rate limiting the address a request came from, which here is this
 * server's. The proxy only sends GET to reads and POST to sendTx, so a 405 is
 * never a genuine "method not allowed": it is treated as a rate limit.
 */
export const isUpstreamRateLimit = (status) => status === 405
export const UPSTREAM_RATE_LIMIT_MESSAGE = 'Lighter is rate limiting requests right now. Wait a minute and try again.'
