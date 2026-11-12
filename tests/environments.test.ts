import { toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'

import { legacyPriorityAbi, resolveL1Call } from '../src/lib/contract'
import { DEFAULT_UPSTREAMS } from '../server/policy.mjs'
import { ENVIRONMENTS, ENVIRONMENT_LIST, chooseEnvironment, offersSwitch } from '../src/lib/environments'

describe('environments', () => {
  it('keeps the two deployments apart on every identifier that must not be shared', () => {
    const { mainnet, rh } = ENVIRONMENTS
    expect(ENVIRONMENT_LIST.map((e) => e.id)).toEqual(['mainnet', 'rh'])
    expect(mainnet.lighterChainId).toBe(304)
    expect(rh.lighterChainId).toBe(466324)
    expect(mainnet.chain.id).toBe(1)
    expect(rh.chain.id).toBe(4663)
    expect(rh.contract).toBe('0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d')
    expect(mainnet.contract).not.toBe(rh.contract)
    expect(mainnet.apiBase).not.toBe(rh.apiBase)
  })

  it('calls the same Lighter API directly as the server forwards to', () => {
    expect(ENVIRONMENTS.mainnet.directApiBase).toBe(DEFAULT_UPSTREAMS['/lighter-api'])
    expect(ENVIRONMENTS.rh.directApiBase).toBe(DEFAULT_UPSTREAMS['/lighter-api-rh'])
  })

  it('sends Lighter RH priority transactions to ZkLighter with the pre-split encoding', () => {
    const { rh } = ENVIRONMENTS
    expect(rh.priority.kind).toBe('zklighter')
    const call = resolveL1Call('createOrder', [7, 4105n, 0, 1000, 1, 1], 'legacy', { zkLighter: rh.contract })
    expect(call.address).toBe(rh.contract)
    expect(call.args[1]).toBe(4105)
    // Selector present in the RH implementation bytecode (0x998e…8faa on Robinhood Chain).
    expect(toFunctionSelector(legacyPriorityAbi.find((f) => f.name === 'createOrder')!)).toBe('0x3c40c676')
    expect(() => resolveL1Call('createOrder', [7, 4105n, 0, 1000, 1, 1], 'core', { zkLighter: rh.contract })).toThrow()
  })
})

describe('chooseEnvironment', () => {
  const pick = (mainnet: string, rh: string) => chooseEnvironment({ mainnet, rh } as never)

  it('shows Lighter as soon as it has an account, without waiting for the other lookup', () => {
    expect(pick('found', 'pending')).toBe('mainnet')
    expect(pick('found', 'found')).toBe('mainnet')
    expect(pick('found', 'error')).toBe('mainnet')
  })

  it('shows Lighter RH only once Lighter is known to have nothing', () => {
    expect(pick('empty', 'found')).toBe('rh')
    expect(pick('error', 'found')).toBe('rh')
    expect(pick('pending', 'found')).toBeNull()
  })

  it('waits while it cannot tell, and falls back to Lighter when nothing is found', () => {
    expect(pick('pending', 'pending')).toBeNull()
    expect(pick('empty', 'pending')).toBeNull()
    expect(pick('empty', 'empty')).toBe('mainnet')
    expect(pick('error', 'error')).toBe('mainnet')
  })
})

describe('offersSwitch', () => {
  it('hides the switch when the shown deployment is the only one with an account', () => {
    expect(offersSwitch('found', 'empty')).toBe(false)
    expect(offersSwitch('found', 'pending')).toBe(false)
  })

  it('offers it when both have accounts, neither does, or the other could not be checked', () => {
    expect(offersSwitch('found', 'found')).toBe(true)
    expect(offersSwitch('empty', 'empty')).toBe(true)
    expect(offersSwitch('found', 'error')).toBe(true)
    expect(offersSwitch('empty', 'found')).toBe(true)
    expect(offersSwitch('error', 'empty')).toBe(true)
  })
})
