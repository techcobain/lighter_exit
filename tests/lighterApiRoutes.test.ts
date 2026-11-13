import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ALLOWED_TX_TYPES } from '../server/policy.mjs'
import { TX_TYPE } from '../src/lib/config'

// Which hosts sendTx reaches, with fetch replaced: this site's proxy is a relative URL, Lighter an absolute one.
async function hostsFor(txType: number, directStatus: number | 'network') {
  vi.resetModules()
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url.startsWith('/') ? 'server' : 'direct')
    if (!url.startsWith('/') && directStatus === 'network') throw new TypeError('Failed to fetch')
    const status = url.startsWith('/') ? 200 : (directStatus as number)
    return new Response(JSON.stringify(status === 200 ? { code: 200, tx_hash: 'h' } : { code: status, message: 'blocked' }), { status })
  })
  const api = await import('../src/lib/lighterApi')
  const result = await api.sendTx(txType, '{}').then(
    () => 'ok' as const,
    (err: unknown) => (api.isRestrictionError(err) ? ('refused' as const) : ('error' as const)),
  )
  return { calls, result }
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchRegionRestricted', () => {
  async function probe(answer: { status: number; body: unknown } | 'network') {
    vi.resetModules()
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url.startsWith('/') ? 'server' : 'direct')
      if (url.includes('/geoLocation')) {
        if (answer === 'network') throw new TypeError('Failed to fetch')
        return new Response(JSON.stringify(answer.body), { status: answer.status })
      }
      return new Response(JSON.stringify({ code: 200, tx_hash: 'h' }), { status: 200 })
    })
    const api = await import('../src/lib/lighterApi')
    const restricted = await api.fetchRegionRestricted()
    calls.length = 0
    // A trading transaction afterwards: tried from the browser only when the region is not restricted.
    const trade = await api.sendTx(TX_TYPE.CANCEL_ALL_ORDERS, '{}').then(
      () => 'ok',
      (err: unknown) => (api.isRestrictionError(err) ? 'refused' : 'error'),
    )
    return { restricted, trade, calls }
  }

  it("asks the browser's route and leaves trading alone when Lighter answers 200", async () => {
    expect(await probe({ status: 200, body: { code: 200 } })).toEqual({ restricted: false, trade: 'ok', calls: ['direct'] })
  })

  it('sends trading to the contract without trying the API when the region is restricted', async () => {
    expect(await probe({ status: 403, body: { code: 20558, message: 'Restricted jurisdiction' } })).toEqual({ restricted: true, trade: 'refused', calls: [] })
  })

  it('treats an unknown answer as not restricted', async () => {
    expect((await probe('network')).restricted).toBe(false)
    expect((await probe({ status: 500, body: {} })).restricted).toBe(false)
  })
})

describe('sendTx routes', () => {
  it('sends trading only from the browser; a blocked browser gets a refusal, which goes to the contract', async () => {
    for (const txType of [TX_TYPE.CREATE_ORDER, TX_TYPE.CANCEL_ALL_ORDERS]) {
      expect(await hostsFor(txType, 200)).toEqual({ calls: ['direct'], result: 'ok' })
      expect(await hostsFor(txType, 451)).toEqual({ calls: ['direct'], result: 'refused' })
      expect(await hostsFor(txType, 'network')).toEqual({ calls: ['direct'], result: 'refused' })
    }
  })

  it('sends the other transactions through the server when the browser is blocked', async () => {
    for (const txType of DEFAULT_ALLOWED_TX_TYPES) {
      expect(await hostsFor(txType, 200)).toEqual({ calls: ['direct'], result: 'ok' })
      expect(await hostsFor(txType, 403)).toEqual({ calls: ['direct', 'server'], result: 'ok' })
    }
  })
})
