/**
 * Common shared types used across the app.
 */
import type { LucideIcon } from 'lucide-react'

export type { LucideIcon }

/** Theme variants. `system` follows OS preference (light/dark); `nebula` is
 *  the signature theme that mirrors the landing page (dark navy + violet/cyan
 *  accents); `light` and `dark` are the two classic options. */
export type Theme = 'system' | 'nebula' | 'light' | 'dark'

/** Generic API response wrapper for list endpoints */
export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

/** Utility: extract props from a JSX component type */
export type PropsOf<C> = C extends (props: infer P) => unknown ? P : never
