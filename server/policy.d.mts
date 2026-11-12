export const ALLOWED_READS: Map<string, { auth: boolean }>
export const SEND_TX_PATH: string
export const DEFAULT_ALLOWED_TX_TYPES: number[]
export function parseAllowedTxTypes(value: string | undefined): Set<number>
export type ProxyDecision =
  | { ok: true; search: string; forwardAuth: boolean; body?: string; contentType?: string }
  | { ok: false; status: number; message: string }
export function checkProxyRequest(
  req: { method: string; path: string; search: string; contentType?: string; body?: string },
  allowedTxTypes: Set<number>,
): ProxyDecision
