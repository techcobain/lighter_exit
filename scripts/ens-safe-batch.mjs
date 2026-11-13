// Builds a Safe Transaction Builder batch that points exit.lighter.eth at an
// IPFS copy of the site (see README, "Serving it at exit.lighter.eth").
//
//   node scripts/ens-safe-batch.mjs <cid> [out.json]
//
// lighter.eth is a wrapped name owned by a Safe, so the batch is run by that
// Safe: the first time it creates exit.lighter.eth (owned by the Safe, on the
// parent's resolver), then it sets the content hash to ipfs://<cid>. When the
// subname already exists only the content hash is set, so the same command
// works for every release. Before writing the file the whole batch is simulated
// on mainnet as the Safe (eth_simulateV1), and the record
// is read back; nothing is sent from here.

import fs from 'node:fs'

import { bytesToHex, createPublicClient, decodeFunctionResult, encodeFunctionData, getAddress, http, namehash, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'

const PARENT = 'lighter.eth'
const LABEL = 'exit'
const NAME = `${LABEL}.${PARENT}`
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
const NAME_WRAPPER = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401'
const RPC = process.env.ETH_RPC_URL || mainnet.rpcUrls.default.http[0]

const [cidArg, outArg] = process.argv.slice(2)
if (!cidArg) {
  console.error('usage: node scripts/ens-safe-batch.mjs <cid> [out.json]')
  process.exit(1)
}

// ── CID → ENS content hash (EIP-1577: 0xe301 + binary CIDv1) ────────────────

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base32Decode(s) {
  let bits = 0
  let value = 0
  const out = []
  for (const ch of s) {
    const i = BASE32.indexOf(ch)
    if (i < 0) throw new Error(`not base32: ${ch}`)
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

function base58Decode(s) {
  let n = 0n
  for (const ch of s) {
    const i = BASE58.indexOf(ch)
    if (i < 0) throw new Error(`not base58: ${ch}`)
    n = n * 58n + BigInt(i)
  }
  const out = []
  while (n > 0n) {
    out.unshift(Number(n & 0xffn))
    n >>= 8n
  }
  for (const ch of s) {
    if (ch !== '1') break
    out.unshift(0)
  }
  return Uint8Array.from(out)
}

/** Binary CIDv1 of a CID string: v1 base32 ("b…"), or v0 ("Qm…", turned into v1 dag-pb). */
function cidBytes(cid) {
  if (cid.startsWith('Qm') && cid.length === 46) {
    const multihash = base58Decode(cid)
    if (multihash[0] !== 0x12 || multihash[1] !== 0x20 || multihash.length !== 34) throw new Error('unexpected CIDv0 multihash')
    return Uint8Array.from([0x01, 0x70, ...multihash])
  }
  if (cid.startsWith('b')) {
    const bytes = base32Decode(cid.slice(1).toLowerCase())
    // CIDv1, dag-pb (a folder, as Pinata pins it) or raw, with a sha2-256 multihash: 36 bytes in all.
    if (bytes.length !== 36 || bytes[0] !== 0x01 || ![0x70, 0x55].includes(bytes[1]) || bytes[2] !== 0x12 || bytes[3] !== 0x20) {
      throw new Error(`not a CIDv1 this script knows (expected bafy… from npm run pin:ipfs): ${cid}`)
    }
    if (bytes[1] !== 0x70) console.warn('Warning: this CID is a single raw file, not a folder; the site needs the dist-ipfs folder CID.')
    return bytes
  }
  throw new Error('expected a CIDv1 in base32 (bafy…) or a CIDv0 (Qm…)')
}

const contenthash = bytesToHex(Uint8Array.from([0xe3, 0x01, ...cidBytes(cidArg.trim())]))

// ── Read the current state ──────────────────────────────────────────────────

const client = createPublicClient({ chain: mainnet, transport: http(RPC) })
const parentNode = namehash(PARENT)
const node = namehash(NAME)

const registryAbi = parseAbi(['function owner(bytes32) view returns (address)', 'function resolver(bytes32) view returns (address)'])
const wrapperAbi = parseAbi([
  'function getData(uint256) view returns (address owner, uint32 fuses, uint64 expiry)',
  'function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry) returns (bytes32)',
])
const resolverAbi = parseAbi([
  'function setContenthash(bytes32 node, bytes hash)',
  'function contenthash(bytes32 node) view returns (bytes)',
])

const [parentRegistryOwner, parentResolver] = await Promise.all([
  client.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [parentNode] }),
  client.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'resolver', args: [parentNode] }),
])
if (getAddress(parentRegistryOwner) !== getAddress(NAME_WRAPPER)) throw new Error(`${PARENT} is no longer wrapped; this script assumes it is`)
const [safe, parentFuses, parentExpiry] = await client.readContract({ address: NAME_WRAPPER, abi: wrapperAbi, functionName: 'getData', args: [BigInt(parentNode)] })

