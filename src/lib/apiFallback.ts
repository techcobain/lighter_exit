// Which way a request reaches the Lighter API. Normally straight from the
// browser, so Lighter sees each user's own address and rate limits each user
// separately. When the browser cannot reach Lighter (no answer at all, or a
// 403/451 regional block), the request goes through this site's server instead,
// and keeps doing so for the rest of the visit. While Lighter is rate limiting
// the browser's own address, the server is used until that cooldown is over.
// Trading transactions have no server route at all: the server never relays
// them, because that would send a blocked user's orders from another address.
// Kept free of fetch so it can be tested.
//
// Cooldowns follow Lighter's docs (developers/reference/rate-limits): a 405 is
// its firewall blocking the caller for a fixed 60 seconds; a 429 is an API
// server limit that clears within seconds. The server keeps its own cooldown
// for its own address (server/index.mjs).

export interface ApiRouteState {
  /** Until then Lighter is rate limiting this browser's own address; requests go through the server. */
  directLimitedUntil: number
  /** The browser cannot reach Lighter directly at all; stop trying. */
  directUnusable: boolean
  /**
   * Lighter refuses transactions from this browser (its regional block, which lets reads through),
   * found by a refused transaction or by Lighter's geoLocation check. Reads still go direct.
   */
  directWritesBlocked: boolean
}

export const newApiRouteState = (): ApiRouteState => ({ directLimitedUntil: 0, directUnusable: false, directWritesBlocked: false })

/** What is known about a failed attempt. */
export interface Failure {
  /** HTTP status, 0 when nothing answered. */
  httpStatus: number
  retryAfterSec?: number
  /** The limit is on the user's wallet (sendTx is limited per address), so no other route helps. */
  walletLimited?: boolean
}

/** Lighter's firewall block after a 405. */
export const FIREWALL_COOLDOWN_MS = 60_000
/** After a 429 that gave no Retry-After (Lighter does not expose it to browsers). */
export const API_LIMIT_COOLDOWN_MS = 5_000
const MAX_COOLDOWN_MS = 120_000

/** The caller cannot use this route at all: nothing answered, or a regional block. */
export const isBlockedStatus = (status: number): boolean => status === 0 || status === 403 || status === 451

const cooldownFor = (failure: Failure): number =>
  failure.httpStatus === 405
    ? FIREWALL_COOLDOWN_MS
    : failure.retryAfterSec && failure.retryAfterSec > 0
      ? Math.min(failure.retryAfterSec * 1000, MAX_COOLDOWN_MS)
      : API_LIMIT_COOLDOWN_MS

/**
 * Sends one request, direct first. An answer from Lighter itself (a result, or a
 * rejection of the request, including a refusal of the account) is final and is
 * never retried through the server. What reaches the caller after a fallback is
 * the server route's outcome, so a refusal of the account is only ever concluded
 * from what both routes answered, and a rate limit never looks like one.
 */
export async function sendDirectFirst<T>(opts: {
  /** Null when the browser has no route to Lighter of its own (switched off). */
  direct: (() => Promise<T>) | null
  /** Null when this request may not go through the server (trading), or there is no server. */
  viaServer: (() => Promise<T>) | null
  state: ApiRouteState
  /** Null for an error that is not an HTTP-level failure. */
  failureOf: (err: unknown) => Failure | null
  /**
   * The error to report when neither route can be used: 'blocked' (the browser cannot reach Lighter,
   * which the caller treats as a refusal) or 'limited' (Lighter is rate limiting the browser).
   */
  noRoute: (reason: 'blocked' | 'limited') => Error
  /** A transaction (sendTx) rather than a read. */
  write?: boolean
  now?: () => number
}): Promise<T> {
  const { direct, viaServer, state, failureOf } = opts
  const now = opts.now ?? Date.now

  const blocked = state.directUnusable || (!!opts.write && state.directWritesBlocked)
  let skipped: 'blocked' | 'limited' = 'blocked'
  if (direct && !blocked && now() >= state.directLimitedUntil) {
    try {
      return await direct()
    } catch (err) {
      const failure = failureOf(err)
      if (!failure || failure.walletLimited) throw err
      if (isBlockedStatus(failure.httpStatus)) {
        if (opts.write) state.directWritesBlocked = true
        else state.directUnusable = true
      } else if (failure.httpStatus === 429 || failure.httpStatus === 405) state.directLimitedUntil = now() + cooldownFor(failure)
      else throw err
      if (!viaServer) throw err
    }
  } else if (direct && !blocked) {
    skipped = 'limited'
  }
  if (!viaServer) throw opts.noRoute(skipped)
  return viaServer()
}
