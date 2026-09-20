import { useAccount, useDisconnect } from 'wagmi'

import wordmarkUrl from '../img/lighter-wordmark.svg?raw'
import { isPreview } from '../dev/preview'
import { shortenAddress } from '../lib/format'

export function Header({
  previewAddress,
  onExitPreview,
}: {
  previewAddress: string | null
  onExitPreview: () => void
}) {
  const { address, connector, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  return (
    <header className="flex items-center justify-between gap-4 py-6">
      <a
        href="https://lighter.xyz"
        target="_blank"
        rel="noreferrer"
        aria-label="Lighter"
        className="text-ink transition-opacity hover:opacity-80"
      >
        <span
          className="block h-5 w-auto aspect-(--aspect-wordmark) [&>svg]:h-full [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: wordmarkUrl }}
        />
      </a>
      {isPreview ? (
        <span className="rounded-pill border-[0.5px] border-warn/30 bg-warn/10 px-3 py-1.5 text-2xs font-medium tracking-caps text-warn uppercase">Preview mode</span>
      ) : isConnected && address ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-pill border-[0.5px] border-line bg-fill px-3 py-1.5">
            {connector?.icon && <img src={connector.icon} alt="" className="size-4 rounded-sm" />}
            <span className="font-mono text-sm font-medium text-ink">{shortenAddress(address)}</span>
          </div>
          <button
            type="button"
            onClick={() => disconnect()}
            className="cursor-pointer text-sm text-muted transition-colors hover:text-ink"
          >
            Disconnect
          </button>
        </div>
      ) : previewAddress ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-pill border-[0.5px] border-line bg-fill px-3 py-1.5">
            <span className="text-2xs tracking-caps text-meta uppercase">Read-only</span>
            <span className="font-mono text-sm font-medium text-ink">
              {shortenAddress(previewAddress)}
            </span>
          </div>
          <button
            type="button"
            onClick={onExitPreview}
            className="cursor-pointer text-sm text-muted transition-colors hover:text-ink"
          >
            Change
          </button>
        </div>
      ) : null}
    </header>
  )
}
