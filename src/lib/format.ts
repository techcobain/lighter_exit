import { toMillis } from './time'
import { trimZeros } from './units'

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Decimal string → human number with thousands separators, at most `maxFrac` decimals. */
export function formatAmount(value: string | number, maxFrac = 6): string {
  const s = typeof value === 'number' ? String(value) : value.trim()
  if (!/^-?\d*(\.\d*)?$/.test(s) || !/\d/.test(s)) return s
  const negative = s.startsWith('-')
  const [intRaw = '0', frac = ''] = (negative ? s.slice(1) : s).split('.')
  const intPart = (intRaw === '' ? '0' : intRaw).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fracTrimmed = trimZeros(`0.${frac.slice(0, maxFrac)}`).slice(2)
  const out = fracTrimmed ? `${intPart}.${fracTrimmed}` : intPart
  return negative ? `-${out}` : out
}

export function formatUsd(value: string | number, maxFrac = 2): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs > 0 && abs < 0.01 ? 4 : maxFrac
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })
  return `${n < 0 ? '-' : ''}$${s}`
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Accepts seconds, milliseconds or microseconds; see time.ts. */
export function formatDateTime(ts: number): string {
  return new Date(toMillis(ts)).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function accountTypeLabel(type: number): string {
  switch (type) {
    case 0:
      return 'Main account'
    case 1:
      return 'Sub-account'
    case 2:
      return 'Public pool'
    case 3:
      return 'LLP'
    case 4:
      return 'Staking pool'
    default:
      return `Account type ${type}`
  }
}

export function describeError(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) {
    // viem wraps wallet rejections and revert reasons in long multi-line
    // messages; the first line is the useful part.
    const short = (err as { shortMessage?: string }).shortMessage
    return (short ?? err.message).split('\n')[0] ?? 'Unknown error'
  }
  return String(err)
}
