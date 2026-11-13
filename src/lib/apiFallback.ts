// Which way a request reaches the Lighter API. Normally straight from the
// browser, so Lighter sees each user's own address and rate limits each user
// separately. When the browser cannot reach Lighter (no answer at all, or a
// 403/451 regional block), the request goes through this site's server instead,
// and keeps doing so for the rest of the visit. While Lighter is rate limiting
// the browser's own address, the server is used until that cooldown is over.
// Kept free of fetch so it can be tested.
//
// Cooldowns follow Lighter's docs (developers/reference/rate-limits): a 405 is
// its firewall blocking the caller for a fixed 60 seconds; a 429 is an API
// server limit that clears within seconds. The server keeps its own cooldown
// for its own address (server/index.mjs).

export interface ApiRouteState {
  /** Until then Lighter is rate limiting this browser's own address; requests go through the server. */
  directLimitedUntil: number
  /** The browser cannot reach Lighter directly (no network path or a regional block); stop trying. */
  directUnusable: boolean
}

export const newApiRouteState = (): ApiRouteState => ({ directLimitedUntil: 0, directUnusable: false })

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
  /** Null when there is no separate direct route (switched off, or the build already calls Lighter directly). */
  direct: (() => Promise<T>) | null
  viaServer: () => Promise<T>
  state: ApiRouteState
  /** Null for an error that is not an HTTP-level failure. */
  failureOf: (err: unknown) => Failure | null
  now?: () => number
}): Promise<T> {
  const { direct, viaServer, state, failureOf } = opts
  const now = opts.now ?? Date.now

  if (direct && !state.directUnusable && now() >= state.directLimitedUntil) {
    try {
      return await direct()
    } catch (err) {
      const failure = failureOf(err)
      if (!failure || failure.walletLimited) throw err
      if (isBlockedStatus(failure.httpStatus)) state.directUnusable = true
      else if (failure.httpStatus === 429 || failure.httpStatus === 405) state.directLimitedUntil = now() + cooldownFor(failure)
      else throw err
    }
  }
  return viaServer()
}
