// Which way a request reaches the Lighter API. Normally through this site's
// server. All users share that server's address towards Lighter, so when it is
// rate limited the browser sends the request straight to Lighter instead, from
// the user's own address. Kept free of fetch so it can be tested.
//
// Cooldowns follow Lighter's docs (developers/reference/rate-limits): a 405 is
// its firewall blocking the caller for a fixed 60 seconds; a 429 is an API
// server limit that clears within seconds. Neither route is called again
// before its cooldown is over.

export interface ApiRouteState {
  /** Until then the server route is rate limited, so requests go direct first. */
  serverLimitedUntil: number
  /** Until then Lighter is rate limiting this browser's own address; the direct route is skipped. */
  directLimitedUntil: number
  /** The browser cannot reach Lighter directly (no network path or a regional block); stop trying. */
  directUnusable: boolean
}

export const newApiRouteState = (): ApiRouteState => ({ serverLimitedUntil: 0, directLimitedUntil: 0, directUnusable: false })

/** What is known about a failed attempt. */
export interface Failure {
  /** HTTP status, 0 when nothing answered. */
  httpStatus: number
  retryAfterSec?: number
  /** The server said its own route is limited, not the user's address (ROUTE_LIMIT_HEADER). */
  routeLimited?: boolean
}

/** Lighter's firewall block after a 405. */
export const FIREWALL_COOLDOWN_MS = 60_000
/** After a 429 that gave no Retry-After. */
export const API_LIMIT_COOLDOWN_MS = 5_000
const MAX_COOLDOWN_MS = 120_000

/** The caller cannot use this route at all: nothing answered, or a regional block. */
const isBlockedStatus = (status: number): boolean => status === 0 || status === 403 || status === 451

const cooldownFor = (failure: Failure): number =>
  failure.httpStatus === 405
    ? FIREWALL_COOLDOWN_MS
    : failure.retryAfterSec && failure.retryAfterSec > 0
      ? Math.min(failure.retryAfterSec * 1000, MAX_COOLDOWN_MS)
      : API_LIMIT_COOLDOWN_MS

export async function sendWithDirectFallback<T>(opts: {
  viaServer: () => Promise<T>
  /** Null when there is no separate direct route (the build already calls Lighter directly, or it is switched off). */
  direct: (() => Promise<T>) | null
  state: ApiRouteState
  /** Null for an error that is not an HTTP-level failure. */
  failureOf: (err: unknown) => Failure | null
  now?: () => number
}): Promise<T> {
  const { viaServer, state, failureOf } = opts
  const now = opts.now ?? Date.now

  /**
   * Tries the direct route. An answer from Lighter itself (a result, or a rejection of the request) is
   * final. A failure about who is calling (blocked, or rate limited too) is reported as `undefined` so
   * the caller keeps the server route's outcome: it must never look like Lighter refused the account,
   * which would send the action to the contract and cost gas.
   */
  const tryDirect = async (): Promise<{ value: T } | undefined> => {
    if (!opts.direct || state.directUnusable || now() < state.directLimitedUntil) return undefined
    try {
      return { value: await opts.direct() }
    } catch (err) {
      const failure = failureOf(err)
      if (!failure) throw err
      if (isBlockedStatus(failure.httpStatus)) {
        state.directUnusable = true
        return undefined
      }
      if (failure.httpStatus === 429 || failure.httpStatus === 405) {
        state.directLimitedUntil = now() + cooldownFor(failure)
        return undefined
      }
      throw err
    }
  }

  // While the server route is limited, do not add to its load: go direct first.
  if (now() < state.serverLimitedUntil) {
    const direct = await tryDirect()
    if (direct) return direct.value
  }

  try {
    return await viaServer()
  } catch (err) {
    const failure = failureOf(err)
    // Only a limit on the server's route is worth retrying from here. A 429 about the user's own
    // wallet (sendTx is limited per address) would be the same from any address.
    if (!failure?.routeLimited) throw err
    state.serverLimitedUntil = now() + cooldownFor(failure)
    const direct = await tryDirect()
    if (direct) return direct.value
    throw err
  }
}
