import { describe, expect, it } from 'vitest'

import { newApiRouteState, sendDirectFirst, type Failure } from '../src/lib/apiFallback'

class Fail extends Error {
  constructor(public readonly failure: Failure) {
    super(`status ${failure.httpStatus}`)
  }
}
const failureOf = (err: unknown) => (err instanceof Fail ? err.failure : null)
const fail = (failure: Failure) => () => Promise.reject(new Fail(failure))
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

describe('sendDirectFirst', () => {
  it('goes straight to Lighter and leaves the server alone when that answers', async () => {
    const server = counted(ok('server'))
    expect(await sendDirectFirst({ direct: ok('direct'), viaServer: server, state: newApiRouteState(), failureOf })).toBe('direct')
    expect(server.calls).toBe(0)
  })

  it('uses the server only when there is no direct route', async () => {
    expect(await sendDirectFirst({ direct: null, viaServer: ok('server'), state: newApiRouteState(), failureOf })).toBe('server')
  })

  it('switches to the server for the rest of the visit when the browser is blocked', async () => {
    for (const httpStatus of [0, 403, 451]) {
      const state = newApiRouteState()
      const direct = counted(fail({ httpStatus }))
      expect(await sendDirectFirst({ direct, viaServer: ok('server'), state, failureOf })).toBe('server')
      expect(state.directUnusable).toBe(true)
      expect(await sendDirectFirst({ direct, viaServer: ok('server'), state, failureOf })).toBe('server')
      expect(direct.calls).toBe(1)
    }
  })

  it("reports the server's answer when both routes are blocked, so the caller can use the contract", async () => {
    const state = newApiRouteState()
    await expect(sendDirectFirst({ direct: fail({ httpStatus: 0 }), viaServer: fail({ httpStatus: 403 }), state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 403 } })
  })

  it("reports the server's rate limit, never a block, when the browser is blocked and the server is limited", async () => {
    const state = newApiRouteState()
    await expect(sendDirectFirst({ direct: fail({ httpStatus: 451 }), viaServer: fail({ httpStatus: 429 }), state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
  })

  it("passes on Lighter's own answer without asking the server", async () => {
    for (const httpStatus of [200, 400, 404, 500, 502]) {
      const state = newApiRouteState()
      const server = counted(ok('server'))
      await expect(sendDirectFirst({ direct: fail({ httpStatus }), viaServer: server, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus } })
      expect(server.calls).toBe(0)
      expect(state.directUnusable).toBe(false)
    }
  })

  it("does not retry a 429 about the user's own wallet anywhere", async () => {
    const state = newApiRouteState()
    const server = counted(ok('server'))
    await expect(sendDirectFirst({ direct: fail({ httpStatus: 429, walletLimited: true }), viaServer: server, state, failureOf })).rejects.toMatchObject({ failure: { httpStatus: 429 } })
    expect(server.calls).toBe(0)
    expect(state.directLimitedUntil).toBe(0)
  })

  it("uses the server for Lighter's 60-second firewall block after a 405", async () => {
    const c = clock()
    const state = newApiRouteState()
    const direct = counted(fail({ httpStatus: 405 }))
    expect(await sendDirectFirst({ direct, viaServer: ok('server'), state, failureOf, now: c.now })).toBe('server')

    c.time += 59_000
    expect(await sendDirectFirst({ direct, viaServer: ok('server'), state, failureOf, now: c.now })).toBe('server')
    expect(direct.calls).toBe(1)

    c.time += 2_000
    const recovered = counted(ok('direct'))
    expect(await sendDirectFirst({ direct: recovered, viaServer: ok('server'), state, failureOf, now: c.now })).toBe('direct')
    expect(recovered.calls).toBe(1)
  })

  it('uses the server briefly after a 429 from Lighter', async () => {
    const c = clock()
    const state = newApiRouteState()
    expect(await sendDirectFirst({ direct: fail({ httpStatus: 429 }), viaServer: ok('server'), state, failureOf, now: c.now })).toBe('server')
    expect(state.directLimitedUntil).toBe(c.time + 5_000)
    expect(state.directUnusable).toBe(false)
  })

  it('follows a Retry-After when one is readable, capped at two minutes', async () => {
    const c = clock()
    const state = newApiRouteState()
    await sendDirectFirst({ direct: fail({ httpStatus: 429, retryAfterSec: 600 }), viaServer: ok('server'), state, failureOf, now: c.now })
    expect(state.directLimitedUntil).toBe(c.time + 120_000)
  })

  it('rethrows errors that are not HTTP failures', async () => {
    const server = counted(ok('server'))
    await expect(sendDirectFirst({ direct: () => Promise.reject(new TypeError('bug')), viaServer: server, state: newApiRouteState(), failureOf })).rejects.toThrow('bug')
    expect(server.calls).toBe(0)
  })
})
