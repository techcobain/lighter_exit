// Thin wrapper around Lighter's Go signer compiled to WebAssembly
// (lighter-go/web-wasm, built by scripts/build-wasm.sh). It exposes the same
// functions the official web app uses; each returns a function that yields a
// Promise, hence the double call below.

import { LIGHTER_CHAIN_ID } from './config'

type WasmResult<T> = T | { error: string }

interface WasmFn<T> {
  (...args: unknown[]): () => Promise<WasmResult<T>>
}

interface GoRuntime {
  importObject: WebAssembly.Imports
  run(instance: WebAssembly.Instance): Promise<void>
}

export interface SignedTx {
  txHash: string
  txInfo: string
}

declare global {
  interface Window {
    Go?: new () => GoRuntime
    _createClient?: WasmFn<{ pk: string; prv: string; body: string; pubKeySuccess: boolean }>
    _signChangePubKey?: WasmFn<SignedTx>
    _signCreateOrder?: WasmFn<SignedTx>
    _signCancelAllOrders?: WasmFn<SignedTx>
    _signBurnShares?: WasmFn<SignedTx>
    _signWithdraw?: WasmFn<SignedTx>
    _signUnstakeAssets?: WasmFn<SignedTx>
    _signUpdatePublicPool?: WasmFn<SignedTx>
    _createAuthToken?: WasmFn<{ token: string; deadline: number }>
  }
}

let loading: Promise<void> | null = null
const clients = new Set<number>()

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(el)
  })
}

/** Loads wasm_exec.js and the signer wasm once; safe to call repeatedly. */
export function loadSigner(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    if (!window.Go) await loadScript('/wasm_exec.js')
    if (!window.Go) throw new Error('Go runtime did not initialise')
    const go = new window.Go()
    const { instance } = await WebAssembly.instantiateStreaming(fetch('/lighter-signer.wasm'), go.importObject)
    // run() resolves only when the Go program exits, which it never does.
    void go.run(instance)
    const started = Date.now()
    while (!window._createClient) {
      if (Date.now() - started > 10_000) throw new Error('signer did not start')
      await new Promise((r) => setTimeout(r, 25))
    }
  })().catch((err) => {
    loading = null
    throw err
  })
  return loading
}

/** Whether a signer for this account was created in this page session. */
export function hasClient(accountIndex: number): boolean {
  return clients.has(accountIndex)
}

async function call<T>(fn: WasmFn<T> | undefined, name: string, ...args: unknown[]): Promise<T> {
  if (!fn) throw new Error(`signer function ${name} unavailable`)
  const res = await fn(...args)()
  if (res && typeof res === 'object' && 'error' in res && res.error) {
    throw new Error(`signer: ${res.error}`)
  }
  return res as T
}

export interface DerivedKey {
  /** 40-byte public key, hex without 0x — what Lighter lists under /apikeys. */
  publicKey: string
  /** Text the wallet must sign (EIP-191) to authorise registering this key. */
  registrationMessage: string
}

/**
 * Derives a Lighter signing key from a wallet signature (the seed) and caches a
 * signer for `accountIndex` in the wasm module. `nonce` and `apiKeyIndex` are
 * baked into the registration message, so pass the same values to
 * signChangePubKey afterwards.
 */
export async function createClientFromSeed(params: {
  seedHex: string
  accountIndex: number
  nonce: number
  apiKeyIndex: number
}): Promise<DerivedKey> {
  await loadSigner()
  const res = await call(
    window._createClient,
    '_createClient',
    params.seedHex,
    LIGHTER_CHAIN_ID,
    params.accountIndex,
    params.nonce,
    params.apiKeyIndex,
  )
  if (!res.pubKeySuccess || !res.body) throw new Error('signer could not build the registration message')
  clients.add(params.accountIndex)
  return { publicKey: res.pk.replace(/^0x/, '').toLowerCase(), registrationMessage: res.body }
}

