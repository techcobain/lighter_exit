import { describe, expect, it } from 'vitest'

import { chooseRoute, forcesL1, type RouteInput } from '../src/lib/route'

const base: RouteInput = { mode: 'api', forceL1: false, hasL2: true, hasL1: true, keyReady: true }

describe('chooseRoute', () => {
  it('goes through the API when the key is registered', () => {
    expect(chooseRoute(base)).toBe('api')
  })

  it('uses the contract when no key is registered or in contract-only mode', () => {
    expect(chooseRoute({ ...base, keyReady: false })).toBe('l1')
    expect(chooseRoute({ ...base, mode: 'l1' })).toBe('l1')
  })

  it('forces the contract for every action that has a contract route', () => {
    expect(chooseRoute({ ...base, forceL1: true })).toBe('l1')
    expect(chooseRoute({ ...base, forceL1: true, keyReady: false })).toBe('l1')
  })

  it('keeps API-only actions on the API even when contract calls are forced', () => {
    expect(chooseRoute({ ...base, forceL1: true, hasL1: false })).toBe('api')
  })

  it('reports why an API-only action cannot run', () => {
    expect(chooseRoute({ ...base, hasL1: false, keyReady: false })).toBe('needs-key')
    expect(chooseRoute({ ...base, hasL1: false, mode: 'l1' })).toBe('api-only')
  })
})

describe('forcesL1', () => {
  it('forces nothing when the switch is off', () => {
    expect(forcesL1('off', true)).toBe(false)
    expect(forcesL1('off', false)).toBe(false)
  })

  it('forces only trading actions in the trading scope', () => {
    expect(forcesL1('trading', true)).toBe(true)
    expect(forcesL1('trading', false)).toBe(false)
  })

  it('forces every action in the all scope', () => {
    expect(forcesL1('all', true)).toBe(true)
    expect(forcesL1('all', false)).toBe(true)
  })
})
