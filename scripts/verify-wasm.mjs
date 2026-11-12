// Fails when the signer files differ from the hashes recorded in
// scripts/signer.sha256 (written by scripts/build-wasm.sh). Runs before every
// build, so a swapped or corrupted signer binary cannot be deployed unnoticed:
// changing it also means changing a one-line hash that shows up in review.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED = ['public/lighter-signer.wasm', 'public/wasm_exec.js']

const recorded = new Map()
for (const line of readFileSync(path.join(ROOT, 'scripts/signer.sha256'), 'utf8').split('\n')) {
  const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim())
  if (match) recorded.set(match[2], match[1])
}

let failed = false
for (const file of REQUIRED) {
  const expected = recorded.get(file)
  const actual = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex')
  if (!expected) {
    console.error(`${file}: no hash recorded in scripts/signer.sha256`)
    failed = true
  } else if (expected !== actual) {
    console.error(`${file}: hash mismatch\n  recorded ${expected}\n  actual   ${actual}`)
    failed = true
  } else {
    console.log(`${file}: ok (${actual.slice(0, 16)}…)`)
  }
}

if (failed) {
  console.error('Signer files do not match scripts/signer.sha256. Rebuild them with scripts/build-wasm.sh.')
  process.exit(1)
}
