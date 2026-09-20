import { motion, useReducedMotion } from 'framer-motion'
import { type ReactNode } from 'react'

// `d` is the stagger index (×0.06s). Copied from perps-fe page-kit/Section.tsx.
export function Section({
  d = 0,
  children,
  className,
}: {
  d?: number
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.section
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: d * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  )
}
