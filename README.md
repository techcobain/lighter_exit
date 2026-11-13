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

Trading is never sent through the API: cancelling orders and closing positions
are always transactions the user's wallet sends to the Lighter contract (on
Ethereum for Lighter, on Robinhood Chain for Lighter RH). Every other action is
sent to the Lighter API first (an L2 transaction signed in the browser with a
key derived from the user's wallet). When the API refuses the account
(blacklist code 52001, permission code 23100, a 403/451 edge block, or the API
being unreachable) that action is sent to the contract as well. The user can
also choose contract-only mode. The rule is `DEFAULT_CONTRACT_SCOPE` in
`src/lib/config.ts`, applied by `src/lib/route.ts`.

API requests go straight from the browser to Lighter, so Lighter sees each
user's own address and rate limits each user separately
(`src/lib/apiFallback.ts`). When the browser cannot reach Lighter (no answer,
a read that takes over 15 seconds, or a 403/451 block) the request goes
through this site's server (`/lighter-api`, `/lighter-api-rh`) instead, and so
does every later request in that visit. Only when the server route is refused
as well is the action sent to the contract. While Lighter rate limits the
browser's own address, requests use the server for the cooldown (60 seconds
after a 405, a few seconds after a 429), following Lighter's documented
rate-limit behaviour. A 429 about the user's own wallet (transactions are
limited per address) is not retried from anywhere: it would be the same from
any address. Any other answer from Lighter is final and is not retried through
the server. A rate limit is never treated as Lighter refusing the account, so
it never sends an action to the contract.

## How it works

| Step | API route | Contract route |
| --- | --- | --- |
| 0 · Unlock signing | wallet `personal_sign` → seed → Lighter key → `ChangePubKey` (tx 8) | `changePubKey(uint48,uint8,bytes)` |
| 1 · Cancel orders | not used (`CancelAllOrders`, tx 16, testing only) | **always:** `cancelAllOrders(uint48)` |
| 2 · Close perps | not used (reduce-only IOC market order, tx 14, testing only) | **always:** `createOrder(uint48,uint16,uint48,uint32,uint8,uint8)` |
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
- **Proxy.** `/lighter-api` and `/lighter-api-rh` each forward to one fixed host,
  and only what `server/policy.mjs` lists: the nine reads the page makes, and
  `sendTx` for the transaction types the page sends through the API (8, 11, 12,
  13, 19, 36). Orders (create 14, cancel-all 16), batches and every other
  endpoint are refused before they reach Lighter, so the server cannot be used
  to relay trading. A transaction is forwarded as a body rebuilt from its two
  checked fields, with no query string. `PROXY_ALLOWED_TX_TYPES` replaces the
  list (a staging deploy that tests "API first" adds 14 and 16); a malformed
  value stops the server at startup. When Lighter rate limits the server's
  own address it answers 405 (its firewall, which blocks the address for a
  fixed 60 seconds) or 429 (its API servers, which recover within seconds).
  The proxy then stops forwarding to that API for the cooldown, 60 seconds or
  the upstream Retry-After (5 seconds if none), and answers every request in
  the meantime itself with a 429 marked `x-exit-route-limited`, so nothing it
  sends can prolong the block. A 429 on `sendTx` is different: Lighter limits
  transactions per wallet, not per IP, so it is passed through unchanged and
  does not pause the server. All users who fall back to the server share its
  address towards Lighter, so one heavy client can cause this for all of them.
  Browsers call Lighter directly first, which the Content-Security-Policy
  allows for Lighter's two API origins only. The allowlist applies only to the
  server: a browser talking to Lighter directly is not limited by it, but the
  page itself never sends cancel or close orders through the API. The proxy is also rate limited per client
  address, caps POST bodies and concurrent upstream requests, and streams
  responses instead of buffering them. The Vite dev server's proxy does not
  apply these rules.
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

Use the read-only lookup (paste an address) to inspect any account without a
wallet.

## Configure

See `.env.example`. Build-time `VITE_*` variables are baked into the bundle, so
never put a secret in one (an RPC URL with an API key becomes public); `PORT`,
`LIGHTER_API_URL`, `LIGHTER_RH_API_URL` and the proxy limits are read by the server at runtime.

For testing the routes (on a staging deploy, not production), build with
`VITE_FORCE_L1_OPTION=1`. The page then shows a "contract routing" switch.
"Trading on contract" is the default and what production does. "API first"
also sends cancelling orders and closing positions to the API. "All on
contract" also sends key registration and every other step that has a contract
route to the contract, as if the API had refused the account. Unstaking and
freezing a pool have no contract route and keep using the API.

The `?preview` walkthrough on sample data exists in development builds only
(`npm run dev`); no production build can show it.

## Deploy on Railway

The repo ships a `Dockerfile` and `railway.json`. Create a service from the
repo; Railway builds the image, sets `PORT`, and probes `/healthz`. Pass any
`VITE_*` values as build args or service variables. Pick a region that is not
restricted by Lighter: users whose browser is blocked fall back to the proxy,
and its egress IP is what the API sees then.

## Deploy on AWS Lightsail

The same image also runs on a Lightsail container service (`lighter-exit`,
Tokyo, smallest size). Nothing in the code differs; only how it gets there.

1. A push to `prod` runs `.github/workflows/image.yml`: typecheck, unit tests,
   image build, a smoke test of the container (health, page, and that the proxy
   refuses orders), then publishes `ghcr.io/techcobain/lighter_exit:<commit sha>`.
   The package must be public so Lightsail can pull it.
