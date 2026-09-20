// One Lighter signing key per account, derived from a wallet signature and
// registered on the account so the page can send L2 transactions through the
// API. Registration goes through the API too, and falls back to the L1
// changePubKey call when the API refuses the account.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import { useSignMessage } from 'wagmi'

import { isPreview, previewState, PREVIEW_PUBLIC_KEY } from '../dev/preview'
import { API_KEY_INDEX, TX_TYPE } from '../lib/config'
import { describeError } from '../lib/format'
import { fetchApiKey, fetchNextNonce, isRestrictionError, sendTx } from '../lib/lighterApi'
import { createClientFromSeed, keyDerivationMessage, loadSigner, signChangePubKey, type DerivedKey } from '../lib/signer'

import { useL1Action } from './useL1Action'

export type KeyStage =
  | 'idle'
  | 'loading-signer'
  | 'deriving'
  | 'checking'
  | 'registering-api'
  | 'registering-l1'
  | 'registered'
  | 'unregistered'
  | 'error'

export interface KeyState {
  stage: KeyStage
  key?: DerivedKey
  nonce?: number
  message?: string
}

export type RouteMode = 'api' | 'l1'

interface SigningKeysContextValue {
  keys: Record<number, KeyState | undefined>
  mode: RouteMode
  setMode: (mode: RouteMode) => void
  /** Derives the key for an account and registers it if needed. */
  unlock: (accountIndex: number) => Promise<void>
  recheck: (accountIndex: number) => Promise<void>
}

const SigningKeysContext = createContext<SigningKeysContextValue | null>(null)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function isRegistered(accountIndex: number, publicKey: string): Promise<boolean> {
  const info = await fetchApiKey(accountIndex, API_KEY_INDEX).catch(() => null)
  return !!info && info.public_key.replace(/^0x/, '').toLowerCase() === publicKey
}

async function waitForRegistration(accountIndex: number, publicKey: string, timeoutMs: number, everyMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await isRegistered(accountIndex, publicKey)) return true
    await sleep(everyMs)
  }
  return false
}

export function SigningKeysProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<Record<number, KeyState | undefined>>({})
  const [mode, setMode] = useState<RouteMode>('api')
  const { signMessageAsync } = useSignMessage()
  const { run: runL1 } = useL1Action()
  const busy = useRef(new Set<number>())

  const patch = useCallback((accountIndex: number, next: Partial<KeyState>) => {
    setKeys((prev) => ({ ...prev, [accountIndex]: { stage: 'idle', ...prev[accountIndex], ...next } }))
  }, [])

  const registerViaApi = useCallback(
    async (accountIndex: number, key: DerivedKey, nonce: number) => {
      patch(accountIndex, { stage: 'registering-api', message: 'Sign the registration message in your wallet' })
      const l1Signature = await signMessageAsync({ message: key.registrationMessage })
      patch(accountIndex, { message: 'Registering the key with Lighter…' })
      const tx = await signChangePubKey({ accountIndex, l1Signature, nonce, apiKeyIndex: API_KEY_INDEX })
      await sendTx(TX_TYPE.CHANGE_PUB_KEY, tx.txInfo)
      const ok = await waitForRegistration(accountIndex, key.publicKey, 60_000, 1_500)
      if (!ok) throw new Error('Lighter accepted the registration but the key has not appeared yet. Use "Check again" in a minute.')
    },
    [patch, signMessageAsync],
  )

  const registerViaL1 = useCallback(
    async (accountIndex: number, key: DerivedKey) => {
      patch(accountIndex, {
        stage: 'registering-l1',
        message: 'The API refused this account, registering the key through the Ethereum contract instead',
      })
      const confirmed = await runL1({
        id: `regkey-${accountIndex}`,
        label: 'Register signing key',
        functionName: 'changePubKey',
        args: [accountIndex, API_KEY_INDEX, `0x${key.publicKey}`],
      })
      if (!confirmed) throw new Error('Registration transaction did not go through.')
      patch(accountIndex, { message: 'Confirmed on Ethereum, waiting for Lighter to pick the key up (about two minutes)…' })
      const ok = await waitForRegistration(accountIndex, key.publicKey, 15 * 60_000, 10_000)
      if (!ok) throw new Error('Lighter has not picked the key up yet. Use "Check again" in a few minutes.')
    },
    [patch, runL1],
  )

  const unlock = useCallback(
    async (accountIndex: number) => {
      if (busy.current.has(accountIndex)) return
      busy.current.add(accountIndex)
      try {
        if (isPreview) {
          for (const [stage, message] of [['loading-signer', 'Loading the Lighter signer (about 2 MB)…'], ['deriving', 'Sign the message in your wallet to derive the key'], ['registering-api', 'Registering the key with Lighter…']] as const) {
            patch(accountIndex, { stage, message })
            await sleep(700)
          }
          previewState.registered.add(accountIndex)
          patch(accountIndex, { stage: 'registered', key: { publicKey: PREVIEW_PUBLIC_KEY, registrationMessage: '' }, nonce: 0, message: undefined })
          return
        }
        patch(accountIndex, { stage: 'loading-signer', message: 'Loading the Lighter signer (about 2 MB)…' })
        await loadSigner()
        patch(accountIndex, { stage: 'deriving', message: 'Sign the message in your wallet to derive the key' })
        const seed = await signMessageAsync({ message: keyDerivationMessage(accountIndex, API_KEY_INDEX) })
        const nonce = await fetchNextNonce(accountIndex, API_KEY_INDEX)
        const key = await createClientFromSeed({ seedHex: seed, accountIndex, nonce, apiKeyIndex: API_KEY_INDEX })
        patch(accountIndex, { stage: 'checking', key, nonce, message: 'Checking whether the key is registered…' })
        if (await isRegistered(accountIndex, key.publicKey)) {
          patch(accountIndex, { stage: 'registered', message: undefined })
          return
        }
        try {
          await registerViaApi(accountIndex, key, nonce)
        } catch (err) {
          if (!isRestrictionError(err)) throw err
          await registerViaL1(accountIndex, key)
        }
        patch(accountIndex, { stage: 'registered', message: undefined })
      } catch (err) {
        const current = keys[accountIndex]
        patch(accountIndex, { stage: current?.key ? 'unregistered' : 'error', message: describeError(err) })
      } finally {
        busy.current.delete(accountIndex)
      }
    },
    [keys, patch, registerViaApi, registerViaL1, signMessageAsync],
  )

  const recheck = useCallback(
    async (accountIndex: number) => {
      const state = keys[accountIndex]
      if (!state?.key) return
      const ok = await isRegistered(accountIndex, state.key.publicKey)
      patch(accountIndex, { stage: ok ? 'registered' : 'unregistered', message: ok ? undefined : 'Not registered yet.' })
    },
    [keys, patch],
  )

  const value = useMemo(() => ({ keys, mode, setMode, unlock, recheck }), [keys, mode, unlock, recheck])
  return <SigningKeysContext.Provider value={value}>{children}</SigningKeysContext.Provider>
}

export function useSigningKeys(): SigningKeysContextValue {
  const ctx = useContext(SigningKeysContext)
  if (!ctx) throw new Error('useSigningKeys must be used inside SigningKeysProvider')
  return ctx
}

export const KEY_BUSY_STAGES: ReadonlySet<KeyStage> = new Set([
  'loading-signer',
  'deriving',
  'checking',
  'registering-api',
  'registering-l1',
])
