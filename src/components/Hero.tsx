import { PAGE_TITLE_CLASSNAME } from '../lib/recipes'

// Adapted from perps-fe FramedPageHeader: blueprint frame + corner ticks.
const CornerSpans = () => (
  <>
    <span className="pointer-events-none absolute top-px left-px size-1 border border-r-0 border-b-0 border-ink/15" />
    <span className="pointer-events-none absolute top-px right-px size-1 border border-b-0 border-l-0 border-ink/15" />
    <span className="pointer-events-none absolute right-px bottom-px size-1 border border-t-0 border-l-0 border-ink/15" />
    <span className="pointer-events-none absolute bottom-px left-px size-1 border border-t-0 border-r-0 border-ink/15" />
  </>
)

export function Hero() {
  return (
    <div className="relative mb-6 flex w-full flex-col gap-4 border border-ink/5 bg-ink/5 p-5">
      <p className="text-2xs font-medium tracking-caps text-meta uppercase">
        lighter · self-service exit
      </p>
      <h1 className={PAGE_TITLE_CLASSNAME}>Close everything and withdraw</h1>
      <p className="max-w-[58ch] text-md leading-2xl text-dim">
        If you can no longer use the Lighter app, this page lets you wind your
        account down straight from Ethereum: close open perp positions, exit
        public pools, unstake, and withdraw every asset to your wallet. Every
        step is a transaction you sign yourself, sent directly to Lighter&apos;s
        contract.
      </p>
      <CornerSpans />
    </div>
  )
}