const subRegistryOwner = await client.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'owner', args: [node] })
const subExists = !/^0x0{40}$/i.test(subRegistryOwner)
let resolver = parentResolver
if (subExists) {
  resolver = await client.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: 'resolver', args: [node] })
  const [subOwner] = await client.readContract({ address: NAME_WRAPPER, abi: wrapperAbi, functionName: 'getData', args: [BigInt(node)] })
  if (getAddress(subRegistryOwner) !== getAddress(NAME_WRAPPER) || getAddress(subOwner) !== getAddress(safe)) {
    throw new Error(`${NAME} exists but is not a wrapped name owned by the Safe ${safe}; set its content hash by hand`)
  }
}

// ── The batch ───────────────────────────────────────────────────────────────

const txs = []
if (!subExists) {
  txs.push({
    to: NAME_WRAPPER,
    // Owned by the Safe, no fuses burned (the Safe can still change or remove it), expiry = the parent's.
    data: encodeFunctionData({ abi: wrapperAbi, functionName: 'setSubnodeRecord', args: [parentNode, LABEL, safe, resolver, 0n, 0, parentExpiry] }),
    description: `Create ${NAME}, owned by the Safe, resolver ${resolver}`,
  })
}
txs.push({
  to: resolver,
  data: encodeFunctionData({ abi: resolverAbi, functionName: 'setContenthash', args: [node, contenthash] }),
  description: `Set ${NAME} content hash to ipfs://${cidArg}`,
})

// Simulate: run the calls in order from the Safe's address (eth_simulateV1), then read the record back.
const readBack = { to: resolver, data: encodeFunctionData({ abi: resolverAbi, functionName: 'contenthash', args: [node] }) }
try {
  const { results } = await client.simulateCalls({ account: safe, calls: [...txs.map(({ to, data }) => ({ to, data })), readBack] })
  const failed = results.findIndex((r) => r.status !== 'success')
  if (failed >= 0) throw new Error(`call ${failed + 1} reverted`)
  const stored = decodeFunctionResult({ abi: resolverAbi, functionName: 'contenthash', data: results.at(-1).data })
  if (stored.toLowerCase() !== contenthash.toLowerCase()) throw new Error(`content hash reads back as ${stored}`)
} catch (err) {
  console.error(`Simulation failed: ${err.shortMessage ?? err.message}`)
  process.exit(1)
}

const out = outArg ?? `ens-${LABEL}-${cidArg.slice(0, 12)}.safe-batch.json`
const batch = {
  version: '1.0',
  chainId: '1',
  createdAt: Date.now(),
  meta: {
    name: `${NAME} → ipfs://${cidArg}`,
    description: txs.map((t) => t.description).join('; '),
    createdFromSafeAddress: safe,
  },
  transactions: txs.map((t) => ({ to: t.to, value: '0', data: t.data, contractMethod: null, contractInputsValues: null })),
}
fs.writeFileSync(out, `${JSON.stringify(batch, null, 2)}\n`)

console.log(`Safe:          ${safe} (${PARENT}, fuses ${parentFuses}, expires ${new Date(Number(parentExpiry) * 1000).toISOString().slice(0, 10)})`)
console.log(`Content hash:  ${contenthash}`)
for (const [i, t] of txs.entries()) console.log(`Tx ${i + 1}:          ${t.description}`)
console.log('Simulated as the Safe on mainnet: OK (content hash reads back as set)')
console.log(`Wrote ${out}. In app.safe.global open Apps → Transaction Builder, drop the file in, then create and sign the batch.`)
