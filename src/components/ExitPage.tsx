import { useEffect, useMemo, useState } from 'react'

import { useAccount } from 'wagmi'

import { useAccountNames, useAccountsByAddress } from '../hooks/useLighterData'
import { useSigningKeys } from '../hooks/useSigningKeys'
import { useWalletGuard } from '../hooks/useWalletGuard'
import { isPreview } from '../dev/preview'
import { ACCOUNT_TYPE } from '../lib/config'
import { describeError } from '../lib/format'
import { CARD_CLASSNAME, LINK_CLASSNAME } from '../lib/recipes'

import { AccountExit } from './AccountExit'
import { AccountPicker, accountDisplayName, sortAccounts } from './AccountPicker'
import { ConnectCard } from './ConnectCard'
import { PreviewCard } from './PreviewCard'
import { Faq } from './Faq'
import { Header } from './Header'
import { Hero } from './Hero'
import { Section } from './Section'
import { SummaryCard } from './SummaryCard'
import { Notice } from './StepCard'
import { PendingBalancesStep } from './steps/PendingBalancesStep'

export function ExitPage() {
  const { address: connected, isConnected } = useAccount()
  const [previewAddress, setPreviewAddress] = useState<`0x${string}` | null>(null)
  const address = isPreview ? previewAddress : isConnected && connected ? connected : previewAddress

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[840px] flex-col px-5 pb-10">
      <Header previewAddress={previewAddress} onExitPreview={() => setPreviewAddress(null)} />
      <main className="flex flex-1 flex-col gap-8">
        <Section d={0}>
          <Hero />
        </Section>
        {isPreview && address && (
          <Notice tone="warn">
            Preview mode: the wallet and every Lighter response to an action are simulated. Nothing is signed or sent anywhere. Remove <span className="font-mono">?preview</span> from the URL to leave.
          </Notice>
        )}

        {address ? (
          <AccountsView address={address} />
        ) : (
          <Section d={1}>
            {isPreview ? (
              <PreviewCard onStart={(a) => setPreviewAddress(a)} />
            ) : (
              <ConnectCard onPreview={(a) => setPreviewAddress(a as `0x${string}`)} />
            )}
          </Section>
        )}

        <Section d={3}>
          <Faq />
        </Section>
      </main>
      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t-[0.5px] border-line pt-5 text-sm text-faint">
        <p>Lighter · Self-service exit</p>
        <p>
          Contract{' '}
          <a
            href="https://etherscan.io/address/0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7"
            target="_blank"
            rel="noreferrer"
            className={`${LINK_CLASSNAME} font-mono`}
          >
            0x3B4D…5ca7
          </a>
        </p>
      </footer>
    </div>
  )
}

function AccountsView({ address }: { address: `0x${string}` }) {
  const accounts = useAccountsByAddress(address)
  const [selected, setSelected] = useState<number | null>(null)
  const guard = useWalletGuard(address)
  const canAct = guard.ready || !!guard.wrongChain
  const reason = guard.ready ? null : guard.reason

  const list = useMemo(() => sortAccounts(accounts.data ?? []), [accounts.data])
  useEffect(() => {
    if (list.length > 0 && (selected === null || !list.some((a) => a.index === selected))) {
      setSelected(list[0]!.index)
    }
  }, [list, selected])
  const current = list.find((a) => a.index === selected) ?? list[0]
  const master = list.find((a) => a.account_type === ACCOUNT_TYPE.MASTER)

  // Sub-account names need an authenticated read; any registered key under this address unlocks it.
  const { keys } = useSigningKeys()
  const tokenAccount = list.find((a) => keys[a.index]?.stage === 'registered')?.index
  const names = useAccountNames(address, tokenAccount)

  if (accounts.isPending) {
    return (
      <Section d={1}>
        <div className="h-40 animate-pulse rounded-panel border-[0.5px] border-line bg-fill" />
      </Section>
    )
  }
  if (accounts.error) {
    return (
      <Section d={1}>
        <Notice tone="danger">Couldn&apos;t reach Lighter: {describeError(accounts.error)}</Notice>
      </Section>
    )
  }
  if (list.length === 0) {
    return (
      <Section d={1}>
        <div className={`${CARD_CLASSNAME} flex flex-col gap-2 p-6`}>
          <h2 className="text-2xl font-medium tracking-heading text-ink">No Lighter account</h2>
          <p className="max-w-[56ch] text-md leading-2xl text-dim">
            Lighter has no account registered to this address. If you deposited from a different wallet, connect that one instead.
          </p>
        </div>
        <div className="mt-8">
          <PendingBalancesStep address={address} canAct={canAct} reason={reason} />
        </div>
      </Section>
    )
  }

  return (
    <>
      {list.length > 1 && (
        <Section d={1}>
          <AccountPicker accounts={list} names={names.data} namesPending={names.isFetching} selected={current?.index ?? list[0]!.index} onSelect={setSelected} />
        </Section>
      )}
      {current && (
        <Section d={2} key={current.index}>
          <AccountExit initial={current} master={master} displayName={accountDisplayName(current, names.data)} />
        </Section>
      )}
      <Section d={2}>
        <PendingBalancesStep address={address} canAct={canAct} reason={reason} />
      </Section>
      <Section d={3}>
        <SummaryCard accounts={list} />
      </Section>
    </>
  )
}
