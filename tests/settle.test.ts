import { describe, expect, it } from 'vitest'

import { awaitingRefresh, lastExecutedAt, SETTLE_MS } from '../src/lib/settle'

const executed = { status: 'executed', updatedAt: 100_000 }

describe('awaitingRefresh', () => {
  it('locks an executed action while the data on screen predates it', () => {
    expect(awaitingRefresh(executed, 90_000)).toBe(true)
  })

  it('does not trust a read made right at execution', () => {
    expect(awaitingRefresh(executed, executed.updatedAt + 200)).toBe(true)
    expect(awaitingRefresh(executed, executed.updatedAt + SETTLE_MS - 1)).toBe(true)
  })

  it('releases once a later read has arrived', () => {
    expect(awaitingRefresh(executed, executed.updatedAt + SETTLE_MS)).toBe(false)
  })

  it('never locks an action that has not executed', () => {
    expect(awaitingRefresh(undefined, 0)).toBe(false)
    expect(awaitingRefresh({ status: 'error', updatedAt: 100_000 }, 0)).toBe(false)
    expect(awaitingRefresh({ status: 'l2-failed', updatedAt: 100_000 }, 0)).toBe(false)
  })
})

describe('lastExecutedAt', () => {
  it('returns the latest execution time, ignoring everything else', () => {
    expect(lastExecutedAt([undefined, { status: 'error', updatedAt: 9 }])).toBe(0)
    expect(lastExecutedAt([{ status: 'executed', updatedAt: 5 }, { status: 'executed', updatedAt: 8 }, { status: 'pending', updatedAt: 20 }])).toBe(8)
  })
})
