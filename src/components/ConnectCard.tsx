import { useMemo, useState } from 'react'

import { getAddress, isAddress } from 'viem'
import { useConnect } from 'wagmi'

import cn from '../lib/cn'
import { describeError } from '../lib/format'
import {
  BTN_SECONDARY_CLASSNAME,
  CARD_CLASSNAME,
  INPUT_CLASSNAME,
  LABEL_CLASSNAME,
  LINK_CLASSNAME,
} from '../lib/recipes'
import { isSupportedConnector } from '../wagmi'

const UNSUPPORTED_HINT = 'Not supported: this wallet has failed to sign Lighter contract calls. Use Rabby or MetaMask instead.'

export function ConnectCard({ onPreview }: { onPreview: (address: string) => void }) {
  const { connectors, connect, isPending, error, variables } = useConnect()
  const [manual, setManual] = useState('')

  const list = useMemo(() => {
    const hasDiscovered = connectors.some((c) => c.type === 'injected' && c.id !== 'injected')
    return connectors
      .filter((c) => !(c.id === 'injected' && hasDiscovered))
      .map((c) => ({ connector: c, supported: isSupportedConnector(c) }))
      .sort((a, b) => Number(b.supported) - Number(a.supported))
  }, [connectors])
  const supportedCount = list.filter((x) => x.supported).length

  const manualTrimmed = manual.trim()
  const manualValid = isAddress(manualTrimmed, { strict: false })
  const pendingUid =
    isPending && variables && 'connector' in variables && variables.connector && 'uid' in variables.connector
      ? (variables.connector as { uid: string }).uid
      : null

  return (
    <div className={`${CARD_CLASSNAME} flex flex-col gap-5 p-6`}>
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium tracking-heading text-ink">Connect your wallet</h2>
        <p className="max-w-[56ch] text-md leading-2xl text-dim">
          Use the Ethereum wallet that owns your Lighter account. Rabby, MetaMask and other EVM wallets work well.
          Phantom and similar multi-chain wallets are shown but disabled: they sign these contract calls unreliably.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL_CLASSNAME}>Wallets</span>
        {list.length === 0 ? (
          <p className="text-sm text-warn">
            No wallet extension detected. Install{' '}
            <a href="https://rabby.io" target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>Rabby</a> or{' '}
            <a href="https://metamask.io" target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>MetaMask</a>, or open this page inside a
            wallet&apos;s browser.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {list.map(({ connector: c, supported }) => (
              <button
                key={c.uid}
                type="button"
                disabled={isPending || !supported}
                title={supported ? undefined : UNSUPPORTED_HINT}
                aria-disabled={!supported}
                onClick={() => supported && connect({ connector: c })}
                className={cn(BTN_SECONDARY_CLASSNAME, !supported && 'cursor-not-allowed opacity-40 grayscale')}
              >
                {c.icon && <img data-icon="" src={c.icon} alt="" className="size-4 rounded-sm" />}
                {pendingUid === c.uid ? 'Connecting…' : c.name === 'Injected' ? 'Browser wallet' : c.name}
                {!supported && <span className="text-2xs text-faint">not supported</span>}
              </button>
            ))}
          </div>
        )}
        {list.length > 0 && supportedCount === 0 && (
          <p className="text-sm text-warn">
            Only unsupported wallets were detected. Install{' '}
            <a href="https://rabby.io" target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>Rabby</a> or{' '}
            <a href="https://metamask.io" target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>MetaMask</a> and import the same seed or
            private key, then reload.
          </p>
        )}
        {list.some((x) => !x.supported) && supportedCount > 0 && (
          <p className="text-sm leading-md text-faint">{UNSUPPORTED_HINT}</p>
        )}
        {error && <p className="text-sm text-danger">Couldn&apos;t connect: {describeError(error)}</p>}
      </div>

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-line" />
        <span className="text-2xs tracking-caps text-faint uppercase">or look up an address first</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (manualValid) onPreview(getAddress(manualTrimmed))
        }}
      >
        <label htmlFor="preview-address" className={LABEL_CLASSNAME}>
          Read-only preview
        </label>
        <div className="flex gap-2 max-mobile:flex-col">
          <input
            id="preview-address"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            aria-invalid={manualTrimmed.length > 0 && !manualValid}
            className={`${INPUT_CLASSNAME} font-mono`}
          />
          <button type="submit" disabled={!manualValid} className={`${BTN_SECONDARY_CLASSNAME} shrink-0`}>
            Show what&apos;s left
          </button>
        </div>
        <p className="text-sm leading-md text-faint">
          See the positions, pool shares, stake and balances of any address without connecting. You&apos;ll need to connect to act on them.
        </p>
      </form>
    </div>
  )
}
