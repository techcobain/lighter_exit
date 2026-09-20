// Decimal-string arithmetic. Lighter reports every balance and size as a
// decimal string; the L1 contract wants integers in each market's / asset's
// base units. Nothing here goes through floating point except the worst-price
// bound, which is a tolerance rather than an exact amount.

const DECIMAL_RE = /^-?\d*(\.\d*)?$/

export function isDecimalString(s: string): boolean {
  return DECIMAL_RE.test(s.trim()) && /\d/.test(s)
}

/** "12.3456" with 4 decimals → 123456n. Extra fractional digits are truncated. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const s = amount.trim()
  if (!isDecimalString(s)) throw new Error(`not a decimal string: ${amount}`)
  const negative = s.startsWith('-')
  const [intPartRaw = '', fracRaw = ''] = (negative ? s.slice(1) : s).split('.')
  const intPart = intPartRaw === '' ? '0' : intPartRaw
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals)
  const units = BigInt(intPart + frac)
  return negative ? -units : units
}

/** 123456n with 4 decimals → "12.3456" (trailing zeros trimmed). */
export function fromBaseUnits(units: bigint, decimals: number): string {
  const negative = units < 0n
  const abs = (negative ? -units : units).toString().padStart(decimals + 1, '0')
  const intPart = abs.slice(0, abs.length - decimals)
  const frac = decimals === 0 ? '' : abs.slice(abs.length - decimals)
  const out = trimZeros(frac ? `${intPart}.${frac}` : intPart)
  return negative && out !== '0' ? `-${out}` : out
}

/** Strip trailing fractional zeros: "1.2300" → "1.23", "4.000" → "4". */
export function trimZeros(s: string): string {
  if (!s.includes('.')) return s
  return s.replace(/\.?0+$/, '')
}

export function isPositiveDecimal(s: string | undefined | null): boolean {
  if (!s || !isDecimalString(s)) return false
  return toBaseUnits(s, 18) > 0n
}

/** Compare two decimal strings: -1, 0 or 1. */
export function compareDecimal(a: string, b: string): number {
  const x = toBaseUnits(a, 18)
  const y = toBaseUnits(b, 18)
  return x < y ? -1 : x > y ? 1 : 0
}

export function absDecimal(s: string): string {
  return s.trim().startsWith('-') ? s.trim().slice(1) : s.trim()
}

/**
 * Price bound for a reduce-only market order, in price base units.
 * Closing a long sells, so the bound sits below mark; closing a short buys, so
 * it sits above. Always returns at least 1 tick.
 */
export function worstPriceUnits(
  markPrice: number,
  priceDecimals: number,
  side: 'long' | 'short',
  slippagePct: number,
): bigint {
  if (!Number.isFinite(markPrice) || markPrice <= 0) throw new Error('mark price unavailable')
  const factor = side === 'long' ? 1 - slippagePct / 100 : 1 + slippagePct / 100
  const bounded = Math.max(markPrice * factor, 0)
  const units = toBaseUnits(bounded.toFixed(priceDecimals), priceDecimals)
  return units > 0n ? units : 1n
}

export const UINT32_MAX = 4294967295n
export const UINT48_MAX = 281474976710655n
export const UINT64_MAX = 18446744073709551615n

export function assertFits(value: bigint, max: bigint, what: string): void {
  if (value < 0n || value > max) throw new Error(`${what} does not fit the contract's integer width`)
}