2. Deploying is a separate, manual step, so nothing reaches customers without a
   person choosing the commit:

   ```bash
   AWS_PROFILE=<profile> scripts/deploy-lightsail.sh <commit sha>
   ```

   The script sets `CLIENT_IP_HEADER=x-forwarded-for`: Lightsail's load balancer
   appends the client address to that header and the server rate limits by its
   last entry.

No AWS credentials are stored in GitHub. As on Railway, the region must be one
Lighter does not restrict, since the server's outbound address is what the API
sees.

## Making changes

Read this before changing how the page behaves. Several rules live in more
than one place and have to move together.

### Branches and releases

- `main` deploys to Railway automatically: the `production` environment on its
  Railway domain, and `staging`, which also shows the routing test switch.
- A push to `prod` also publishes the container image for AWS Lightsail; it is
  deployed there by hand (see "Deploy on AWS Lightsail").
- `prod` is the customer-facing site at `exit.lighter.xyz`. Build it with no
  `VITE_FORCE_L1_OPTION` and no `PROXY_ALLOWED_TX_TYPES`.
- Keep the two on the same commit. Work on `main`, run `npm run check`, try it
  on staging with a real wallet, then fast-forward `prod`
  (`git push origin main:prod`). Anything that touches a contract call or the
  signing key gets a real-wallet run on staging first; unit tests and the
  `?preview` walkthrough do not exercise a wallet.

### The routing rule (API or contract)

Trading (cancelling orders, closing positions) always goes to the contract
from the user's wallet. Everything else tries the API first. To change which
side an action is on, change all of these in the same commit:

1. `src/lib/config.ts`: `DEFAULT_CONTRACT_SCOPE`, and the `trading: true` flag
   on the request in the step component (`src/components/steps/`).
2. `server/policy.mjs`: `DEFAULT_ALLOWED_TX_TYPES`. The proxy refuses any
   transaction type that is not listed, so the page and the server must agree.
   `tests/proxyPolicy.test.ts` fails when they drift.
3. The words. They are written for the current rule: `Hero.tsx`, step 0 in
   `SigningKeyCard.tsx`, the cancel and close step descriptions, `Faq.tsx`
   ("Who is this for", "In what order", "Unlock API signing", "When does it
   use the contract", "How long", "How are positions closed"), the switch
   descriptions in `ForceL1Bar.tsx`, and the routing paragraph and table above.
4. The signing-key message, if it describes what the key is used for (below).

Adding an action: add its type to `TX_TYPE`, give the request a contract route
if one exists, mark it `trading: true` if it places or cancels orders, and add
the type to `server/policy.mjs` only if it is sent through the API. Adding an
API read: add its path to `ALLOWED_READS` in `server/policy.mjs`, or the proxy
answers 404.

### The signing-key message

`keyDerivationMessage` in `src/lib/signer.ts`. The signature over it is the
key's seed, so:

- Changing a single character gives every user a different key. They unlock
  again and the new key replaces the old one in the same slot; nothing is lost,
  but do it on purpose and say so in the commit.
- It names the host the page is opened on. The same build on another domain
  asks for a different signature and derives a different key, so serve
  customers from one address only.
- It must stay a valid one-line EIP-4361 statement and must stay true: it says
  what the page uses the key for. `tests/keyMessage.test.ts` pins both.

### Things that stay off in production

- The `?preview` walkthrough is for `npm run dev` only. Do not add a way to
  turn it on in a production build.
- `VITE_FORCE_L1_OPTION` (routing test switch) and `PROXY_ALLOWED_TX_TYPES`
  (lets the proxy relay orders for that test, needed only when the tester's
  browser cannot reach Lighter directly) are for staging only.
- `VITE_*` values are public. No secrets, no RPC URL with a key in it.

### Other places that are easy to miss

- Which way an API request travels is `src/lib/apiFallback.ts`: straight to
  Lighter, or through the server when the browser is blocked or rate limited.
  Keep its one rule:
  a rate limit, on either route, is never reported as Lighter refusing the
  account, because a refusal sends the action to the contract and costs gas.
  The direct addresses in `src/lib/environments.ts` must match the ones the
  server forwards to (`server/policy.mjs`); a test checks the defaults.
- Wallets: `src/lib/wallets.ts` holds the always-listed wallets and the block
  list; the FAQ entry "Which wallets work?" repeats it in words.
- A second Lighter deployment setting goes in `src/lib/environments.ts`, never
  in a component. Copy that names a chain reads it from there.
- A new external origin the browser talks to must come from a `VITE_*` value
  so the build adds it to the Content-Security-Policy (`vite.config.ts`).
- Rebuilding the signer: `scripts/build-wasm.sh`, then update
  `scripts/signer.sha256`. The build refuses a wasm that does not match.
- Colours, spacing and type come from the shared classes in
  `src/lib/recipes.ts` and the tokens in `src/css/`; reuse them instead of
  adding one-off values.

## Verification notes

- Contract selectors were recovered from the implementation bytecode
  (`0xb9B30C7Ac4eCBf756bc68D7b12c842E415A9cA8e`) and matched against real
  transactions and `eth_call` simulations.
- Unit tests in `tests/` cover the decimal maths, the worst-price bound and the
  plan builder against a real account shape.
