// Production server: serves the built SPA from dist/ and proxies the Lighter
// REST APIs (/lighter-api for Lighter, /lighter-api-rh for Lighter on Robinhood
// Chain) so the browser never has to reach Lighter's domains directly (useful
// for users whose region is blocked from them). The proxy only forwards the
// reads and transaction types listed in policy.mjs; orders are not among them.
//
// Zero dependencies on purpose — only Node 22 built-ins.
import http from 'node:http'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { ALLOWED_READS, SEND_TX_PATH, checkProxyRequest, clientAddress, parseAllowedTxTypes } from './policy.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT ?? 8787)
const upstream = (name, fallback) => (process.env[name] ?? fallback).replace(/\/$/, '')
// Path prefix → the one host it forwards to.
const PROXIES = {
  '/lighter-api': upstream('LIGHTER_API_URL', 'https://mainnet.zklighter.elliot.ai'),
  '/lighter-api-rh': upstream('LIGHTER_RH_API_URL', 'https://api.rh.lighter.xyz'),
}
const PROXY_TIMEOUT_MS = 30_000
// Throws on a malformed list, so a typo stops the server instead of silently changing what is relayed.
const ALLOWED_TX_TYPES = parseAllowedTxTypes(process.env.PROXY_ALLOWED_TX_TYPES)

const envNumber = (name, fallback) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Proxy limits. A signed Lighter transaction is a few kilobytes of form data,
// and one browser session peaks at a few requests per second while it polls.
const MAX_BODY_BYTES = envNumber('PROXY_MAX_BODY_BYTES', 256 * 1024)
const MAX_INFLIGHT = envNumber('PROXY_MAX_INFLIGHT', 200)
const RATE_BURST = envNumber('PROXY_RATE_BURST', 120)
const RATE_PER_SEC = envNumber('PROXY_RATE_PER_MIN', 240) / 60
// Header the platform's edge sets to the real client address (Railway: X-Real-IP;
// behind an AWS load balancer: X-Forwarded-For, whose last entry is used).
// Set to an empty string when nothing trusted sits in front of this server, so
// clients cannot pick their own rate-limit bucket.
const CLIENT_IP_HEADER = (process.env.CLIENT_IP_HEADER ?? 'x-real-ip').trim().toLowerCase()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

// ── Security headers ───────────────────────────────────────────────────────

/**
 * The page only ever talks to this server, the Ethereum RPC, and (when
 * enabled) WalletConnect. The build writes the exact origins it was configured
 * with to dist/csp.json; CSP_CONNECT_SRC adds more at runtime.
 */
