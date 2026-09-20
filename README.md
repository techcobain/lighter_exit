# Lighter Exit

Single-page app that lets a Lighter user wind their account down without the
Lighter app: cancel orders, close perp positions, exit public pools, unstake
from the staking pool, withdraw every asset, and claim anything parked in the
L1 contract. Built for users whose region is restricted.

Every action is sent to the Lighter API first (an L2 transaction signed in the
browser with a key derived from the user's wallet). When the API refuses the
account (blacklist code 52001, permission code 23100, a 403/451 edge block, or
the API being unreachable) the same action is sent to the Lighter contract on
Ethereum instead. The user can also force Ethereum-only mode.

## How it works

| Step | API route (default) | Ethereum fallback |
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

## Layout

- `src/` — Vite + React 19 + Tailwind v4 SPA. Design tokens and recipes are
  copied from the Lighter page kit (via the prover-claim page).
- `src/lib/` — API client, contract ABI, decimal maths, wasm signer wrapper,
  and `plan.ts`, which turns an account snapshot into the exit plan.
- `src/hooks/useExitAction.ts` — API-first runner with the Ethereum fallback.
- `server/index.mjs` — dependency-free Node server: serves `dist/`, exposes
  `/healthz`, and proxies `/lighter-api/*` to the Lighter API so browsers never
  call Lighter's domain directly.
- `public/lighter-signer.wasm`, `public/wasm_exec.js` — Go signer build. Rebuild
  with `scripts/build-wasm.sh` (needs Go; both files must come from the same
  toolchain).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173, proxies /lighter-api to mainnet
npm run check      # typecheck + unit tests + production build
```

Use the read-only preview (paste an address) to inspect any account without a
wallet.

## Configure

See `.env.example`. Build-time `VITE_*` variables are baked into the bundle;
`PORT` and `LIGHTER_API_URL` are read by the server at runtime.

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
