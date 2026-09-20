// Lighter mixes units across endpoints: pending_unlocks.unlock_timestamp and
// tx queued_at/executed_at are milliseconds, api key transaction_time is
// microseconds, pool metadata created_at is seconds. Rather than remember
// which is which, normalise by magnitude: anything that would be a date
// before 1973 as milliseconds is treated as seconds, anything after 5138 as
// milliseconds is treated as microseconds.

const SECONDS_MAX = 1e11 // 1e11 s ≈ year 5138; 1e11 ms ≈ 1973
const MILLIS_MAX = 1e14 // 1e14 ms ≈ year 5138; 1e14 µs ≈ 1973

export function toMillis(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0
  if (ts < SECONDS_MAX) return ts * 1000
  if (ts < MILLIS_MAX) return ts
  return Math.floor(ts / 1000)
}

export function toSeconds(ts: number): number {
  return Math.floor(toMillis(ts) / 1000)
}
