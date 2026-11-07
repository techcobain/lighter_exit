// Runs one call against the Lighter L1 contract and follows it all the way:
// wallet signature → Ethereum confirmation → Lighter picking it up and
// executing it on L2 (which is where reduce-only orders, burns and withdrawals
// can still fail, e.g. "invalid public pool index").

import { useCallback, useRef } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import type { ContractFunctionArgs, ContractFunctionName } from 'viem'
import { mainnet } from 'wagmi/chains'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'

import { isPreview, previewApply } from '../dev/preview'
import {
  L1_CORE_MESSAGING_CONTRACT,
  L1_TRACK_TIMEOUT_MS,
  LEGACY_ZKLIGHTER_IMPL,
  LIGHTER_CONTRACT,
  PRIORITY_CUTOVER_MS,
  PRIORITY_ROUTE_OVERRIDE,
} from '../lib/config'
import { EIP1967_IMPLEMENTATION_SLOT, l1Abi, priorityRouteFor, resolveL1Call, type PriorityRoute } from '../lib/contract'
import { describeError } from '../lib/format'
import { fetchTxFromL1Hash, isExecuted, l2ExecutionError } from '../lib/lighterApi'

import { useActions } from './useActions'

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

/** Reads where Priority Transactions go right now (the ZkLighter upgrade flips it). */
async function currentPriorityRoute(client: SlotReader | undefined): Promise<PriorityRoute> {
  if (PRIORITY_ROUTE_OVERRIDE !== 'auto') return PRIORITY_ROUTE_OVERRIDE
  let slot: `0x${string}` | undefined
  try {
    slot = await client?.getStorageAt({ address: LIGHTER_CONTRACT, slot: EIP1967_IMPLEMENTATION_SLOT })
  } catch {
    slot = undefined
  }
  return priorityRouteFor(slot, LEGACY_ZKLIGHTER_IMPL, PRIORITY_CUTOVER_MS, Date.now())
}

export function useL1Action() {
  const { update } = useActions()
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: mainnet.id })
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
            'Confirmed on Ethereum, but Lighter has not reported it yet. Refresh the account in a few minutes.',
        })
      } finally {
        trackers.current.delete(id)
      }
    },
    [queryClient, update],
  )

  /** Returns true when the transaction confirmed on Ethereum. */
  const run = useCallback(
    async <F extends WriteFn>(req: L1ActionRequest<F>): Promise<boolean> => {
      const { id, label } = req
      update(id, { status: 'preparing', label, route: 'l1', message: undefined, txHash: undefined, l2Hash: undefined })
      if (isPreview) {
        const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
        await wait(500)
        update(id, { status: 'signing', message: 'Confirm in your wallet' })
        await wait(700)
        update(id, { status: 'pending', txHash: `0x${'cd'.repeat(32)}`, message: 'Waiting for Ethereum confirmation' })
        await wait(900)
        if (!req.l1Only) {
          update(id, { status: 'l2-waiting', message: 'Confirmed on Ethereum. Lighter usually executes within ~2 minutes' })
          await wait(900)
        }
        previewApply(id)
        update(id, { status: 'executed', message: undefined })
        for (const key of req.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })
        return true
      }
      try {
        if (chainId !== mainnet.id) {
          update(id, { status: 'preparing', message: 'Switch your wallet to Ethereum mainnet' })
          await switchChainAsync({ chainId: mainnet.id })
        }
        const route = await currentPriorityRoute(publicClient)
        const call = resolveL1Call(req.functionName, req.args as readonly unknown[], route, {
          zkLighter: LIGHTER_CONTRACT,
          coreMessaging: L1_CORE_MESSAGING_CONTRACT,
        })
        update(id, { status: 'signing', message: 'Confirm in your wallet' })
        const txHash = await writeContractAsync({ ...call, chainId: mainnet.id } as Parameters<typeof writeContractAsync>[0])
        update(id, { status: 'pending', txHash, message: 'Waiting for Ethereum confirmation' })
        if (!publicClient) throw new Error('no Ethereum client')
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        if (receipt.status !== 'success') {
          update(id, { status: 'error', message: 'Transaction reverted on Ethereum' })
          return false
        }
        if (req.l1Only) {
          update(id, { status: 'executed', message: undefined })
          for (const key of req.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })
          return true
        }
        update(id, {
          status: 'l2-waiting',
          message: 'Confirmed on Ethereum. Lighter usually executes within ~2 minutes',
        })
        void trackOnL2(id, txHash, req.invalidate)
        return true
      } catch (err) {
        update(id, { status: 'error', message: describeError(err) })
        return false
      }
    },
    [chainId, publicClient, queryClient, switchChainAsync, trackOnL2, update, writeContractAsync],
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
