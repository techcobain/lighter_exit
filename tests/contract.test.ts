import { encodeFunctionData, keccak256, toFunctionSelector, toHex } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  EIP1967_IMPLEMENTATION_SLOT,
  coreMessagingAbi,
  legacyPriorityAbi,
  priorityRouteFor,
  resolveL1Call,
  zkLighterAbi,
} from '../src/lib/contract'

const ZK = '0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7'
const CORE = '0x183ef7195d443a3dA7EC1d7003BaCa1ff490757D'
const LEGACY_IMPL = '0x45a06c03eedc123c34a66bad4691d7ddb26a80a6'
const NEW_IMPL = '0x9b4FDAE9f4490e3bBdC1eAF3C06b48172AC0f94f'
const slotOf = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}` as const
const addrs = { zkLighter: ZK, coreMessaging: CORE } as const

describe('L1 contract ABIs', () => {
  // Selectors read from the deployed bytecode (mainnet 0x15c3…/0x9b4F…, Sepolia 0x2c63…).
  it('matches the selectors deployed on L1CoreMessaging', () => {
    const sel = (name: string) => toFunctionSelector(coreMessagingAbi.find((f) => f.name === name)!)
    expect(sel('createOrder')).toBe('0x3873d062')
    expect(sel('cancelAllOrders')).toBe('0xa4b6f756')
    expect(sel('burnShares')).toBe('0xae150b39')
    expect(sel('withdraw')).toBe('0xd20191bd')
    expect(sel('changePubKey')).toBe('0x17010c68')
  })

  it('keeps the old ZkLighter createOrder selector for the legacy route', () => {
    expect(toFunctionSelector(legacyPriorityAbi.find((f) => f.name === 'createOrder')!)).toBe('0x3c40c676')
    expect(toFunctionSelector(zkLighterAbi.find((f) => f.name === 'withdrawPendingBalance')!)).toBe('0x2f25807e')
  })

  it('uses the EIP-1967 implementation slot', () => {
    expect(EIP1967_IMPLEMENTATION_SLOT).toBe(toHex(BigInt(keccak256(toHex('eip1967.proxy.implementation'))) - 1n))
  })
})

describe('resolveL1Call', () => {
  const order = [6154, 4096n, 20, 70000_0, 1, 1] as const

  it('sends Priority Transactions to L1CoreMessaging with a uint64 market', () => {
    const c = resolveL1Call('createOrder', order, 'core', addrs)
    expect(c.address).toBe(CORE)
    expect(encodeFunctionData(c as never).slice(0, 10)).toBe('0x3873d062')
  })

  it('narrows the market index for the old ZkLighter entry point', () => {
    const c = resolveL1Call('createOrder', order, 'legacy', addrs)
    expect(c.address).toBe(ZK)
    expect(c.args[1]).toBe(4096)
    expect(encodeFunctionData(c as never).slice(0, 10)).toBe('0x3c40c676')
  })

  it('keeps pending-balance claims on ZkLighter on both routes', () => {
    for (const route of ['core', 'legacy'] as const) {
      expect(resolveL1Call('withdrawPendingBalance', [ZK, 3, 1n], route, addrs).address).toBe(ZK)
    }
  })
})

describe('priorityRouteFor', () => {
  const cut = Date.parse('2026-11-08T13:00:00Z')
  it('follows the ZkLighter implementation', () => {
    expect(priorityRouteFor(slotOf(LEGACY_IMPL), LEGACY_IMPL, cut, cut + 1)).toBe('legacy')
    expect(priorityRouteFor(slotOf(NEW_IMPL), LEGACY_IMPL, cut, cut - 1)).toBe('core')
  })
  it('falls back to the cut-over time without a readable slot', () => {
    expect(priorityRouteFor(undefined, LEGACY_IMPL, cut, cut - 1)).toBe('legacy')
    expect(priorityRouteFor(undefined, LEGACY_IMPL, cut, cut)).toBe('core')
  })
})
