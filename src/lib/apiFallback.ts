// Which way a request reaches the Lighter API. Normally through this site's
// server. All users share that server's address towards Lighter, so when it is
// rate limited the browser sends the request straight to Lighter instead, from
// the user's own address. Kept free of fetch so it can be tested.

export interface ApiRouteState {
  /** Until this time the server route is known to be rate limited, so requests go direct first. */
  serverLimitedUntil: number
  /** The browser cannot reach Lighter directly (no network path or a regional block); stop trying. */
  directUnusable: boolean
}

export const newApiRouteState = (): ApiRouteState => ({ serverLimitedUntil: 0, directUnusable: false })

/** What is known about a failed attempt: its HTTP status (0 when nothing answered) and any Retry-After. */
export interface Failure {
  httpStatus: number
  retryAfterSec?: number
}

const DEFAULT_LIMIT_WINDOW_MS = 20_000
const MAX_LIMIT_WINDOW_MS = 120_000

/** 429, or the 405 challenge page Lighter's edge answers with when it rate limits the caller. */
export const isRateLimitStatus = (status: number): boolean => status === 429 || status === 405
/** The caller cannot use this route at all: nothing answered, or a regional block. */
const isBlockedStatus = (status: number): boolean => status === 0 || status === 403 || status === 451

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
    if (!opts.direct || state.directUnusable) return undefined
    try {
      return { value: await opts.direct() }
    } catch (err) {
      const failure = failureOf(err)
      if (!failure) throw err
      if (isBlockedStatus(failure.httpStatus)) {
        state.directUnusable = true
        return undefined
      }
      if (isRateLimitStatus(failure.httpStatus)) return undefined
      throw err
    }
  }

  // While the server is known to be limited, do not add to its load: go direct first.
  if (now() < state.serverLimitedUntil) {
    const direct = await tryDirect()
    if (direct) return direct.value
  }

  try {
    return await viaServer()
  } catch (err) {
    const failure = failureOf(err)
    if (!failure || !isRateLimitStatus(failure.httpStatus)) throw err
    const wait = failure.retryAfterSec && failure.retryAfterSec > 0 ? failure.retryAfterSec * 1000 : DEFAULT_LIMIT_WINDOW_MS
    state.serverLimitedUntil = now() + Math.min(wait, MAX_LIMIT_WINDOW_MS)
    const direct = await tryDirect()
    if (direct) return direct.value
    throw err
  }
}
