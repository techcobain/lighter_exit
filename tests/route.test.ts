import { describe, expect, it } from 'vitest'

import { DEFAULT_CONTRACT_SCOPE } from '../src/lib/config'
import { alwaysContract, chooseRoute, type RouteInput } from '../src/lib/route'

const base: RouteInput = { mode: 'api', forceL1: false, hasL2: true, hasL1: true, keyReady: true }

describe('chooseRoute', () => {
  it('goes through the API when the key is registered', () => {
    expect(chooseRoute(base)).toBe('api')
  })

  it('uses the contract when no key is registered or in contract-only mode', () => {
    expect(chooseRoute({ ...base, keyReady: false })).toBe('l1')
    expect(chooseRoute({ ...base, mode: 'l1' })).toBe('l1')
  })

  it('uses the contract for an action that always goes there', () => {
    expect(chooseRoute({ ...base, forceL1: true })).toBe('l1')
    expect(chooseRoute({ ...base, forceL1: true, keyReady: false })).toBe('l1')
  })

  it('keeps API-only actions on the API even when the scope sends everything to the contract', () => {
    expect(chooseRoute({ ...base, forceL1: true, hasL1: false })).toBe('api')
  })

  it('reports why an API-only action cannot run', () => {
    expect(chooseRoute({ ...base, hasL1: false, keyReady: false })).toBe('needs-key')
    expect(chooseRoute({ ...base, hasL1: false, mode: 'l1' })).toBe('api-only')
  })
})

describe('alwaysContract', () => {
  it('tries the API first for everything by default, trading included', () => {
    expect(DEFAULT_CONTRACT_SCOPE).toBe('none')
    expect(alwaysContract(DEFAULT_CONTRACT_SCOPE, true)).toBe(false)
    expect(alwaysContract(DEFAULT_CONTRACT_SCOPE, false)).toBe(false)
  })

  it('sends trading to the contract in the trading scope and leaves the rest on the API', () => {
    expect(alwaysContract('trading', true)).toBe(true)
    expect(alwaysContract('trading', false)).toBe(false)
  })

  it('sends nothing to the contract up front in the API-first scope', () => {
    expect(alwaysContract('none', true)).toBe(false)
    expect(alwaysContract('none', false)).toBe(false)
  })

  it('sends every action to the contract in the all scope', () => {
    expect(alwaysContract('all', true)).toBe(true)
    expect(alwaysContract('all', false)).toBe(true)
  })

  it('in the trading scope, routes a close to the contract even with a registered key, and a withdrawal to the API', () => {
    const scope = 'trading'
    expect(chooseRoute({ ...base, forceL1: alwaysContract(scope, true) })).toBe('l1')
    expect(chooseRoute({ ...base, forceL1: alwaysContract(scope, false) })).toBe('api')
  })
})
