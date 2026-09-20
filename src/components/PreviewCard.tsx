import { useState } from 'react'

import { getAddress, isAddress } from 'viem'

import { setPreviewSource } from '../dev/preview'
import { BTN_PRIMARY_CLASSNAME, BTN_SECONDARY_CLASSNAME, CARD_CLASSNAME, INPUT_CLASSNAME, LABEL_CLASSNAME } from '../lib/recipes'

/** Entry point of ?preview: pick the address and whether to read real data or fixtures. */
export function PreviewCard({ onStart }: { onStart: (address: `0x${string}`) => void }) {
  const [manual, setManual] = useState('')
  const trimmed = manual.trim()
  const valid = isAddress(trimmed, { strict: false })

  const start = (source: 'live' | 'sample') => {
    if (!valid) return
    const address = getAddress(trimmed)
    setPreviewSource(source, address)
    onStart(address)
  }

  return (
    <div className={`${CARD_CLASSNAME} flex flex-col gap-5 p-6`}>
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-medium tracking-heading text-ink">Preview mode</h2>
        <p className="max-w-[56ch] text-md leading-2xl text-dim">
          Walk through every step without a wallet. Actions are simulated: no message is signed and nothing is sent to
          Lighter or Ethereum. Enter the address to preview as; it is only kept in this tab.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="preview-wallet" className={LABEL_CLASSNAME}>
          Address
        </label>
        <input
          id="preview-wallet"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0x…"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-invalid={trimmed.length > 0 && !valid}
          className={`${INPUT_CLASSNAME} font-mono`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!valid} onClick={() => start('live')} className={BTN_PRIMARY_CLASSNAME}>
          Dry run on this address&apos;s real data
        </button>
        <button type="button" disabled={!valid} onClick={() => start('sample')} className={BTN_SECONDARY_CLASSNAME}>
          Use sample data
        </button>
      </div>
      <p className="text-sm leading-md text-faint">
        Dry run reads the address&apos;s accounts from Lighter and only fakes the actions, so the numbers don&apos;t
        change when you click. Sample data shows a fully loaded main account, a sub-account and an operated pool, and
        the fixtures react to each action.
      </p>
    </div>
  )
}
