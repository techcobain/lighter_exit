import { useEffect, useId, useRef, type ReactNode } from 'react'

import cn from '../lib/cn'
import { BTN_DANGER_CLASSNAME, BTN_SECONDARY_CLASSNAME } from '../lib/recipes'

/**
 * Modal confirmation for an action the user should stop and read about first.
 * Built on the native <dialog>, which traps focus, dims the page and closes on
 * Escape. Focus starts on Cancel, so Enter alone never confirms.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClick={(e) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (e.target === e.currentTarget) onCancel()
      }}
      className={cn(
        'm-auto w-[min(92vw,32rem)] rounded-panel border-[0.5px] border-line bg-surface p-0 text-ink',
        'shadow-[0_24px_64px_rgba(0,0,0,0.5)] backdrop:bg-black/60',
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h3 id={titleId} className="text-xl font-medium tracking-heading text-ink">
            {title}
          </h3>
          <div className="flex flex-col gap-3 text-sm leading-md text-dim">{children}</div>
          <div className="flex flex-wrap justify-end gap-3 pt-1">
            <button type="button" onClick={onCancel} className={BTN_SECONDARY_CLASSNAME}>
              {cancelLabel}
            </button>
            <button type="button" onClick={onConfirm} className={BTN_DANGER_CLASSNAME}>
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
