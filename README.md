# Lighter Exit

Single-page app that lets a Lighter user wind their account down without the
Lighter app: cancel orders, close perp positions, exit public pools, unstake
from the staking pool, withdraw every asset, and claim anything parked in the
L1 contract. Built for users whose region is restricted.

It covers both Lighter deployments, which are separate exchanges:

| | Lighter | Lighter RH |
| --- | --- | --- |
| Contract chain | Ethereum (1) | Robinhood Chain (4663) |
| ZkLighter contract | `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7` | `0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d` |
| API | `mainnet.zklighter.elliot.ai` | `api.rh.lighter.xyz` |
| Lighter chain id (signing) | 304 | 466324 |
| Collateral | USDC | USDG |
| L1 Priority Transactions | L1CoreMessaging (after the 2026-11-08 split) | on ZkLighter itself |

When a wallet connects, the page looks the address up on both and shows the
one that has an account, labelled. A switch between the two appears only when
both have an account, when neither does (a withdrawal can still be parked in
either contract), or when one lookup failed. The choice is made once per
address; after that only the user changes it. Action history and unlocked keys
are dropped on a switch, and a signing key unlocked on one deployment cannot
sign for the other (`src/lib/environments.ts`, `src/lib/signer.ts`).

Every action is sent to the Lighter API first (an L2 transaction signed in the
browser with a key derived from the user's wallet). When the API refuses the
account (blacklist code 52001, permission code 23100, a 403/451 edge block, or
the API being unreachable) the same action is sent to the Lighter contract
instead (on Ethereum for Lighter, on Robinhood Chain for Lighter RH). The user
can also force contract-only mode.

## How it works

| Step | API route (default) | Contract fallback |
| --- | --- | --- |
| 0 · Unlock signing | wallet `personal_sign` → seed → Lighter key → `ChangePubKey` (tx 8) | `changePubKey(uint48,uint8,bytes)` |
| 1 · Cancel orders | `CancelAllOrders` (tx 16) | `cancelAllOrders(uint48)` |
| 2 · Close perps | reduce-only IOC market order (tx 14) | `createOrder(uint48,uint16,uint48,uint32,uint8,uint8)` |
| 3 · Exit pools | `BurnShares` (tx 19) | `burnShares(uint48,uint48,uint64)` |
| 4 · Unstake | `UnstakeAssets` (tx 36) | none (L2 only) |
| 5 · Withdraw | `Withdraw` (tx 13), spot route 1 and perps route 0 | `withdraw(uint48,uint16,uint8,uint64)` |
| 6 · Claim on L1 | — | `withdrawPendingBalance(address,uint16,uint128)` |
| Pool operators | `UpdatePublicPool` status 1 (freeze, tx 11), then burn operator shares | burn only |

Amounts are converted with the market's `supported_size_decimals` /
`supported_price_decimals` and the asset's L2 `decimals` from the public API.
Results of Ethereum transactions are read back through
`/api/v1/txFromL1TxHash`, which reports Lighter's execution error if any; API
transactions are read back through `/api/v1/tx?by=hash`.

The signing key is derived deterministically: `personal_sign` of a fixed
message → `NewSeedKeyManager` in Lighter's Go signer, compiled to WebAssembly
(`public/lighter-signer.wasm`, from `elliottech/lighter-go` `web-wasm`). It is
registered at API key slot 250 (configurable) so the official apps' slots are
never touched. Nothing is persisted.

The message is laid out as a Sign-In with Ethereum (EIP-4361) message naming
the site it is requested from and the signing wallet, with a constant nonce and
timestamp so the signature stays the same. The key therefore belongs to one
domain: wallets that understand the format warn when another site asks for a
signature naming this one, and a copy of the page elsewhere derives a different
key. Moving the page to a new domain means each user registers a new key (one
extra signature).

## Security

- **Nothing is stored server-side.** The server is stateless: no database,
  sessions, cookies or request logs, and no secrets. The platform in front of it
  may keep its own HTTP logs.
- **Headers.** Every response carries a Content-Security-Policy (scripts only
  from this origin, no inline script or `eval`, network access only to this
  origin plus the origins the build was configured with, no framing), HSTS,
  `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy: no-referrer`. The
  build writes the allowed origins to `dist/csp.json`; `CSP_CONNECT_SRC` adds
  more at runtime.
- **Proxy.** `/lighter-api` only forwards GET/POST under `/api/v1/` to one fixed
  host. It is rate limited per client address, caps POST bodies and concurrent
  upstream requests, and streams responses instead of buffering them.
- **Signer binary.** `scripts/build-wasm.sh` is reproducible (pinned lighter-go
  commit and Go version, `-trimpath`), and `scripts/signer.sha256` records the
  result. `npm run build` refuses to build when the files in `public/` differ
  from those hashes, so replacing the signer always shows up as a hash change.
  To audit: run the script and check `git diff --exit-code public scripts/signer.sha256`.
- **Slippage.** Closing orders above 10% max slippage needs an explicit
  confirmation that shows the worst prices and the possible cost.

## Layout

- `src/` — Vite + React 19 + Tailwind v4 SPA. Design tokens and recipes are
  copied from the Lighter page kit (via the prover-claim page).
- `src/lib/` — API client, contract ABI, decimal maths, wasm signer wrapper,
  and `plan.ts`, which turns an account snapshot into the exit plan.
- `src/hooks/useExitAction.ts` — API-first runner with the contract fallback.
- `src/lib/environments.ts` — the two deployments and which one is active.
- `server/index.mjs` — dependency-free Node server: serves `dist/`, exposes
  `/healthz`, and proxies `/lighter-api/*` (Lighter) and `/lighter-api-rh/*`
  (Lighter RH) to the Lighter APIs so browsers never call Lighter's domains
  directly.
- `public/lighter-signer.wasm`, `public/wasm_exec.js` — Go signer build. Rebuild
  with `scripts/build-wasm.sh` (needs the pinned Go version; both files must come
  from the same toolchain). Hashes live in `scripts/signer.sha256`.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173, proxies /lighter-api to mainnet
npm run check      # typecheck + unit tests + production build
```

Use the read-only preview (paste an address) to inspect any account without a
wallet.

## Configure

See `.env.example`. Build-time `VITE_*` variables are baked into the bundle, so
never put a secret in one (an RPC URL with an API key becomes public); `PORT`,
`LIGHTER_API_URL`, `LIGHTER_RH_API_URL` and the proxy limits are read by the server at runtime.

For testing the contract route (on a staging deploy, not production), build
with `VITE_FORCE_L1_OPTION=1`. The page then shows a "force contract calls"
switch with two settings. "Trading only" sends closing positions and cancelling
orders to the contract and leaves everything else on the API. "Everything"
also sends key registration and every other step that has a contract route, as
if the API had refused the account. Unstaking and freezing a pool have no
contract route and keep using the API.

## Deploy on Railway

The repo ships a `Dockerfile` and `railway.json`. Create a service from the
repo; Railway builds the image, sets `PORT`, and probes `/healthz`. Pass any
`VITE_*` values as build args or service variables. Pick a region that is not
restricted by Lighter, since the proxy's egress IP is what the API sees.

## Verification notes

- Contract selectors were recovered from the implementation bytecode
  (`0xb9B30C7Ac4eCBf756bc68D7b12c842E415A9cA8e`) and matched against real
  transactions and `eth_call` simulations.
- Unit tests in `tests/` cover the decimal maths, the worst-price bound and the
  plan builder against a real account shape.
