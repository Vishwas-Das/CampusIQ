import { clsx } from 'clsx'
import type { CodingDifficulty } from '../../types'

export interface DifficultyBadgeProps {
  difficulty: CodingDifficulty
  size?: 'sm' | 'md'
  className?: string
}

const COLORS: Record<CodingDifficulty, string> = {
  easy: 'bg-success/15 text-success border-success/30',
  medium: 'bg-warning/15 text-warning border-warning/30',
  hard: 'bg-danger/15 text-danger border-danger/30',
}

const LABELS: Record<CodingDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

/**
 * A tiny pill that colour-codes a problem's difficulty. Reused on both the
 * list row and the detail header.
 */
export default function DifficultyBadge({
  difficulty,
  size = 'md',
  className,
}: DifficultyBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-semibold uppercase tracking-wider rounded border',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
        COLORS[difficulty],
        className,
      )}
    >
      {LABELS[difficulty]}
    </span>
  )
}
