// Pre-compress the large static assets in dist/ (the Go wasm signer above all)
// so the production server can serve .br / .gz variants without compressing
// on every request.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const DIST = path.resolve(process.cwd(), 'dist')
const EXTENSIONS = new Set(['.wasm', '.js', '.css', '.svg', '.html'])
const MIN_SIZE = 8 * 1024

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`

const files = (await walk(DIST)).filter((f) => EXTENSIONS.has(path.extname(f)))
for (const file of files) {
  const buf = await fs.readFile(file)
  if (buf.length < MIN_SIZE) continue
  const br = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  })
  const gz = zlib.gzipSync(buf, { level: 9 })
  await fs.writeFile(`${file}.br`, br)
  await fs.writeFile(`${file}.gz`, gz)
  console.log(`${path.relative(DIST, file)}: ${kb(buf.length)} → br ${kb(br.length)}, gz ${kb(gz.length)}`)
}
