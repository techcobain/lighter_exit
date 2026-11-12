// Runs one call against the Lighter L1 contract and follows it all the way:
// wallet signature → L1 confirmation → Lighter picking it up and
// executing it on L2 (which is where reduce-only orders, burns and withdrawals
// can still fail, e.g. "invalid public pool index").

import { useCallback, useRef } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import type { ContractFunctionArgs, ContractFunctionName } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'

import { isPreview, previewApply } from '../dev/preview'
import { L1_TRACK_TIMEOUT_MS } from '../lib/config'
import { EIP1967_IMPLEMENTATION_SLOT, l1Abi, priorityRouteFor, resolveL1Call, type PriorityRoute } from '../lib/contract'
import { describeError } from '../lib/format'
import type { LighterEnvironment } from '../lib/environments'
import { fetchTxFromL1Hash, isExecuted, l2ExecutionError } from '../lib/lighterApi'

import { useActions } from './useActions'
import { useEnvironment } from './useEnvironment'

type WriteFn = ContractFunctionName<typeof l1Abi, 'nonpayable' | 'payable'>

export interface L1ActionRequest<F extends WriteFn = WriteFn> {
  id: string
  label: string
  functionName: F
  args: ContractFunctionArgs<typeof l1Abi, 'nonpayable' | 'payable', F>
  /** Skip waiting for Lighter to execute (e.g. pure L1 pending-balance claims). */
  l1Only?: boolean
  /** Query keys to refresh once Lighter has executed the transaction. */
  invalidate?: readonly (readonly unknown[])[]
}

const POLL_MS = 8_000

type SlotReader = { getStorageAt(a: { address: `0x${string}`; slot: `0x${string}` }): Promise<`0x${string}` | undefined> }

/** Reads where Priority Transactions go right now (on Ethereum, the ZkLighter upgrade flipped it). */
async function currentPriorityRoute(env: LighterEnvironment, client: SlotReader | undefined): Promise<PriorityRoute> {
  const routing = env.priority
  if (routing.kind === 'zklighter') return 'legacy'
  if (routing.override !== 'auto') return routing.override
  let slot: `0x${string}` | undefined
  try {
    slot = await client?.getStorageAt({ address: env.contract, slot: EIP1967_IMPLEMENTATION_SLOT })
  } catch {
    slot = undefined
  }
  return priorityRouteFor(slot, routing.legacyImplementation, routing.cutoverMs, Date.now())
}

export function useL1Action() {
  const { update } = useActions()
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const env = useEnvironment()
  const l1 = env.l1Name
  const publicClient = usePublicClient({ chainId: env.chain.id })
  const queryClient = useQueryClient()
  const trackers = useRef(new Set<string>())

  const trackOnL2 = useCallback(
    async (id: string, txHash: `0x${string}`, invalidate?: readonly (readonly unknown[])[]) => {
      if (trackers.current.has(id)) return
      trackers.current.add(id)
      const started = Date.now()
      try {
        while (Date.now() - started < L1_TRACK_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          let tx = null
          try {
            tx = await fetchTxFromL1Hash(txHash)
          } catch {
            continue
          }
          if (!tx || !isExecuted(tx)) continue
          const err = l2ExecutionError(tx)
          if (err) update(id, { status: 'l2-failed', message: `Lighter rejected it: ${err}` })
          else update(id, { status: 'executed', message: undefined })
          for (const key of invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })
          return
        }
        update(id, {
          status: 'confirmed',
          message:
            `Confirmed on ${l1}, but Lighter has not reported it yet. Refresh the account in a few minutes.`,
        })
      } finally {
        trackers.current.delete(id)
      }
    },
    [l1, queryClient, update],
  )

  /** Returns true when the transaction confirmed on the L1. */
  const run = useCallback(
    async <F extends WriteFn>(req: L1ActionRequest<F>): Promise<boolean> => {
      const { id, label } = req
      update(id, { status: 'preparing', label, route: 'l1', message: undefined, txHash: undefined, l2Hash: undefined })
      if (isPreview) {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
        await wait(500)
        update(id, { status: 'signing', message: 'Confirm in your wallet' })
        await wait(700)
        update(id, { status: 'pending', txHash: `0x${'cd'.repeat(32)}`, message: `Waiting for ${l1} confirmation` })
        await wait(900)
        if (!req.l1Only) {
          update(id, { status: 'l2-waiting', message: `Confirmed on ${l1}. Lighter usually executes within ~2 minutes` })
          await wait(900)
        }
        previewApply(id)
        update(id, { status: 'executed', message: undefined })
        for (const key of req.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })
        return true
      }
      try {
        if (chainId !== env.chain.id) {
          update(id, { status: 'preparing', message: `Switch your wallet to ${l1}` })
          await switchChainAsync({ chainId: env.chain.id })
        }
        const route = await currentPriorityRoute(env, publicClient)
        const call = resolveL1Call(req.functionName, req.args as readonly unknown[], route, {
          zkLighter: env.contract,
          coreMessaging: env.priority.kind === 'core-messaging' ? env.priority.coreMessaging : undefined,
        })
        update(id, { status: 'signing', message: 'Confirm in your wallet' })
        const txHash = await writeContractAsync({ ...call, chainId: env.chain.id } as Parameters<typeof writeContractAsync>[0])
        update(id, { status: 'pending', txHash, message: `Waiting for ${l1} confirmation` })
        if (!publicClient) throw new Error(`no ${l1} client`)
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          update(id, { status: 'error', message: `Transaction reverted on ${l1}` })
          return false
        }
        if (req.l1Only) {
          update(id, { status: 'executed', message: undefined })
          for (const key of req.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })
          return true
        }
        update(id, {
          status: 'l2-waiting',
          message: `Confirmed on ${l1}. Lighter usually executes within ~2 minutes`,
        })
        void trackOnL2(id, txHash, req.invalidate)
        return true
      } catch (err) {
        update(id, { status: 'error', message: describeError(err) })
        return false
      }
    },
    [chainId, env, l1, publicClient, queryClient, switchChainAsync, trackOnL2, update, writeContractAsync],
  )

  /** Runs requests one after another; stops at the first wallet rejection or revert. */
  const runSequence = useCallback(
    async (requests: L1ActionRequest[]): Promise<void> => {
      for (const req of requests) {
        const ok = await run(req)
        if (!ok) break
      }
    },
    [run],
  )

  return { run, runSequence }
}
