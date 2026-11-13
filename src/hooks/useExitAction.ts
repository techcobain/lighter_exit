// Runs one exit action. Every action tries the API first (an L2 transaction
// signed with the account's derived key, free and instant) and falls back to
// the L1 contract (Ethereum, or Robinhood Chain for Lighter RH), sent by the
// user's wallet, when the API refuses the account or cannot be reached, or the
// user opted into contract-only mode. Trading actions (cancelling orders,
// closing positions) reach the API only from the browser, never through this
// site's server, so a browser that cannot reach Lighter sends them to the
// contract. See chooseRoute, alwaysContract and lighterApi.sendTx.

import { useCallback } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { isPreview, previewApply } from '../dev/preview'
import { API_KEY_INDEX } from '../lib/config'
import { describeError } from '../lib/format'
import { fetchNextNonce, fetchTxByHash, isExecuted, isRestrictionError, l2ExecutionError, sendTx } from '../lib/lighterApi'
import { alwaysContract, chooseRoute } from '../lib/route'

import { useActions } from './useActions'
import { useRegionRestricted } from './useLighterData'
import { useEnvironment } from './useEnvironment'
import { useContractScope } from './useContractScope'
import { useL1Action, type L1ActionRequest } from './useL1Action'
import { useSigningKeys } from './useSigningKeys'

import type { SignedTx } from '../lib/signer'

export interface ExitActionRequest {
  id: string
  label: string
  /** Account whose key signs the API transaction. */
  accountIndex: number
  /** Places or cancels orders: never relayed by this site's server; the testing switch can send them to the contract. */
  trading?: boolean
  /** Contract only: the API is not tried (a close in a market missing from the browser's market list). */
  forceContract?: boolean
  l2?: { txType: number; sign: (nonce: number) => Promise<SignedTx> }
  /** Contract fallback; omit for actions that only exist on L2 (unstake, freeze). */
  l1?: L1ActionRequest
  invalidate?: readonly (readonly unknown[])[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const L2_RESULT_TIMEOUT_MS = 45_000

export function useExitAction() {
  const { update } = useActions()
  const { keys, mode } = useSigningKeys()
  const scope = useContractScope()
  // Lighter refuses transactions from this region, and trading never goes through the server: straight to the contract.
  const regionRestricted = useRegionRestricted()
  const { run: runL1 } = useL1Action()
  const queryClient = useQueryClient()
  const l1 = useEnvironment().l1Name

  const invalidate = useCallback(
    (keysToInvalidate?: readonly (readonly unknown[])[]) => {
      for (const key of keysToInvalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })
    },
    [queryClient],
  )

  /** Resolves true when the action succeeded (or, for L1, confirmed on the L1 chain). */
  const run = useCallback(
    async (req: ExitActionRequest): Promise<boolean> => {
      const { id, label } = req
      const forceL1 = alwaysContract(scope, !!req.trading) || !!req.forceContract || (!!req.trading && regionRestricted)
      if (isPreview) {
        const route = chooseRoute({ mode, forceL1, hasL2: !!req.l2, hasL1: !!req.l1, keyReady: true }) === 'api' ? 'api' : 'l1'
        const steps: [Parameters<typeof update>[1]['status'], string][] =
          route === 'api'
            ? [['preparing', ''], ['signing', 'Signing with the derived key'], ['l2-waiting', 'Accepted by Lighter, waiting for execution']]
            : [['signing', 'Confirm in your wallet'], ['pending', `Waiting for ${l1} confirmation`], ['l2-waiting', `Confirmed on ${l1}. Lighter usually executes within ~2 minutes`]]
        update(id, { status: 'preparing', label, route, message: undefined, txHash: undefined, l2Hash: undefined })
        for (const [status, message] of steps) {
          await sleep(650)
          update(id, { status, message, ...(status === 'pending' ? { txHash: `0x${'ab'.repeat(32)}` } : {}), ...(status === 'l2-waiting' && route === 'api' ? { l2Hash: `preview-${id}` } : {}) })
        }
        await sleep(650)
        previewApply(id)
        update(id, { status: 'executed', message: undefined })
        invalidate(req.invalidate)
        return true
      }
      const route = chooseRoute({
        mode,
        forceL1,
        hasL2: !!req.l2,
        hasL1: !!req.l1,
        keyReady: keys[req.accountIndex]?.stage === 'registered',
      })
      if (route === 'l1') return runL1(req.l1!)
      if (route !== 'api') {
        update(id, {
          status: 'error',
          label,
          message: route === 'api-only' ? 'This action is only available through the API.' : 'Unlock API signing for this account first.',
        })
        return false
      }

      update(id, { status: 'preparing', label, route: 'api', message: undefined, txHash: undefined, l2Hash: undefined })
      try {
        const nonce = await fetchNextNonce(req.accountIndex, API_KEY_INDEX)
        update(id, { status: 'signing', message: 'Signing with the derived key' })
        const signed = await req.l2!.sign(nonce)
        const res = await sendTx(req.l2!.txType, signed.txInfo)
        update(id, { status: 'l2-waiting', l2Hash: res.tx_hash, message: 'Accepted by Lighter, waiting for execution' })
        const started = Date.now()
        while (Date.now() - started < L2_RESULT_TIMEOUT_MS) {
          await sleep(1_200)
          const tx = await fetchTxByHash(res.tx_hash).catch(() => null)
          if (!tx || !isExecuted(tx)) continue
          const err = l2ExecutionError(tx)
          invalidate(req.invalidate)
          if (err) {
            update(id, { status: 'l2-failed', message: `Lighter rejected it: ${err}` })
            return false
          }
          update(id, { status: 'executed', message: undefined })
          return true
        }
        update(id, { status: 'confirmed', message: 'Accepted, but Lighter has not reported the result yet. Refresh in a minute.' })
        invalidate(req.invalidate)
        return true
      } catch (err) {
        if (isRestrictionError(err) && req.l1) {
          update(id, { status: 'preparing', route: 'l1', message: `The API refused this account; sending through the ${l1} contract instead` })
          await sleep(600)
          return runL1(req.l1)
        }
        update(id, { status: 'error', message: describeError(err) })
        return false
      }
    },
    [invalidate, keys, l1, mode, regionRestricted, runL1, scope, update],
  )

  /** Runs requests one after another; stops at the first failure. */
  const runSequence = useCallback(
    async (requests: ExitActionRequest[]): Promise<void> => {
      for (const req of requests) {
        const ok = await run(req)
        if (!ok) break
      }
    },
    [run],
  )

  return { run, runSequence }
}
