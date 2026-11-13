// Uploads dist-ipfs/ to Pinata as one folder and prints its CID (v1).
// Run with `npm run pin:ipfs` after `npm run build:ipfs`. Reads PINATA_JWT
// from the environment (.env, which is gitignored); the key needs the
// pinFileToIPFS permission (an admin key has it).

import { openAsBlob } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve('dist-ipfs')
const FOLDER = 'lighter-exit'
const jwt = process.env.PINATA_JWT?.trim()

if (!jwt) {
  console.error('PINATA_JWT is not set (put it in .env)')
  process.exit(1)
}

async function listFiles(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.name === '.DS_Store') continue
    if (entry.isDirectory()) out.push(...(await listFiles(full)))
    else if (entry.isFile()) out.push(full)
    else throw new Error(`not a regular file: ${full}`)
  }
  return out
}

let files
try {
  files = await listFiles(ROOT)
} catch {
  console.error('dist-ipfs/ not found: run npm run build:ipfs first')
  process.exit(1)
}
if (!files.some((f) => path.relative(ROOT, f) === 'index.html')) {
  console.error('dist-ipfs/index.html missing: run npm run build:ipfs first')
  process.exit(1)
}

const form = new FormData()
let bytes = 0
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const blob = await openAsBlob(file)
  bytes += blob.size
  // Every part shares the FOLDER prefix, so Pinata pins them as one directory.
  form.append('file', blob, `${FOLDER}/${rel}`)
}
form.append('pinataMetadata', JSON.stringify({ name: `${FOLDER}-${new Date().toISOString().slice(0, 19)}` }))
form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }))

console.log(`Uploading ${files.length} files (${(bytes / 1e6).toFixed(1)} MB)…`)
const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
  method: 'POST',
  headers: { authorization: `Bearer ${jwt}` },
  body: form,
})
const text = await res.text()
if (!res.ok) {
  console.error(`Pinata answered ${res.status}: ${text.slice(0, 500)}`)
  process.exit(1)
}
const { IpfsHash: cid, isDuplicate } = JSON.parse(text)
console.log(`${isDuplicate ? 'Already pinned' : 'Pinned'}: ${cid}`)
console.log(`ENS content hash: ipfs://${cid}`)
console.log(`Check it:         https://${cid}.ipfs.dweb.link/`)
