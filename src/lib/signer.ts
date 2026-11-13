// Thin wrapper around Lighter's Go signer compiled to WebAssembly
// (lighter-go/web-wasm, built by scripts/build-wasm.sh). It exposes the same
// functions the official web app uses; each returns a function that yields a
// Promise, hence the double call below.

import { activeEnvironment } from './environments'

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
    _signTransfer?: WasmFn<SignedTx>
  }
}

let loading: Promise<void> | null = null
/**
 * Lighter chain id each account's signer was created for. The wasm module
 * keeps one signer per account index, and account indexes repeat across
 * deployments, so this is what stops a key unlocked on one deployment from
 * signing for the same index on another.
 */
const clients = new Map<number, number>()

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
    if (!window.Go) await loadScript(`${import.meta.env.BASE_URL}wasm_exec.js`)
    if (!window.Go) throw new Error('Go runtime did not initialise')
    const go = new window.Go()
    const { instance } = await WebAssembly.instantiateStreaming(fetch(`${import.meta.env.BASE_URL}lighter-signer.wasm`), go.importObject)
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

/** Whether a signer for this account on the active deployment was created in this page session. */
export function hasClient(accountIndex: number): boolean {
  return clients.get(accountIndex) === activeEnvironment().lighterChainId
}

/** Like call(), for functions that sign with an account's cached signer. */
function callFor<T>(accountIndex: number, fn: WasmFn<T> | undefined, name: string, ...args: unknown[]): Promise<T> {
  if (!hasClient(accountIndex)) {
    return Promise.reject(new Error(`API signing is not unlocked for account #${accountIndex} on ${activeEnvironment().name}`))
  }
  return call(fn, name, accountIndex, ...args)
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
 * signChangePubKey afterwards. `lighterChainId` ties every signature the
 * signer makes to one deployment.
 */
export async function createClientFromSeed(params: {
  seedHex: string
  lighterChainId: number
  accountIndex: number
  nonce: number
  apiKeyIndex: number
}): Promise<DerivedKey> {
  await loadSigner()
  clients.delete(params.accountIndex)
  const res = await call(
    window._createClient,
    '_createClient',
    params.seedHex,
    params.lighterChainId,
    params.accountIndex,
    params.nonce,
    params.apiKeyIndex,
  )
  if (!res.pubKeySuccess || !res.body) throw new Error('signer could not build the registration message')
  clients.set(params.accountIndex, params.lighterChainId)
  return { publicKey: res.pk.replace(/^0x/, '').toLowerCase(), registrationMessage: res.body }
}

export function signChangePubKey(p: {
  accountIndex: number
  l1Signature: string
  nonce: number
  apiKeyIndex: number
}): Promise<SignedTx> {
  return callFor(p.accountIndex, window._signChangePubKey, '_signChangePubKey', p.l1Signature, p.nonce, p.apiKeyIndex)
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
  return callFor(p.accountIndex, window._signCreateOrder, '_signCreateOrder', p.marketIndex,
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
  return callFor(p.accountIndex, window._signCancelAllOrders, '_signCancelAllOrders', CANCEL_ALL_IMMEDIATE, 0, p.nonce)
}

export function signBurnShares(p: {
  accountIndex: number
  publicPoolIndex: number
  shareAmount: bigint
  nonce: number
}): Promise<SignedTx> {
  return callFor(p.accountIndex, window._signBurnShares, '_signBurnShares', p.publicPoolIndex, p.shareAmount.toString(), p.nonce)
}

export function signWithdraw(p: {
  accountIndex: number
  assetIndex: number
  routeType: number
  amount: bigint
  nonce: number
}): Promise<SignedTx> {
  return callFor(p.accountIndex, window._signWithdraw, '_signWithdraw', p.assetIndex, p.routeType, p.amount.toString(), p.nonce)
}

export function signUnstakeAssets(p: {
  accountIndex: number
  stakingPoolIndex: number
  shareAmount: bigint
  nonce: number
}): Promise<SignedTx> {
  return callFor(p.accountIndex, window._signUnstakeAssets, '_signUnstakeAssets', p.stakingPoolIndex, p.shareAmount.toString(), p.nonce)
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
  return callFor(p.accountIndex, window._signUpdatePublicPool, '_signUpdatePublicPool', p.publicPoolIndex,
    p.status,
    p.operatorFee,
    p.minOperatorShareRate,
    p.nonce,
  )
}

/**
 * Transfer between accounts. Between accounts of the same main account no L1
 * signature is needed and Lighter charges no fee, which is the only case this
 * page uses (an empty signature is passed).
 */
export function signTransfer(p: {
  accountIndex: number
  toAccountIndex: number
  assetIndex: number
  fromRouteType: number
  toRouteType: number
  amount: bigint
  nonce: number
  apiKeyIndex: number
}): Promise<SignedTx> {
  return callFor(p.accountIndex, window._signTransfer, '_signTransfer', '',
    p.nonce,
    p.apiKeyIndex,
    p.toAccountIndex,
    p.assetIndex,
    p.fromRouteType,
    p.toRouteType,
    Number(p.amount),
    0,
  )
}

/** Short-lived bearer token for Lighter's authenticated reads, signed with the derived key. */
export function createAuthToken(accountIndex: number, apiKeyIndex: number): Promise<{ token: string; deadline: number }> {
  return callFor(accountIndex, window._createAuthToken, '_createAuthToken', apiKeyIndex)
}

/**
 * The message a wallet signs to seed the derived key. Deterministic per site,
 * wallet, deployment, account and slot.
 *
 * It is laid out as a Sign-In with Ethereum (EIP-4361) message so the site it
 * was requested from is part of what gets signed: wallets that understand the
 * format warn when another site asks for a signature naming this one, and a
 * copy of this page on a different domain derives a different, unregistered key.
 * Nonce and timestamp are constants on purpose: the signature must come out the
 * same every time, because it is the key's seed.
 */
export function keyDerivationMessage(p: {
  /** window.location.host of the page asking. */
  host: string
  /** window.location.origin of the page asking. */
  origin: string
  /** Checksummed address of the signing wallet. */
  address: string
  accountIndex: number
  apiKeyIndex: number
  /** Deployment the key is for: its name, Lighter chain id and L1 chain id. */
  environmentName: string
  lighterChainId: number
  l1ChainId: number
}): string {
  return [
    `${p.host} wants you to sign in with your Ethereum account:`,
    p.address,
    '',
    `Derive the Lighter Exit signing key for account ${p.accountIndex} on ${p.environmentName} (API key ${p.apiKeyIndex}, Lighter chain ${p.lighterChainId}). This page uses it to send exit and withdrawal requests to Lighter on your behalf. Signing sends no transaction and costs no gas. Only sign this on ${p.host}.`,
    '',
    `URI: ${p.origin}`,
    'Version: 1',
    `Chain ID: ${p.l1ChainId}`,
    `Nonce: LighterExit${p.lighterChainId}x${p.accountIndex}x${p.apiKeyIndex}`,
    'Issued At: 2026-01-01T00:00:00Z',
  ].join('\n')
}
