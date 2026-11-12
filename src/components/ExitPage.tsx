import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import { useAccount } from 'wagmi'

import { ActionsProvider } from '../hooks/useActions'
import { useEnvironment, useEnvironmentPresence } from '../hooks/useEnvironment'
import { useAccountNames, useAccountsByAddress, useLiveAccounts } from '../hooks/useLighterData'
import { SigningKeysProvider, useSigningKeys } from '../hooks/useSigningKeys'
import { useWalletGuard } from '../hooks/useWalletGuard'
import { isPreview } from '../dev/preview'
import { ACCOUNT_TYPE, FORCE_L1_OPTION } from '../lib/config'
import { chooseEnvironment, offersSwitch, setActiveEnvironment, type EnvironmentId } from '../lib/environments'
import { describeError } from '../lib/format'
import { CARD_CLASSNAME, LINK_CLASSNAME, PROSE_CLASSNAME } from '../lib/recipes'

import { AccountExit } from './AccountExit'
import { AccountPicker, accountDisplayName, sortAccounts } from './AccountPicker'
import { ConnectCard } from './ConnectCard'
import { EnvironmentBar, EnvironmentTag, otherDeploymentNote } from './EnvironmentBar'
import { ForceL1Bar } from './ForceL1Bar'
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
  const env = useEnvironment()

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
          <EnvironmentGate address={address} />
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
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            href="https://github.com/techcobain/lighter_exit"
            target="_blank"
            rel="noreferrer"
            className={LINK_CLASSNAME}
          >
            Open source on GitHub ↗
          </a>
          <span>
            Contract{' '}
          <a
            href={`${env.l1ExplorerAddress}${env.contract}`}
            target="_blank"
            rel="noreferrer"
            className={`${LINK_CLASSNAME} font-mono`}
          >
            {env.contract.slice(0, 6)}…{env.contract.slice(-4)}
          </a>{' '}
          on {env.l1Name}
          </span>
        </p>
      </footer>
    </div>
  )
}

/**
 * Decides which Lighter deployment to show for the address, then renders the
 * accounts on it. The address is looked up on every deployment at once; the
 * choice is made once per address and after that only the user changes it, so
 * a later refetch can never move someone to the other exchange mid-exit.
 */
function EnvironmentGate({ address }: { address: `0x${string}` }) {
  const presence = useEnvironmentPresence(address)
  const env = useEnvironment()
  const [selection, setSelection] = useState<{ address: string; id: EnvironmentId } | null>(null)

  const auto = chooseEnvironment({ mainnet: presence.mainnet.status, rh: presence.rh.status })
  if (selection?.address !== address && auto) setSelection({ address, id: auto })
  const target = selection?.address === address ? selection.id : null

  useLayoutEffect(() => {
    if (target) setActiveEnvironment(target)
  }, [target])
  // Back to the default once no address is shown, so the page chrome doesn't keep naming the last one.
  useEffect(() => () => setActiveEnvironment('mainnet'), [])

  if (!target || env.id !== target) {
    return (
      <Section d={1}>
        <div className="h-40 animate-pulse rounded-panel border-[0.5px] border-line bg-fill" />
      </Section>
    )
  }

  // With nothing to choose, the deployment is a tag beside the account list rather than a row of its own.
  const other = presence[env.id === 'mainnet' ? 'rh' : 'mainnet']
  const switchable = offersSwitch(presence[env.id].status, other.status)
  const tag = switchable ? null : <EnvironmentTag env={env} title={otherDeploymentNote(other)} />

  // Keyed by deployment: action history and unlocked keys belong to one exchange and are dropped on a switch.
  return (
    <ActionsProvider key={env.id}>
      <SigningKeysProvider>
        {(switchable || FORCE_L1_OPTION) && (
          <Section d={1}>
            <div className="flex flex-col gap-4">
              {switchable && <EnvironmentBar presence={presence} current={env.id} onSwitch={(id) => setSelection({ address, id })} />}
              <ForceL1Bar />
            </div>
          </Section>
        )}
        <AccountsView address={address} tag={tag} />
      </SigningKeysProvider>
    </ActionsProvider>
  )
}

function AccountsView({ address, tag }: { address: `0x${string}`; tag: ReactNode }) {
  const env = useEnvironment()
  const accounts = useAccountsByAddress(address)
  const [selected, setSelected] = useState<number | null>(null)
  const guard = useWalletGuard(address)
  const canAct = guard.ready || !!guard.wrongChain
  const reason = guard.ready ? null : guard.reason

  // Order comes from the values at load, so cards don't jump around as accounts
  // are emptied; what each card shows comes from the refreshed per-account data.
  const sorted = useMemo(() => sortAccounts(accounts.data ?? []), [accounts.data])
  const list = useLiveAccounts(sorted)
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
        <Notice tone="danger">Couldn&apos;t reach {env.name}: {describeError(accounts.error)}</Notice>
      </Section>
    )
  }
  if (list.length === 0) {
    return (
      <Section d={1}>
        <div className={`${CARD_CLASSNAME} flex flex-col gap-2 p-6 max-mobile:p-4`}>
          <h2 className="text-2xl font-medium tracking-heading text-ink">No {env.name} account</h2>
          <p className={`${PROSE_CLASSNAME} text-md leading-2xl text-dim`}>
            {env.name} ({env.l1Name}) has no account registered to this address. If you deposited from a different wallet, connect that one instead.
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-5">
          {!canAct && reason && <Notice>{reason}</Notice>}
          <PendingBalancesStep address={address} canAct={canAct} reason={reason} />
        </div>
      </Section>
    )
  }

  return (
    <>
      {list.length > 1 && (
        <Section d={1}>
          <AccountPicker accounts={list} names={names.data} namesPending={names.isFetching} selected={current?.index ?? list[0]!.index} onSelect={setSelected} tag={tag} />
        </Section>
      )}
      {/* Steps 0–6 are one list, so the address-level claim card keeps the same gap as the steps above it. */}
      <div className="flex flex-col gap-5">
        {current && (
          <Section d={2} key={current.index}>
            <AccountExit initial={current} master={master} displayName={accountDisplayName(current, names.data)} tag={list.length > 1 ? null : tag} />
          </Section>
        )}
        <Section d={2}>
          <PendingBalancesStep address={address} canAct={canAct} reason={reason} />
        </Section>
      </div>
      <Section d={3}>
        <SummaryCard accounts={list} />
      </Section>
    </>
  )
}
