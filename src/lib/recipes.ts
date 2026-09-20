// Class-string recipes copied from perps-fe's page-kit (via the prover-claim
// page) so this page renders with the same chrome. Keep in sync by re-copying.

export const CRISP_LIGHT_CLASSNAME =
  'light:bg-surface light:shadow-[inset_0_0_0_0.5px_var(--ring-crisp)]'

export const FOCUS_RING_CLASSNAME =
  'focus-visible:[outline:2px_solid_var(--color-ink)] focus-visible:outline-offset-2'

export const BTN_BASE_CLASSNAME = `inline-flex h-10 items-center justify-center gap-1.5 rounded-modal px-(--page-btn-px) text-md/4 font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color,filter,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] [text-box-edge:cap_alphabetic] [text-box-trim:trim-both] active:scale-[0.97] disabled:cursor-default disabled:opacity-50 disabled:active:scale-100 has-[>:is(svg,[data-icon]):first-child:not(:last-child)]:pl-(--page-btn-px-icon) has-[>:is(svg,[data-icon]):last-child:not(:first-child)]:pr-(--page-btn-px-icon) motion-reduce:transition-none max-mobile:h-(--control-h-md) max-mobile:min-w-(--control-h-md) max-mobile:text-sm/4 ${FOCUS_RING_CLASSNAME}`

export const BTN_PRIMARY_CLASSNAME = `${BTN_BASE_CLASSNAME} bg-ink text-bg shadow-[inset_0_0_0_0.5px_rgba(6,6,6,0.1),0_0_0_0.5px_var(--ring-crisp)] hover:bg-ink/90 active:bg-ink/80 light:shadow-[inset_0_0.4px_0_0_rgba(255,255,255,0.16),inset_0_0_0_0.5px_rgba(6,6,6,0.1),0_0_0_0.5px_var(--ring-crisp)]`

export const BTN_SECONDARY_CLASSNAME = `${BTN_BASE_CLASSNAME} border-[0.5px] border-line bg-fill shadow-[0px_0px_0px_0.5px_var(--ring-crisp),0px_1px_0px_0px_var(--edge-under)] ${CRISP_LIGHT_CLASSNAME} text-ink hover:bg-ink/6 light:hover:bg-surface`

export const BTN_DANGER_CLASSNAME = `${BTN_BASE_CLASSNAME} border-[0.5px] border-down/30 bg-down/10 text-down hover:bg-down/15`

/** Compact variant for table rows. */
export const BTN_ROW_CLASSNAME = 'h-8 px-3 text-sm/4 max-mobile:h-8'

export const CARD_CLASSNAME =
  'overflow-hidden rounded-panel border-[0.5px] border-line bg-fill'

export const PAGE_CRISP_SURFACE_CLASSNAME = `border-[0.5px] border-line bg-fill shadow-[inset_0_var(--hl-y)_0_0_var(--hl-top),0px_0px_0px_0.5px_var(--ring-crisp),0px_1px_0px_0px_var(--edge-under)] ${CRISP_LIGHT_CLASSNAME}`

export const PAGE_TITLE_CLASSNAME =
  'm-0 text-hero leading-[1.02] font-medium tracking-display [text-box-edge:cap_alphabetic] [text-box-trim:trim-start]'

export const INPUT_CLASSNAME = `h-10 w-full rounded-modal border-[0.5px] border-line bg-surface px-3 text-md text-ink transition-[border-color,box-shadow] outline-none placeholder:text-faint focus:border-ink/25 aria-invalid:border-danger/60 ${FOCUS_RING_CLASSNAME}`

export const LABEL_CLASSNAME =
  'text-2xs font-medium tracking-caps text-meta uppercase'

export const LINK_CLASSNAME = 'text-link underline-offset-2 hover:underline'
