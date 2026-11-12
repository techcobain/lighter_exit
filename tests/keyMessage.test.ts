import { describe, expect, it } from 'vitest'

import { keyDerivationMessage } from '../src/lib/signer'

const base = {
  host: 'exit.example.org',
  origin: 'https://exit.example.org',
  address: '0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7',
  accountIndex: 12345,
  apiKeyIndex: 250,
  environmentName: 'Lighter',
  lighterChainId: 304,
  l1ChainId: 1,
}
const rh = { ...base, environmentName: 'Lighter RH', lighterChainId: 466324, l1ChainId: 4663 }

describe('keyDerivationMessage', () => {
  it('is a well-formed Sign-In with Ethereum (EIP-4361) message naming the site', () => {
    const lines = keyDerivationMessage(base).split('\n')
    expect(lines[0]).toBe('exit.example.org wants you to sign in with your Ethereum account:')
    expect(lines[1]).toBe(base.address)
    expect(lines[2]).toBe('')
    // The statement is one line, drawn from the characters EIP-4361 allows.
    expect(lines[3]).toMatch(/^[A-Za-z0-9 .,:()\-_~!$&'*+;=/?#@[\]]+$/)
    expect(lines[3]).toContain('account 12345 on Lighter (API key 250, Lighter chain 304)')
    expect(lines[4]).toBe('')
    expect(lines.slice(5)).toEqual([
      'URI: https://exit.example.org',
      'Version: 1',
      'Chain ID: 1',
      'Nonce: LighterExit304x12345x250',
      'Issued At: 2026-01-01T00:00:00Z',
    ])
    expect(lines[8]!.slice('Nonce: '.length)).toMatch(/^[A-Za-z0-9]{8,}$/)
  })

  it('is deterministic, since the signature over it seeds the key', () => {
    expect(keyDerivationMessage(base)).toBe(keyDerivationMessage({ ...base }))
  })

  it('differs between deployments, so each gets its own key', () => {
    const lines = keyDerivationMessage(rh).split('\n')
    expect(lines[3]).toContain('account 12345 on Lighter RH (API key 250, Lighter chain 466324)')
    expect(lines[7]).toBe('Chain ID: 4663')
    expect(lines[8]).toBe('Nonce: LighterExit466324x12345x250')
    expect(keyDerivationMessage(rh)).not.toBe(keyDerivationMessage(base))
  })

  it('changes with the site, wallet, account and slot', () => {
    const original = keyDerivationMessage(base)
    expect(keyDerivationMessage({ ...base, host: 'evil.example', origin: 'https://evil.example' })).not.toBe(original)
    expect(keyDerivationMessage({ ...base, address: '0x183ef7195d443a3dA7EC1d7003BaCa1ff490757D' })).not.toBe(original)
    expect(keyDerivationMessage({ ...base, accountIndex: 12346 })).not.toBe(original)
    expect(keyDerivationMessage({ ...base, apiKeyIndex: 251 })).not.toBe(original)
  })
})
