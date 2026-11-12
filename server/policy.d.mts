export const DEFAULT_UPSTREAMS: { '/lighter-api': string; '/lighter-api-rh': string }
export const ALLOWED_READS: Map<string, { auth: boolean }>
export const SEND_TX_PATH: string
export const DEFAULT_ALLOWED_TX_TYPES: number[]
export function parseAllowedTxTypes(value: string | undefined): Set<number>
export function clientAddress(headerValue: string | string[] | undefined, remoteAddress: string | undefined): string
export const FIREWALL_COOLDOWN_MS: number
export const API_LIMIT_COOLDOWN_MS: number
export const ROUTE_LIMIT_HEADER: string
export const UPSTREAM_RATE_LIMIT_MESSAGE: string
export function upstreamLimit(
  status: number,
  path: string,
  retryAfter: string | null | undefined,
): { scope: 'server'; ms: number } | { scope: 'address' } | null
export type ProxyDecision =
  | { ok: true; search: string; forwardAuth: boolean; body?: string; contentType?: string }
  | { ok: false; status: number; message: string }
export function checkProxyRequest(
  req: { method: string; path: string; search: string; contentType?: string; body?: string },
  allowedTxTypes: Set<number>,
): ProxyDecision
