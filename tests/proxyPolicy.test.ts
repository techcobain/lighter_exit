import { describe, expect, it } from 'vitest'

import {
  ALLOWED_READS,
  DEFAULT_ALLOWED_TX_TYPES,
  checkProxyRequest,
  clientAddress,
  isUpstreamRateLimit,
  parseAllowedTxTypes,
} from '../server/policy.mjs'
import { TX_TYPE } from '../src/lib/config'

const allowed = parseAllowedTxTypes(undefined)
const form = (fields: [string, string][]) => new URLSearchParams(fields).toString()
const send = (body: string, extra: Partial<Parameters<typeof checkProxyRequest>[0]> = {}) =>
  checkProxyRequest(
    { method: 'POST', path: '/api/v1/sendTx', search: '', contentType: 'application/x-www-form-urlencoded', body, ...extra },
    allowed,
  )

describe('proxy policy', () => {
  it('relays exactly the transaction types the page sends through the API', () => {
    const { CREATE_ORDER, CANCEL_ALL_ORDERS, ...viaApi } = TX_TYPE
    expect([...DEFAULT_ALLOWED_TX_TYPES].sort((a, b) => a - b)).toEqual(Object.values(viaApi).sort((a, b) => a - b))
    expect(allowed.has(CREATE_ORDER)).toBe(false)
    expect(allowed.has(CANCEL_ALL_ORDERS)).toBe(false)
  })

  it('forwards a withdrawal, rebuilt from the two checked fields', () => {
    const res = send(form([['tx_type', '13'], ['tx_info', '{"a":1}'], ['price_protection', 'false']]), { search: '?tx_type=14' })
    expect(res).toEqual({
      ok: true,
      search: '',
      forwardAuth: false,
      contentType: 'application/x-www-form-urlencoded',
      body: form([['tx_type', '13'], ['tx_info', '{"a":1}']]),
    })
  })

  it('refuses orders and every type that is not listed', () => {
    for (const type of [14, 15, 16, 17, 20, 0, 255]) {
      const res = send(form([['tx_type', String(type)], ['tx_info', '{}']]))
      expect(res).toMatchObject({ ok: false, status: 403 })
    }
  })

  it('refuses a transaction type it cannot read unambiguously', () => {
    for (const body of [
      form([['tx_type', '13'], ['tx_type', '14'], ['tx_info', '{}']]),
      form([['tx_type', ' 13'], ['tx_info', '{}']]),
      form([['tx_type', '+13'], ['tx_info', '{}']]),
      form([['tx_type', '0x0d'], ['tx_info', '{}']]),
      form([['tx_type', '13.0'], ['tx_info', '{}']]),
      form([['tx_info', '{}']]),
      form([['tx_type', '13']]),
      form([['tx_type', '13'], ['tx_info', '{}'], ['tx_info', '{}']]),
      '',
    ]) {
      expect(send(body)).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('refuses transactions that are not plain form data', () => {
    expect(send('{"tx_type":13}', { contentType: 'application/json' })).toMatchObject({ ok: false, status: 415 })
    expect(send('x', { contentType: 'multipart/form-data; boundary=x' })).toMatchObject({ ok: false, status: 415 })
    expect(send('x', { contentType: undefined })).toMatchObject({ ok: false, status: 415 })
  })

  it('relays only the reads the page makes', () => {
    expect(checkProxyRequest({ method: 'GET', path: '/api/v1/account', search: '?by=index&value=1' }, allowed)).toEqual({
      ok: true,
      search: '?by=index&value=1',
      forwardAuth: false,
    })
    expect(checkProxyRequest({ method: 'GET', path: '/api/v1/accountMetadata', search: '' }, allowed)).toMatchObject({ forwardAuth: true })
    for (const path of ['/api/v1/sendTx', '/api/v1/sendTxBatch', '/api/v1/orderBooks', '/api/v1/account/', '/api/v1/../v1/account', '/stream', '/']) {
      expect(checkProxyRequest({ method: 'GET', path, search: '' }, allowed)).toMatchObject({ ok: false, status: 404 })
    }
    expect(ALLOWED_READS.size).toBe(9)
  })

  it('refuses other endpoints and methods for writes', () => {
    expect(send(form([['tx_type', '13'], ['tx_info', '{}']]), { path: '/api/v1/sendTxBatch' })).toMatchObject({ ok: false, status: 404 })
    expect(send(form([['tx_type', '13'], ['tx_info', '{}']]), { path: '/api/v1/account' })).toMatchObject({ ok: false, status: 404 })
    expect(send('', { method: 'PUT' })).toMatchObject({ ok: false, status: 405 })
  })

  it('lets a deployment replace the list, and rejects a malformed one', () => {
    expect([...parseAllowedTxTypes(' 8, 13 ,14')]).toEqual([8, 13, 14])
    expect([...parseAllowedTxTypes('')].sort((a, b) => a - b)).toEqual([...DEFAULT_ALLOWED_TX_TYPES].sort((a, b) => a - b))
    expect(() => parseAllowedTxTypes('8,orders')).toThrow()
    expect(() => parseAllowedTxTypes('8,,13')).toThrow()
  })
})

describe('clientAddress', () => {
  it('reads a single-valued header as is', () => {
    expect(clientAddress('203.0.113.7', '10.0.0.1')).toBe('203.0.113.7')
  })

  it('takes the entry the load balancer appended, not one the client sent', () => {
    expect(clientAddress('1.2.3.4, 203.0.113.7', '10.0.0.1')).toBe('203.0.113.7')
    expect(clientAddress(['1.2.3.4', '5.6.7.8, 203.0.113.7'], '10.0.0.1')).toBe('203.0.113.7')
    expect(clientAddress('1.2.3.4, 203.0.113.7, ', '10.0.0.1')).toBe('203.0.113.7')
  })

  it('falls back to the socket address when the header is missing', () => {
    expect(clientAddress(undefined, '::ffff:10.0.0.1')).toBe('10.0.0.1')
    expect(clientAddress('', undefined)).toBe('unknown')
  })

  it('groups IPv6 clients by /64', () => {
    expect(clientAddress('2001:db8:1:2:3:4:5:6', undefined)).toBe('2001:db8:1:2')
  })
})

describe('isUpstreamRateLimit', () => {
  it('reads a 405 from Lighter as a rate limit and nothing else', () => {
    expect(isUpstreamRateLimit(405)).toBe(true)
    for (const status of [200, 400, 403, 404, 429, 451, 500, 502]) expect(isUpstreamRateLimit(status)).toBe(false)
  })
})
