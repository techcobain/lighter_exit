import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { mainnet, robinhood } from 'viem/chains'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// In development the Lighter APIs are reached through the same prefixes the
// production server proxies, so the client code is identical.
const proxies = {
  '/lighter-api': process.env.LIGHTER_API_URL ?? 'https://mainnet.zklighter.elliot.ai',
  '/lighter-api-rh': process.env.LIGHTER_RH_API_URL ?? 'https://api.rh.lighter.xyz',
}

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null
  } catch {
    return null
  }
}

/**
 * Writes dist/csp.json: the external origins this build talks to, which the
 * production server turns into its Content-Security-Policy. Derived from the
 * same VITE_* values the bundle is built with, so the two cannot drift.
 */
function cspManifest(env: Record<string, string>): Plugin {
  return {
    name: 'csp-manifest',
    apply: 'build',
    generateBundle() {
      const connectSrc = new Set<string>()
      const imgSrc = new Set<string>()
      const fontSrc = new Set<string>()
      const frameSrc = new Set<string>()

      // JSON-RPC of each deployment's L1: the configured endpoint, or viem's default for the chain (see src/wagmi.ts).
      for (const url of [
        env.VITE_ETH_RPC_URL?.trim() || mainnet.rpcUrls.default.http[0],
        env.VITE_RH_RPC_URL?.trim() || robinhood.rpcUrls.default.http[0],
      ]) {
        const rpc = originOf(url)
        if (rpc) connectSrc.add(rpc)
      }

      // Only when the browser calls a Lighter API directly instead of through this server's proxy.
      for (const base of [env.VITE_LIGHTER_API_BASE, env.VITE_LIGHTER_RH_API_BASE]) {
        const api = originOf(base?.trim())
        if (api) connectSrc.add(api)
      }

      // WalletConnect relay, modal assets and verify iframe (per WalletConnect's CSP guidance).
      if (env.VITE_WALLETCONNECT_PROJECT_ID?.trim()) {
        for (const host of ['walletconnect.com', 'walletconnect.org']) {
          connectSrc.add(`https://*.${host}`)
          connectSrc.add(`wss://*.${host}`)
          frameSrc.add(`https://verify.${host}`)
        }
        for (const host of ['web3modal.org', 'web3modal.com', 'reown.com']) connectSrc.add(`https://*.${host}`)
        imgSrc.add('https:')
        fontSrc.add('https://fonts.reown.com')
      }

      this.emitFile({
        type: 'asset',
        fileName: 'csp.json',
        source: `${JSON.stringify(
          { connectSrc: [...connectSrc], imgSrc: [...imgSrc], fontSrc: [...fontSrc], frameSrc: [...frameSrc] },
          null,
          2,
        )}\n`,
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), cspManifest(loadEnv(mode, process.cwd(), 'VITE_'))],
  server: {
    // Longest prefix first: '/lighter-api' would otherwise also match '/lighter-api-rh'.
    proxy: Object.fromEntries(
      Object.entries(proxies)
        .sort(([a], [b]) => b.length - a.length)
        .map(([prefix, target]) => [
          prefix,
          { target, changeOrigin: true, rewrite: (path: string) => path.slice(prefix.length) },
        ]),
    ),
  },
  build: {
    // The signer wasm lives in public/ and is copied verbatim; nothing else is large.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}))
