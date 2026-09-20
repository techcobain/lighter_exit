import { type ReactNode } from 'react'

import { API_KEY_INDEX, UNSTAKE_PERIOD_DAYS } from '../lib/config'
import { LABEL_CLASSNAME, LINK_CLASSNAME } from '../lib/recipes'

const FAQ_ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: 'Who is this for?',
    a: 'Anyone who can no longer use the Lighter app, for example because their region is restricted, but still has positions, pool shares, stake or balances on Lighter. Everything here is signed by your own wallet: either as a Lighter API request or, when the API refuses your account, as a call to the Lighter contract on Ethereum.',
  },
  {
    q: 'In what order should I do things?',
    a: (
      <>
        Top to bottom. Unlock API signing once, then cancel orders, close perp positions, exit pools and unstake, because
        they all release assets into the account. Then withdraw. Assets that come back from unstaking land after the{' '}
        {UNSTAKE_PERIOD_DAYS}-day period, so you will need to return once more to withdraw them. Finally check the last
        card for anything parked on Ethereum waiting to be claimed.
      </>
    ),
  },
  {
    q: 'What is "Unlock API signing" and is it safe?',
    a: (
      <>
        Lighter actions are L2 transactions signed with a Lighter API key, not with your Ethereum key. Your wallet
        signs a fixed message and the signature seeds such a key, so the same wallet always produces the same key and
        nothing is stored anywhere. The key is registered on your account at slot {API_KEY_INDEX} (the official apps use
        slots 0 to 3) through the API, or through the contract if the API refuses. It can only act on your Lighter
        account, never on your wallet, and you can revoke it from the Lighter app if you regain access.
      </>
    ),
  },
  {
    q: 'When does it use Ethereum instead of the API?',
    a: 'Every action is first sent to the Lighter API, which is free and executes in seconds. If the API answers that your account is not allowed to use it (or cannot be reached at all), the same action is sent as an Ethereum transaction to the Lighter contract, which costs gas and is picked up by Lighter within a couple of minutes. Any other rejection, for example "insufficient available shares", is shown as is because it would fail on either route. You can also force Ethereum-only mode in step 0. Unstaking and freezing a pool exist only on the API.',
  },
  {
    q: 'How long does each step take?',
    a: 'API requests execute within seconds and the page shows "Executed" or the rejection reason. Ethereum transactions confirm first, then Lighter picks them up and executes them, usually within about two minutes; the page watches for that. Withdrawals then take Lighter\'s current withdrawal delay (shown in step 5) before the tokens arrive in your wallet.',
  },
  {
    q: 'How are positions closed?',
    a: 'With a reduce-only market order. The "worst price" is a bound derived from the current mark price and the slippage you set: the order fills against the live order book but never worse than that bound. If the book is thinner than your bound, the leftover is cancelled and you can send another order. Reduce-only orders can never open or flip a position.',
  },
  {
    q: 'I operate a public pool. How do I close it?',
    a: 'Select the pool in the account list. Close its positions and cancel its orders first, then freeze it: a frozen pool accepts no new deposits and lets you, the operator, burn all your shares even while depositors still hold theirs. Depositors burn their own shares from their own accounts. Freezing is signed by your main account and only exists on the API.',
  },
  {
    q: 'What is "balances waiting on Ethereum"?',
    a: 'When Lighter withdraws to a wallet it can\'t push tokens to, it leaves them in the contract under your address instead. The last card reads the contract directly and lets you claim anything found there with a normal Ethereum transaction.',
  },
  {
    q: 'What about amounts below the minimum?',
    a: 'Each asset has a minimum withdrawal amount set by Lighter. Anything under it is shown as "below minimum" and cannot be withdrawn directly. On a sub-account you can still move it into the main account (transfers between your own accounts have no minimum and no fee) and withdraw it from there once the pieces add up. Dust left on the main account stays there.',
  },
  {
    q: 'Should I move sub-account balances to the main account first?',
    a: 'It is optional but usually better: a same-main-account transfer is free and instant, it pools dust that could not be withdrawn on its own, and you end up with one withdrawal per asset instead of one per account. Withdrawing straight from a sub-account to your wallet also works and is the only option if the API refuses the transfer.',
  },
  {
    q: 'Which wallets work?',
    a: 'Any EVM wallet that signs plain contract calls and messages reliably: Rabby, MetaMask, Rainbow, Coinbase Wallet, hardware wallets through them, or WalletConnect where enabled. Phantom and similar Solana-first wallets are detected but disabled because they have failed to sign these calls correctly.',
  },
  {
    q: 'Can I verify what I am signing?',
    a: (
      <>
        Yes. Ethereum transactions go to the Lighter contract at{' '}
        <a href="https://etherscan.io/address/0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7" target="_blank" rel="noreferrer" className={LINK_CLASSNAME}>
          0x3B4D…5ca7
        </a>
        , and your wallet shows the function and arguments before you confirm. API requests are signed in your browser
        by Lighter&apos;s own signer (the same WebAssembly module the Lighter app uses) with the key derived above, and
        every one of them is listed on Lighter&apos;s explorer with a link from this page. The page holds no keys and sends
        nothing without your action.
      </>
    ),
  },
]

export function Faq() {
  return (
    <div className="flex flex-col gap-4">
      <span className={LABEL_CLASSNAME}>FAQ</span>
      <div className="flex flex-col">
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="group border-b-[0.5px] border-line last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 text-md font-medium text-ink transition-colors hover:text-ink/80 [&::-webkit-details-marker]:hidden">
              {item.q}
              <span className="text-faint transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="max-w-[68ch] pb-4 text-md leading-2xl text-dim">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  )
}
