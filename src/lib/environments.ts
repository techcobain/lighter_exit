// The Lighter deployments this page can wind an account down on. They are
// separate exchanges: accounts, account indexes, API keys and nonces do not
// carry over, and a transaction signed for one is rejected by the other. So
// exactly one is active at a time, and everything that talks to Lighter or to
// its L1 contract reads the active one from here.

import { getAddress, type Address, type Chain } from 'viem'
import { mainnet, robinhood } from 'viem/chains'

const env = import.meta.env
const read = (name: string): string | undefined => (env[name] as string | undefined)?.trim() || undefined

/**
 * Lighter's own API address for a deployment, which the browser calls first;
 * the server route is the fallback. 'off' sends everything through the server;
 * a build that points the server at another Lighter API must set this to match.
 */
const directApi = (name: string, fallback: string): string | null => {
  const value = read(name) ?? fallback
  return value.toLowerCase() === 'off' ? null : value.replace(/\/$/, '')
}

export type EnvironmentId = 'mainnet' | 'rh'

/** Where the L1 Priority Transactions (createOrder, cancelAllOrders, withdraw, changePubKey, burnShares) are sent. */
export type PriorityRouting =
  /** Entry points on the ZkLighter contract itself (the layout before Lighter's L1CoreMessaging split). */
  | { kind: 'zklighter' }
  /**
   * Moved to L1CoreMessaging. 'auto' reads the ZkLighter proxy to tell which
   * side of the move the chain is on; 'core' and 'legacy' force a route.
   */
  | {
      kind: 'core-messaging'
      coreMessaging: Address
      /** The ZkLighter implementation that still exposed them. */
      legacyImplementation: Address
      /** Announced time of the move; only used if the proxy slot cannot be read. */
      cutoverMs: number
      override: 'auto' | 'core' | 'legacy'
    }

export interface LighterEnvironment {
  id: EnvironmentId
  /** 'Lighter' or 'Lighter RH'. */
  name: string
  /** One-line label that tells the two apart at a glance. */
  tag: string
  /** Base URL for the REST API, without the /api/v1 suffix: this site's proxy, used when the browser cannot reach Lighter. */
  apiBase: string
  /** Lighter's own API, called from the browser first; null when that is switched off. */
  directApiBase: string | null
  /** Lighter L2 chain id used when hashing L2 transactions. */
  lighterChainId: number
  /** The L1 the Lighter contract lives on. */
  chain: Chain
  /** What the page calls that chain in running text. */
  l1Name: string
  /** JSON-RPC endpoint for reads and receipt polling; viem's default for the chain when unset. */
  rpcUrl: string | undefined
  l1ExplorerName: string
  l1ExplorerTx: string
  l1ExplorerAddress: string
  /** The ZkLighter contract (EIP-1967 proxy). */
  contract: Address
  priority: PriorityRouting
  /** Explorer page for an L2 transaction hash, or null when there is none to link to. */
  l2ExplorerTx: string | null
  /** Symbol of the perps collateral asset (asset id 3 on both deployments). */
  collateralSymbol: string
}

const MAINNET: LighterEnvironment = {
  id: 'mainnet',
  name: 'Lighter',
  tag: 'Lighter · Ethereum',
  apiBase: (read('VITE_LIGHTER_API_BASE') ?? '/lighter-api').replace(/\/$/, ''),
  directApiBase: directApi('VITE_LIGHTER_DIRECT_API_BASE', 'https://mainnet.zklighter.elliot.ai'),
  lighterChainId: Number(read('VITE_LIGHTER_CHAIN_ID') ?? 304),
  chain: mainnet,
  l1Name: 'Ethereum',
  rpcUrl: read('VITE_ETH_RPC_URL'),
  l1ExplorerName: 'etherscan',
  l1ExplorerTx: 'https://etherscan.io/tx/',
  l1ExplorerAddress: 'https://etherscan.io/address/',
  contract: getAddress(read('VITE_LIGHTER_CONTRACT') ?? '0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7'),
  priority: {
    kind: 'core-messaging',
    // L1CoreMessaging proxy. Implementation 0x15c3FEA3…; never call that directly.
    coreMessaging: getAddress(read('VITE_L1_CORE_MESSAGING_CONTRACT') ?? '0x183ef7195d443a3dA7EC1d7003BaCa1ff490757D'),
    legacyImplementation: getAddress(read('VITE_LEGACY_ZKLIGHTER_IMPL') ?? '0x45a06c03eedc123c34a66bad4691d7ddb26a80a6'),
    cutoverMs: Date.parse('2026-11-08T13:00:00Z'),
    override: (read('VITE_PRIORITY_ROUTE') ?? 'auto') as 'auto' | 'core' | 'legacy',
  },
  l2ExplorerTx: 'https://scan.lighter.xyz/tx/',
  collateralSymbol: 'USDC',
}

