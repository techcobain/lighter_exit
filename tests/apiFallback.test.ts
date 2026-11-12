import { describe, expect, it } from 'vitest'

import { newApiRouteState, sendWithDirectFallback, type Failure } from '../src/lib/apiFallback'

class Fail extends Error {
  constructor(public readonly failure: Failure) {
    super(`status ${failure.httpStatus}`)
  }
}
const failureOf = (err: unknown) => (err instanceof Fail ? err.failure : null)
const fail = (failure: Failure) => () => Promise.reject(new Fail(failure))
/** The server saying its own route to Lighter is limited. */
const routeLimited = (retryAfterSec?: number) => fail({ httpStatus: 429, routeLimited: true, retryAfterSec })
const ok = (value: string) => () => Promise.resolve(value)

/** Wraps a sender so the test can count how often each route was used. */
function counted<T>(fn: () => Promise<T>) {
  const wrapped = Object.assign(() => (wrapped.calls++, fn()), { calls: 0 })
  return wrapped
}

function clock(start = 1_000) {
  const c = { time: start, now: () => c.time }
  return c
}

describe('sendWithDirectFallback', () => {
  it('uses the server and leaves the direct route alone when the server answers', async () => {
    const direct = counted(ok('direct'))
    const state = newApiRouteState()
    expect(await sendWithDirectFallback({ viaServer: ok('server'), direct, state, failureOf })).toBe('server')
    expect(direct.calls).toBe(0)
  })

  it('goes direct when the server says its route is limited', async () => {
    const state = newApiRouteState()
    expect(await sendWithDirectFallback({ viaServer: routeLimited(60), direct: ok('direct'), state, failureOf })).toBe('direct')
  })

  it("does not retry a 429 about the user's own wallet anywhere", async () => {
    const direct = counted(ok('direct'))
    const state = newApiRouteState()
    await expect(sendWithDirectFallback({ viaServer: fail({ httpStatus: 429 }), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
    expect(direct.calls).toBe(0)
    expect(state.serverLimitedUntil).toBe(0)
  })

  it("keeps going direct, without asking the server, for the server's cooldown", async () => {
    const c = clock()
    const state = newApiRouteState()
    const server = counted(routeLimited(30))
    await sendWithDirectFallback({ viaServer: server, direct: ok('direct'), state, failureOf, now: c.now })
    expect(server.calls).toBe(1)

    c.time += 29_000
    const again = counted(ok('server'))
    expect(await sendWithDirectFallback({ viaServer: again, direct: ok('direct'), state, failureOf, now: c.now })).toBe('direct')
    expect(again.calls).toBe(0)

    c.time += 2_000
    expect(await sendWithDirectFallback({ viaServer: again, direct: ok('direct'), state, failureOf, now: c.now })).toBe('server')
    expect(again.calls).toBe(1)
  })

  it('does not go direct for anything that is not a route limit', async () => {
    for (const httpStatus of [0, 400, 403, 404, 405, 451, 500, 502]) {
      const direct = counted(ok('direct'))
      const state = newApiRouteState()
      await expect(sendWithDirectFallback({ viaServer: fail({ httpStatus }), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus } })
      expect(direct.calls).toBe(0)
    }
  })

  it("leaves the direct route alone for Lighter's 60-second firewall block after a 405", async () => {
    const c = clock()
    const state = newApiRouteState()
    const direct = counted(fail({ httpStatus: 405 }))
    await expect(sendWithDirectFallback({ viaServer: routeLimited(1), direct, state, failureOf, now: c.now })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
    expect(direct.calls).toBe(1)

    c.time += 59_000
    await expect(sendWithDirectFallback({ viaServer: routeLimited(1), direct, state, failureOf, now: c.now })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
    expect(direct.calls).toBe(1)

    c.time += 2_000
    await expect(sendWithDirectFallback({ viaServer: routeLimited(1), direct, state, failureOf, now: c.now })).rejects.toThrow()
    expect(direct.calls).toBe(2)
  })

  it('leaves the direct route alone briefly after a 429 from Lighter', async () => {
    const c = clock()
    const state = newApiRouteState()
    const direct = counted(fail({ httpStatus: 429 }))
    await expect(sendWithDirectFallback({ viaServer: routeLimited(60), direct, state, failureOf, now: c.now })).rejects.toThrow()
    expect(state.directLimitedUntil).toBe(c.time + 5_000)
    expect(state.directUnusable).toBe(false)
  })

  it('reports the rate limit, never a refusal, when the direct route is blocked for this user', async () => {
    for (const httpStatus of [0, 403, 451]) {
      const state = newApiRouteState()
      const direct = counted(fail({ httpStatus }))
      await expect(sendWithDirectFallback({ viaServer: routeLimited(60), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429, routeLimited: true } })
      expect(state.directUnusable).toBe(true)
      // Later requests do not try the blocked route again.
      await expect(sendWithDirectFallback({ viaServer: routeLimited(60), direct, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
      expect(direct.calls).toBe(1)
    }
  })

  it('falls back to the server when direct stops working during the limited window', async () => {
    const state = newApiRouteState()
    state.serverLimitedUntil = 10_000
    const server = counted(ok('server'))
    expect(await sendWithDirectFallback({ viaServer: server, direct: fail({ httpStatus: 0 }), state, failureOf, now: () => 0 })).toBe('server')
    expect(server.calls).toBe(1)
    expect(state.directUnusable).toBe(true)
  })

  it("passes on Lighter's own answer from the direct route", async () => {
    const state = newApiRouteState()
    await expect(sendWithDirectFallback({ viaServer: routeLimited(60), direct: fail({ httpStatus: 400 }), state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 400 } })
    expect(state.directUnusable).toBe(false)
  })

  it('reports the rate limit when there is no direct route', async () => {
    const state = newApiRouteState()
    await expect(sendWithDirectFallback({ viaServer: routeLimited(60), direct: null, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
  })
})
