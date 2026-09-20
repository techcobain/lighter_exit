// Production server: serves the built SPA from dist/ and proxies the Lighter
// REST API under /lighter-api so the browser never has to reach Lighter's
// domain directly (useful for users whose region is blocked from it).
//
// Zero dependencies on purpose — only Node 22 built-ins.
import http from 'node:http'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT ?? 8787)
const UPSTREAM = (process.env.LIGHTER_API_URL ?? 'https://mainnet.zklighter.elliot.ai').replace(
  /\/$/,
  '',
)
const PROXY_PREFIX = '/lighter-api'
const PROXY_TIMEOUT_MS = 30_000

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
  const safe = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  let file = path.join(DIST, safe)
  if (!file.startsWith(DIST)) {
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
    'x-content-type-options': 'nosniff',
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

async function proxy(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  const upstreamPath = url.pathname.slice(PROXY_PREFIX.length)
  if (!upstreamPath.startsWith('/api/v1/')) {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
    return
  }
  const target = `${UPSTREAM}${upstreamPath}${url.search}`
  const headers = { accept: 'application/json' }
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
  if (req.headers.authorization) headers.authorization = req.headers.authorization

  let body
  if (req.method === 'POST') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    body = Buffer.concat(chunks)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    })
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'content-length': String(buf.length),
      'cache-control': 'no-store',
    })
    res.end(buf)
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    res
      .writeHead(aborted ? 504 : 502, { 'content-type': 'application/json' })
      .end(JSON.stringify({ code: aborted ? 504 : 502, message: 'upstream unavailable' }))
  } finally {
    clearTimeout(timer)
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      return
    }
    if (url.pathname.startsWith(PROXY_PREFIX)) {
      await proxy(req, res, url)
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

server.listen(PORT, () => {
  console.log(`lighter-exit listening on :${PORT} (proxy → ${UPSTREAM})`)
})
