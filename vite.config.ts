import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { mainnet, robinhood } from 'viem/chains'
import { defineConfig, loadEnv, type Plugin } from 'vite'

import { DEFAULT_UPSTREAMS } from './server/policy.mjs'

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
interface CspOrigins {
  connectSrc: string[]
  imgSrc: string[]
  fontSrc: string[]
  frameSrc: string[]
}

function cspOrigins(env: Record<string, string>): CspOrigins {
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

  // Lighter's own APIs, which the browser calls first, before this server's proxy
  // (src/lib/apiFallback.ts). Same defaults and 'off' switch as src/lib/environments.ts.
  for (const [name, fallback] of [
    ['VITE_LIGHTER_DIRECT_API_BASE', DEFAULT_UPSTREAMS['/lighter-api']],
    ['VITE_LIGHTER_RH_DIRECT_API_BASE', DEFAULT_UPSTREAMS['/lighter-api-rh']],
  ] as const) {
    const value = env[name]?.trim() || fallback
    const api = value.toLowerCase() === 'off' ? null : originOf(value)
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

  return { connectSrc: [...connectSrc], imgSrc: [...imgSrc], fontSrc: [...fontSrc], frameSrc: [...frameSrc] }
}

function cspManifest(env: Record<string, string>): Plugin {
  return {
    name: 'csp-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'csp.json', source: `${JSON.stringify(cspOrigins(env), null, 2)}\n` })
    },
  }
}

/**
 * IPFS build only: there is no server to send headers, so the policy the server
 * would send (server/index.mjs, buildCsp) goes into the page as a meta tag.
 * A meta CSP cannot carry frame-ancestors, so that directive is dropped.
 */
function cspMetaTag(env: Record<string, string>): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml() {
      const o = cspOrigins(env)
      const directives: Record<string, string[]> = {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'wasm-unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', ...o.imgSrc],
        'font-src': ["'self'", 'data:', ...o.fontSrc],
        'connect-src': ["'self'", ...o.connectSrc],
        'frame-src': o.frameSrc.length ? o.frameSrc : ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      }
      const content = Object.entries(directives)
        .map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`)
        .join('; ')
      return [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' },
        { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
      ]
    },
  }
}

/**
 * `vite build --mode ipfs`: a static copy for IPFS (e.g. pinned on Pinata).
 * No server means no proxy, so the browser calls Lighter's APIs directly
 * unless the VITE_* values say otherwise. Paths are relative so the page
 * works under any gateway path (/ipfs/<cid>/) as well as a subdomain gateway.
 */
const IPFS_API_DEFAULTS = {
  VITE_LIGHTER_API_BASE: DEFAULT_UPSTREAMS['/lighter-api'],
  VITE_LIGHTER_RH_API_BASE: DEFAULT_UPSTREAMS['/lighter-api-rh'],
}

/**
 * The link-preview image (index.html, og:image and twitter:image). Crawlers need
 * an absolute URL, and a page on IPFS cannot know its own host, so each build
 * names one: the production domain, or the ENS name the IPFS copy is served at.
 */
const OG_IMAGE_DEFAULTS = {
  server: 'https://exit.lighter.xyz/og.png',
  ipfs: 'https://exit.lighter.eth.limo/og.png',
}

export default defineConfig(({ mode }) => {
  const ipfs = mode === 'ipfs'
  // Set before Vite reads the environment, so the bundle, the CSP and index.html see the same values.
  if (ipfs) for (const [name, value] of Object.entries(IPFS_API_DEFAULTS)) process.env[name] ||= value
  process.env.VITE_OG_IMAGE_URL ||= ipfs ? OG_IMAGE_DEFAULTS.ipfs : OG_IMAGE_DEFAULTS.server
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    base: ipfs ? './' : '/',
    plugins: [react(), tailwindcss(), ipfs ? cspMetaTag(env) : cspManifest(env)],
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
      outDir: ipfs ? 'dist-ipfs' : 'dist',
      // The signer wasm lives in public/ and is copied verbatim; nothing else is large.
      chunkSizeWarningLimit: 1500,
    },
    test: {
      include: ['tests/**/*.test.ts'],
    },
  }
})