export function signChangePubKey(p: {
  accountIndex: number
  l1Signature: string
  nonce: number
  apiKeyIndex: number
}): Promise<SignedTx> {
  return call(window._signChangePubKey, '_signChangePubKey', p.accountIndex, p.l1Signature, p.nonce, p.apiKeyIndex)
}

export const ORDER_TYPE_MARKET_L2 = 1
export const TIME_IN_FORCE_IOC = 0
export const CANCEL_ALL_IMMEDIATE = 0

export function signCreateOrder(p: {
  accountIndex: number
  marketIndex: number
  clientOrderIndex: number
  baseAmount: bigint
  price: bigint
  isAsk: 0 | 1
  reduceOnly: boolean
  nonce: number
}): Promise<SignedTx> {
  return call(
    window._signCreateOrder,
    '_signCreateOrder',
    p.accountIndex,
    p.marketIndex,
    p.clientOrderIndex,
    p.baseAmount.toString(),
    p.price.toString(),
    p.isAsk,
    ORDER_TYPE_MARKET_L2,
    TIME_IN_FORCE_IOC,
    p.reduceOnly ? 1 : 0,
    '0', // trigger price
    0, // order expiry: none for IOC
    p.nonce,
  )
}

export function signCancelAllOrders(p: { accountIndex: number; nonce: number }): Promise<SignedTx> {
  return call(window._signCancelAllOrders, '_signCancelAllOrders', p.accountIndex, CANCEL_ALL_IMMEDIATE, 0, p.nonce)
}

export function signBurnShares(p: {
  accountIndex: number
  publicPoolIndex: number
  shareAmount: bigint
  nonce: number
}): Promise<SignedTx> {
  return call(window._signBurnShares, '_signBurnShares', p.accountIndex, p.publicPoolIndex, p.shareAmount.toString(), p.nonce)
}

export function signWithdraw(p: {
  accountIndex: number
  assetIndex: number
  routeType: number
  amount: bigint
  nonce: number
}): Promise<SignedTx> {
  return call(window._signWithdraw, '_signWithdraw', p.accountIndex, p.assetIndex, p.routeType, p.amount.toString(), p.nonce)
}

export function signUnstakeAssets(p: {
  accountIndex: number
  stakingPoolIndex: number
  shareAmount: bigint
  nonce: number
}): Promise<SignedTx> {
  return call(window._signUnstakeAssets, '_signUnstakeAssets', p.accountIndex, p.stakingPoolIndex, p.shareAmount.toString(), p.nonce)
}

/** Signed by the pool operator's main account, not the pool account. */
export function signUpdatePublicPool(p: {
  accountIndex: number
  publicPoolIndex: number
  status: number
  operatorFee: number
  minOperatorShareRate: number
  nonce: number
}): Promise<SignedTx> {
  return call(
    window._signUpdatePublicPool,
    '_signUpdatePublicPool',
    p.accountIndex,
    p.publicPoolIndex,
    p.status,
    p.operatorFee,
    p.minOperatorShareRate,
    p.nonce,
  )
}

/** Short-lived bearer token for Lighter's authenticated reads, signed with the derived key. */
export function createAuthToken(accountIndex: number, apiKeyIndex: number): Promise<{ token: string; deadline: number }> {
  return call(window._createAuthToken, '_createAuthToken', accountIndex, apiKeyIndex)
}

/** The message a wallet signs to seed the derived key. Deterministic per account and slot. */
export function keyDerivationMessage(accountIndex: number, apiKeyIndex: number): string {
  return [
    'Lighter Exit',
    '',
    'Sign this message to derive a signing key that this page uses to send close, exit and withdrawal requests to Lighter on your behalf.',
    '',
    `Account index: ${accountIndex}`,
    `API key index: ${apiKeyIndex}`,
    `Lighter chain: ${LIGHTER_CHAIN_ID}`,
    '',
    'Signing does not send a transaction or cost gas. Only sign this on the Lighter Exit page.',
  ].join('\n')
}
