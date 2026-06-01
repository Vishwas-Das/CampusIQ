import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import type { Variants } from 'framer-motion'

// Important: do NOT start at opacity 0. If framer-motion's rAF loop is throttled
// (e.g. tab backgrounded, low-power mode, or a renderer that pauses rAF for
// hidden tabs) the page would stay invisible forever. Start visible and just
// animate the y/blur — content is always rendered.
const pageVariants: Variants = {
  initial: {},
  animate: {},
  exit: {},
}

export const itemVariants: Variants = {
  initial: {},
  animate: {},
}

export interface PageTransitionProps {
  children: ReactNode
  className?: string
}

export default function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: PageTransitionProps) {
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  )
}
