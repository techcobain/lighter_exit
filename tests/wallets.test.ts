import { describe, expect, it } from 'vitest'

import { walletChoices, type WalletConnectorLike } from '../src/lib/wallets'

const ext = (id: string, name: string): WalletConnectorLike => ({ id, name, type: 'injected', uid: `uid-${id}` })
const fallback: WalletConnectorLike = { id: 'injected', name: 'Injected', type: 'injected', uid: 'uid-injected' }

const summary = (connectors: WalletConnectorLike[]) =>
  walletChoices(connectors).map((c) => `${c.name}:${c.connector ? 'on' : 'off'}`)

describe('walletChoices', () => {
  it('lists MetaMask and Rabby greyed out when nothing is installed', () => {
    expect(summary([fallback])).toEqual(['MetaMask:off', 'Rabby:off', 'Browser wallet:on'])
    expect(summary([])).toEqual(['MetaMask:off', 'Rabby:off'])
  })

  it('enables only the featured wallet that was detected', () => {
    expect(summary([fallback, ext('io.rabby', 'Rabby Wallet')])).toEqual(['MetaMask:off', 'Rabby:on'])
    expect(summary([fallback, ext('io.metamask', 'MetaMask')])).toEqual(['MetaMask:on', 'Rabby:off'])
    expect(summary([fallback, ext('io.metamask.flask', 'MetaMask Flask')])).toEqual(['MetaMask:on', 'Rabby:off'])
  })

  it('hides blocked wallets and gives them no way in through the fallback', () => {
    expect(summary([fallback, ext('app.phantom', 'Phantom')])).toEqual(['MetaMask:off', 'Rabby:off'])
    expect(summary([fallback, ext('app.phantom', 'Phantom'), ext('io.rabby', 'Rabby Wallet')])).toEqual(['MetaMask:off', 'Rabby:on'])
  })

  it('keeps other supported wallets after the featured ones', () => {
    expect(summary([fallback, ext('com.coinbase.wallet', 'Coinbase Wallet'), ext('io.metamask', 'MetaMask')])).toEqual([
      'MetaMask:on',
      'Rabby:off',
      'Coinbase Wallet:on',
    ])
    const wc: WalletConnectorLike = { id: 'walletConnect', name: 'WalletConnect', type: 'walletConnect', uid: 'uid-wc' }
    expect(summary([fallback, wc])).toEqual(['MetaMask:off', 'Rabby:off', 'Browser wallet:on', 'WalletConnect:on'])
  })
})
