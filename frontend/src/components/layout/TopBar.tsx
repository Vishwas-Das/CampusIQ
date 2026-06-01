import { Bell, Search, Flame, Monitor, Sparkles, Sun, Moon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import type { Theme } from '../../types'

const themeIcons: Record<Theme, LucideIcon> = {
  system: Monitor,
  nebula: Sparkles,
  light: Sun,
  dark: Moon,
}

export interface TopBarProps {
  title: string
  score?: number
  streak?: number
  level?: number
}

export default function TopBar({ title, score, streak, level }: TopBarProps) {
  const { theme, cycle, meta } = useTheme()
  const ThemeIcon = themeIcons[theme]

  return (
    <header
      className="h-14 border-b border-[var(--border-default)] flex items-center justify-between px-6 shrink-0"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <h1 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h1>

      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <input type="text" placeholder="Search..." className="input-base pl-9 pr-3 py-1.5 text-sm w-48" />
        </div>

        {streak !== undefined && (
          <div className="flex items-center gap-1.5 text-sm">
            <Flame className={streak > 0 ? 'h-4 w-4 text-warning' : 'h-4 w-4 text-[var(--text-tertiary)]'} />
            <span className={streak > 0 ? 'font-medium text-warning' : 'text-[var(--text-tertiary)]'}>{streak}</span>
          </div>
        )}

        {level !== undefined && (
          <div className="flex items-center gap-1 text-sm">
            <span className="text-[var(--text-tertiary)]">Lv.</span>
            <span className="font-semibold text-[var(--text-primary)]">{level}</span>
          </div>
        )}

        {score !== undefined && (
          <div className="flex items-center justify-center h-8 w-8 rounded-full border-2 border-[var(--border-strong)]">
            <span className="text-xs font-bold text-[var(--text-primary)]">{score}</span>
          </div>
        )}

        <button
          onClick={cycle}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-all duration-200"
          title={`Theme: ${meta[theme].label}`}
        >
          <ThemeIcon className="h-4 w-4" />
          <span className="text-xs font-medium hidden lg:inline">{meta[theme].label}</span>
        </button>

        <button className="relative p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-danger rounded-full" />
        </button>
      </div>
    </header>
  )
}
