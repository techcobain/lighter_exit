// Page-wide record of every action the user has started (one L1 transaction
// or one L2 API transaction each), so step cards can show status even after
// re-rendering and the account refetches can be keyed off it.

import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react'

export type ActionStatus =
  | 'idle'
  | 'preparing'
  | 'signing'
  | 'pending'
  | 'confirmed'
  | 'l2-waiting'
  | 'executed'
  | 'l2-failed'
  | 'error'

export interface ActionState {
  status: ActionStatus
  label: string
  /** Ethereum transaction hash, for L1 actions. */
  txHash?: string
  /** Lighter transaction hash, for L2 API actions. */
  l2Hash?: string
  /** Which route carried the action. */
  route?: 'api' | 'l1'
  message?: string
  updatedAt: number
}

type Action =
  | { type: 'set'; id: string; patch: Partial<ActionState> & { label?: string } }
  | { type: 'reset'; id: string }

type State = Record<string, ActionState>

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set': {
      const prev = state[action.id] ?? { status: 'idle', label: action.patch.label ?? '', updatedAt: 0 }
      return { ...state, [action.id]: { ...prev, ...action.patch, updatedAt: Date.now() } }
    }
    case 'reset': {
      const next = { ...state }
      delete next[action.id]
      return next
    }
  }
}

interface ActionsContextValue {
  actions: State
  update: (id: string, patch: Partial<ActionState>) => void
  reset: (id: string) => void
}

const ActionsContext = createContext<ActionsContextValue | null>(null)

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [actions, dispatch] = useReducer(reducer, {})
  const update = useCallback(
    (id: string, patch: Partial<ActionState>) => dispatch({ type: 'set', id, patch }),
    [],
  )
  const reset = useCallback((id: string) => dispatch({ type: 'reset', id }), [])
  const value = useMemo(() => ({ actions, update, reset }), [actions, update, reset])
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
}

export function useActions(): ActionsContextValue {
  const ctx = useContext(ActionsContext)
  if (!ctx) throw new Error('useActions must be used inside ActionsProvider')
  return ctx
}

export const IN_FLIGHT: ReadonlySet<ActionStatus> = new Set([
  'preparing',
  'signing',
  'pending',
  'confirmed',
  'l2-waiting',
])

export function isInFlight(state: ActionState | undefined): boolean {
  return !!state && IN_FLIGHT.has(state.status)
}

export function isSettled(state: ActionState | undefined): boolean {
  return state?.status === 'executed'
}
