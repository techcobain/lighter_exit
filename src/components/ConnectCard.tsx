import { useMemo, useState } from 'react'

import { getAddress, isAddress } from 'viem'
import { useConnect } from 'wagmi'

import cn from '../lib/cn'
import { describeError } from '../lib/format'
import {
  BTN_PRIMARY_CLASSNAME,
  BTN_SECONDARY_CLASSNAME,
  CARD_CLASSNAME,
  HELPER_CLASSNAME,
  INPUT_CLASSNAME,
  LABEL_CLASSNAME,
  LINK_CLASSNAME,
  PROSE_CLASSNAME,
} from '../lib/recipes'
import { isSupportedConnector, walletChoices } from '../lib/wallets'

export function ConnectCard({ onPreview }: { onPreview: (address: string) => void }) {
  const { connectors, connect, isPending, error, variables } = useConnect()
  const [manual, setManual] = useState('')

  const list = useMemo(() => walletChoices(connectors), [connectors])
  const detectedCount = list.filter((x) => x.connector).length
  const blockedDetected = connectors.some((c) => !isSupportedConnector(c))

  const manualTrimmed = manual.trim()
  const manualValid = isAddress(manualTrimmed, { strict: false })
  const pendingUid =
    isPending && variables && 'connector' in variables && variables.connector && 'uid' in variables.connector
      ? (variables.connector as { uid: string }).uid
      : null

  return (
    <div className={`${CARD_CLASSNAME} flex flex-col gap-5 p-6 max-mobile:p-4`}>
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium tracking-heading text-ink">Connect your wallet</h2>
        <p className={`${PROSE_CLASSNAME} text-md leading-2xl text-dim`}>
          Use the wallet that owns your Lighter or Lighter RH account; the page finds which one it is on. Rabby, MetaMask and other EVM wallets work well.
          Phantom and similar multi-chain wallets are not supported: they sign these contract calls unreliably.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL_CLASSNAME}>Wallets</span>
        <div className="flex flex-wrap items-center gap-2">
          {list.map(({ key, name, connector: c }) =>
            c ? (
              <button key={key} type="button" disabled={isPending} onClick={() => connect({ connector: c })} className={BTN_PRIMARY_CLASSNAME}>
                {c.icon && <img data-icon="" src={c.icon} alt="" className="size-4 rounded-sm" />}
                {pendingUid === c.uid ? 'Connecting…' : name}
              </button>
            ) : (
              <button
                key={key}
                type="button"
                disabled
                title={`${name} was not detected in this browser. Install or enable it, then reload.`}
                className={cn(BTN_SECONDARY_CLASSNAME, 'cursor-not-allowed opacity-40')}
              >
                {name}
                <span className="text-2xs text-faint">not detected</span>
              </button>
            ),
          )}
        </div>
        {detectedCount === 0 && (
          <p className="text-sm text-warn">
            No supported wallet detected. Install{' '}
            <a href="https://metamask.io" target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>MetaMask</a> or{' '}
            <a href="https://rabby.io" target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>Rabby</a>
            {blockedDetected
              ? ' and import the same seed or private key, then reload. The wallet in this browser is not supported.'
              : ", then reload, or open this page inside a wallet's browser."}
          </p>
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
          Read-only lookup
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
        <p className={cn(PROSE_CLASSNAME, HELPER_CLASSNAME)}>
          See the positions, pool shares, stake and balances of any address without connecting. You&apos;ll need to connect to act on them.
        </p>
      </form>
    </div>
  )
}