/**
 * Lighter on Robinhood Chain. Same API, signer and transaction format as
 * mainnet; its contract still has the Priority Transactions on ZkLighter
 * itself (verified against the implementation bytecode: the uint16-market
 * createOrder is there, the L1CoreMessaging one is not).
 */
const ROBINHOOD: LighterEnvironment = {
  id: 'rh',
  name: 'Lighter RH',
  tag: 'Lighter · Robinhood Chain',
  apiBase: (read('VITE_LIGHTER_RH_API_BASE') ?? '/lighter-api-rh').replace(/\/$/, ''),
  directApiBase: directApi('VITE_LIGHTER_RH_DIRECT_API_BASE', 'https://api.rh.lighter.xyz'),
  lighterChainId: 466324,
  chain: robinhood,
  l1Name: 'Robinhood Chain',
  rpcUrl: read('VITE_RH_RPC_URL'),
  l1ExplorerName: 'blockscout',
  l1ExplorerTx: 'https://robinhoodchain.blockscout.com/tx/',
  l1ExplorerAddress: 'https://robinhoodchain.blockscout.com/address/',
  contract: getAddress('0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d'),
  priority: { kind: 'zklighter' },
  l2ExplorerTx: 'https://robinhoodchain.lighter.xyz/explorer/logs/',
  collateralSymbol: 'USDG',
}

export const ENVIRONMENTS: Record<EnvironmentId, LighterEnvironment> = { mainnet: MAINNET, rh: ROBINHOOD }

/** In display order. */
export const ENVIRONMENT_LIST: readonly LighterEnvironment[] = [MAINNET, ROBINHOOD]

// ── Active environment ─────────────────────────────────────────────────────

let active: LighterEnvironment = MAINNET
const listeners = new Set<() => void>()

export function activeEnvironment(): LighterEnvironment {
  return active
}

export function setActiveEnvironment(id: EnvironmentId): void {
  if (active.id === id) return
  active = ENVIRONMENTS[id]
  for (const listener of [...listeners]) listener()
}

export function subscribeEnvironment(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// ── Choosing an environment for an address ─────────────────────────────────

/** What a lookup of an address on one deployment came back with. */
export type PresenceStatus = 'pending' | 'found' | 'empty' | 'error'

/**
 * Which deployment to show for an address, given what each lookup has returned
 * so far. Null means "not decided yet, keep waiting".
 *
 * Lighter (Ethereum) wins as soon as it has an account, so its users never wait
 * on the other lookup. Lighter RH is picked only once Ethereum is known to have
 * none. With nothing anywhere the page falls back to Ethereum.
 */
export function chooseEnvironment(status: Record<EnvironmentId, PresenceStatus>): EnvironmentId | null {
  if (status.mainnet === 'found') return 'mainnet'
  if (status.mainnet === 'pending' || status.rh === 'pending') return null
  return status.rh === 'found' ? 'rh' : 'mainnet'
}

/**
 * Whether to offer switching deployments. Not when the shown one is the only
 * one with an account (the common case: nothing to choose). Yes when both have
 * one, when neither does (withdrawals can still be parked in either contract),
 * or when the other lookup failed and we cannot tell.
 */
export function offersSwitch(shown: PresenceStatus, other: PresenceStatus): boolean {
  return !(shown === 'found' && (other === 'empty' || other === 'pending'))
}
