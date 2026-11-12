import { describe, expect, it } from 'vitest'

import { newApiRouteState, sendWithDirectFallback, type Failure } from '../src/lib/apiFallback'

class Fail extends Error {
  constructor(public readonly failure: Failure) {
    super(`status ${failure.httpStatus}`)
  }
}
const failureOf = (err: unknown) => (err instanceof Fail ? err.failure : null)
const fail = (httpStatus: number, retryAfterSec?: number) => () => Promise.reject(new Fail({ httpStatus, retryAfterSec }))
const ok = (value: string) => () => Promise.resolve(value)

/** Wraps a sender so the test can count how often each route was used. */
function counted<T>(fn: () => Promise<T>) {
  const wrapped = Object.assign(() => (wrapped.calls++, fn()), { calls: 0 })
  return wrapped
}

describe('sendWithDirectFallback', () => {
  it('uses the server and leaves the direct route alone when the server answers', async () => {
    const direct = counted(ok('direct'))
    const state = newApiRouteState()
    expect(await sendWithDirectFallback({ viaServer: ok('server'), direct, state, failureOf })).toBe('server')
    expect(direct.calls).toBe(0)
  })

  it('goes direct when the server is rate limited, by 429 or by the 405 challenge', async () => {
    for (const status of [429, 405]) {
      const state = newApiRouteState()
      expect(await sendWithDirectFallback({ viaServer: fail(status), direct: ok('direct'), state, failureOf })).toBe('direct')
    }
  })

  it('keeps going direct, without asking the server, until the limit should have lifted', async () => {
    let time = 1_000
    const now = () => time
    const state = newApiRouteState()
    const server = counted(fail(429, 30))
    await sendWithDirectFallback({ viaServer: server, direct: ok('direct'), state, failureOf, now })
    expect(server.calls).toBe(1)

    time += 29_000
    const again = counted(ok('server'))
    expect(await sendWithDirectFallback({ viaServer: again, direct: ok('direct'), state, failureOf, now })).toBe('direct')
    expect(again.calls).toBe(0)

    time += 2_000
    expect(await sendWithDirectFallback({ viaServer: again, direct: ok('direct'), state, failureOf, now })).toBe('server')
    expect(again.calls).toBe(1)
  })

  it('does not go direct for anything that is not a rate limit', async () => {
    for (const status of [0, 400, 403, 404, 451, 500, 502]) {
      const direct = counted(ok('direct'))
      const state = newApiRouteState()
      await expect(sendWithDirectFallback({ viaServer: fail(status), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: status } })
      expect(direct.calls).toBe(0)
    }
  })

  it('reports the rate limit, never a refusal, when the direct route is blocked for this user', async () => {
    for (const blocked of [0, 403, 451]) {
      const state = newApiRouteState()
      const direct = counted(fail(blocked))
      await expect(sendWithDirectFallback({ viaServer: fail(429), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
      expect(state.directUnusable).toBe(true)
      // Later requests do not try the blocked route again.
      await expect(sendWithDirectFallback({ viaServer: fail(429), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
      expect(direct.calls).toBe(1)
    }
  })

  it('falls back to the server when direct stops working during the limited window', async () => {
    const state = newApiRouteState()
    state.serverLimitedUntil = 10_000
    const server = counted(ok('server'))
    expect(await sendWithDirectFallback({ viaServer: server, direct: fail(0), state, failureOf, now: () => 0 })).toBe('server')
    expect(server.calls).toBe(1)
    expect(state.directUnusable).toBe(true)
  })

  it('reports the rate limit when both routes are rate limited, and tries direct again later', async () => {
    const state = newApiRouteState()
    const direct = counted(fail(405))
    await expect(sendWithDirectFallback({ viaServer: fail(429), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
    expect(state.directUnusable).toBe(false)
  })

  it("passes on Lighter's own answer from the direct route", async () => {
    const state = newApiRouteState()
    await expect(sendWithDirectFallback({ viaServer: fail(429), direct: fail(400), state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 400 } })
    expect(state.directUnusable).toBe(false)
  })

  it('reports the rate limit when there is no direct route', async () => {
    const state = newApiRouteState()
    await expect(sendWithDirectFallback({ viaServer: fail(429), direct: null, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
  })
})