async function buildCsp() {
  let manifest = null
  try {
    manifest = JSON.parse(await fs.readFile(path.join(DIST, 'csp.json'), 'utf8'))
  } catch {
    console.warn('dist/csp.json missing or unreadable: connect-src falls back to any https/wss origin')
  }
  const list = (key) => (Array.isArray(manifest?.[key]) ? manifest[key].filter((v) => typeof v === 'string') : [])
  const extraConnect = (process.env.CSP_CONNECT_SRC ?? '').split(/\s+/).filter(Boolean)
  const connect = manifest ? [...list('connectSrc'), ...extraConnect] : ['https:', 'wss:', ...extraConnect]
  const frames = list('frameSrc')
  const directives = {
    'default-src': ["'self'"],
    // 'wasm-unsafe-eval' lets the Go signer compile; nothing else may be evaluated or inlined.
    'script-src': ["'self'", "'wasm-unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...list('imgSrc')],
    'font-src': ["'self'", 'data:', ...list('fontSrc')],
    'connect-src': ["'self'", ...connect],
    'frame-src': frames.length ? frames : ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`)
    .join('; ')
}

const SECURITY_HEADERS = {
  'content-security-policy': await buildCsp(),
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // Ignored by browsers over plain http, so harmless in local runs.
  'strict-transport-security': 'max-age=31536000',
}

// ── Static files ───────────────────────────────────────────────────────────

async function stat(file) {
  try {
    return await fs.stat(file)
  } catch {
    return null
  }
}

function pickEncoding(req) {
  const accept = req.headers['accept-encoding'] ?? ''
  if (/\bbr\b/.test(accept)) return { ext: '.br', name: 'br' }
  if (/\bgzip\b/.test(accept)) return { ext: '.gz', name: 'gzip' }
  return null
}

async function serveStatic(req, res, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request')
    return
  }
  const safe = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  let file = path.join(DIST, safe)
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(403).end()
    return
  }
  let st = await stat(file)
  if (st?.isDirectory()) {
    file = path.join(file, 'index.html')
    st = await stat(file)
  }
  if (!st) {
    // SPA fallback: unknown paths render the app (it has a single route anyway).
    file = path.join(DIST, 'index.html')
    st = await stat(file)
    if (!st) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('dist/ not built')
      return
    }
  }
  const ext = path.extname(file)
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
  }
  // Hashed Vite assets are immutable; everything else revalidates.
  headers['cache-control'] = safe.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : ext === '.html'
      ? 'no-cache'
      : 'public, max-age=3600'

  let toSend = file
  let size = st.size
  const enc = pickEncoding(req)
  if (enc && ext !== '.woff2') {
    const pre = await stat(`${file}${enc.ext}`)
    if (pre) {
      toSend = `${file}${enc.ext}`
      size = pre.size
      headers['content-encoding'] = enc.name
      headers.vary = 'accept-encoding'
    }
  }
  headers['content-length'] = String(size)
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(toSend).pipe(res)
}

// ── Proxy ──────────────────────────────────────────────────────────────────

function sendJson(res, status, message, extraHeaders = {}) {
  res
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders })
    .end(JSON.stringify({ code: status, message }))
}

function clientKey(req) {
  return clientAddress(CLIENT_IP_HEADER ? req.headers[CLIENT_IP_HEADER] : undefined, req.socket.remoteAddress)
}

// Token bucket per client address: RATE_BURST requests at once, refilled at RATE_PER_SEC.
const buckets = new Map()
const MAX_BUCKETS = 100_000

/** Returns 0 when the request may go ahead, otherwise the seconds to wait. */
function rateLimit(key) {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear()
    bucket = { tokens: RATE_BURST, at: now }
    buckets.set(key, bucket)
  }
  bucket.tokens = Math.min(RATE_BURST, bucket.tokens + ((now - bucket.at) / 1000) * RATE_PER_SEC)
  bucket.at = now
  if (bucket.tokens < 1) return Math.max(1, Math.ceil((1 - bucket.tokens) / RATE_PER_SEC))
  bucket.tokens -= 1
  return 0
}

// Forget clients whose bucket has refilled.
setInterval(() => {
  const idleMs = (RATE_BURST / RATE_PER_SEC) * 1000
  const now = Date.now()
  for (const [key, bucket] of buckets) if (now - bucket.at > idleMs) buckets.delete(key)
}, 60_000).unref()

/** Reads the request body up to `limit` bytes. */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      req.off('data', onData)
      resolve(result)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > limit) done({ tooLarge: true })
      else chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => done({ body: Buffer.concat(chunks) }))
    req.on('error', () => done({ aborted: true }))
    req.on('close', () => done({ aborted: true }))
  })
}

let inflight = 0

async function proxy(req, res, url, prefix) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  const upstreamPath = url.pathname.slice(prefix.length)
  // Refuse anything off the allowlist before spending rate-limit budget or reading a body.
  if (req.method === 'GET' ? !ALLOWED_READS.has(upstreamPath) : upstreamPath !== SEND_TX_PATH) {
    sendJson(res, 404, 'This server does not relay that endpoint.')
    return
  }

  const wait = rateLimit(clientKey(req))
  if (wait > 0) {
    sendJson(res, 429, 'Too many requests, slow down.', { 'retry-after': String(wait) })
    return
  }
  if (inflight >= MAX_INFLIGHT) {
    sendJson(res, 503, 'Server busy, try again shortly.', { 'retry-after': '2' })
    return
  }

  let body
  if (req.method === 'POST') {
    const tooLarge = () => sendJson(res, 413, 'Request body too large.', { connection: 'close' })
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      tooLarge()
      return
    }
    const read = await readBody(req, MAX_BODY_BYTES)
    if (read.aborted) return
    if (read.tooLarge) {
      tooLarge()
      return
    }
    body = read.body.toString('utf8')
  }

  const decision = checkProxyRequest(
    { method: req.method, path: upstreamPath, search: url.search, contentType: req.headers['content-type'], body },
    ALLOWED_TX_TYPES,
  )
  if (!decision.ok) {
    sendJson(res, decision.status, decision.message)
    return
  }
  const target = `${PROXIES[prefix]}${upstreamPath}${decision.search}`
  const headers = { accept: 'application/json' }
  if (decision.contentType) headers['content-type'] = decision.contentType
  if (decision.forwardAuth && req.headers.authorization) headers.authorization = req.headers.authorization

  const controller = new AbortController()
  // Covers the whole exchange, body included.
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
  const onClose = () => controller.abort()
  res.on('close', onClose)
  inflight++
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: decision.body,
      signal: controller.signal,
      redirect: 'manual',
    })
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    })
    // Streamed rather than buffered, so a large upstream answer never sits in memory.
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res)
    else res.end()
  } catch (err) {
    if (res.headersSent) {
      // Failed mid-stream (timeout, upstream reset, client gone): nothing sane left to send.
      res.destroy()
    } else {
      const aborted = err?.name === 'AbortError'
      sendJson(res, aborted ? 504 : 502, 'upstream unavailable')
    }
  } finally {
    inflight--
    clearTimeout(timer)
    res.off('close', onClose)
  }
}

// ── Server ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      return
    }
    const prefix = Object.keys(PROXIES).find((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))
    if (prefix) {
      await proxy(req, res, url, prefix)
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    await serveStatic(req, res, url.pathname)
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('internal error')
  }
})

// A whole request (headers and body) must arrive within this window.
server.requestTimeout = 30_000
server.headersTimeout = 15_000

server.listen(PORT, () => {
  const routes = Object.entries(PROXIES).map(([prefix, host]) => `${prefix} → ${host}`).join(', ')
  console.log(`lighter-exit listening on :${PORT} (${routes}); relays transaction types ${[...ALLOWED_TX_TYPES].sort((a, b) => a - b).join(', ')}`)
})
