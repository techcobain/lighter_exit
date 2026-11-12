// Which wallets the connect card offers. Kept free of wagmi so it can be tested.

export interface WalletConnectorLike {
  id: string
  name: string
  type: string
  uid: string
  rdns?: string | readonly string[]
}

/**
 * Wallets that inject an EVM provider but sign or broadcast unreliably against
 * this contract. Matched against connector id, rdns and name. They are not offered at all.
 */
const BLOCKED_WALLETS = /phantom|solflare|backpack|keplr|glow|magic ?eden/i

function rdnsOf(c: WalletConnectorLike): string[] {
  const rdns = c.rdns
  return [c.id, ...(typeof rdns === 'string' ? [rdns] : (rdns ?? []))]
}

export function isSupportedConnector(c: WalletConnectorLike): boolean {
  return !BLOCKED_WALLETS.test(`${c.name} ${rdnsOf(c).join(' ')}`)
}

/** Always listed, so the page says which wallets it expects; greyed out when the browser does not have them. */
export const FEATURED_WALLETS = [
  { key: 'metamask', name: 'MetaMask', rdns: 'io.metamask', url: 'https://metamask.io' },
  { key: 'rabby', name: 'Rabby', rdns: 'io.rabby', url: 'https://rabby.io' },
] as const

export interface WalletChoice<C> {
  key: string
  name: string
  /** Null when the wallet is listed but was not detected in this browser. */
  connector: C | null
}

/** A wallet announced by an extension (EIP-6963), as opposed to the bare window.ethereum fallback. */
const isDiscovered = (c: WalletConnectorLike) => c.type === 'injected' && c.id !== 'injected'

const announcedAs = (c: WalletConnectorLike, rdns: string) => rdnsOf(c).some((r) => r === rdns || r.startsWith(`${rdns}.`))

/**
 * The featured wallets first (detected or not), then every other supported
 * wallet the browser announced. Blocked wallets are left out, and so is the
 * window.ethereum fallback whenever an extension announced itself: it would be
 * a second button for the same wallet, or a way around the block list.
 */
export function walletChoices<C extends WalletConnectorLike>(connectors: readonly C[]): WalletChoice<C>[] {
  const supported = connectors.filter(isSupportedConnector)
  const featured: WalletChoice<C>[] = FEATURED_WALLETS.map((w) => ({
    key: w.key,
    name: w.name,
    connector: supported.find((c) => isDiscovered(c) && announcedAs(c, w.rdns)) ?? null,
  }))
  const taken = new Set(featured.map((f) => f.connector?.uid))
  const anyDiscovered = connectors.some(isDiscovered)
  const others = supported
    .filter((c) => !taken.has(c.uid) && !(c.id === 'injected' && anyDiscovered))
    .map((c) => ({ key: c.uid, name: c.id === 'injected' ? 'Browser wallet' : c.name, connector: c }))
  return [...featured, ...others]
}
