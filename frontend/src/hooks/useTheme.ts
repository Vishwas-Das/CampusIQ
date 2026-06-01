import { create } from 'zustand'
import type { Theme } from '../types'

// Display + cycle order. `system` first so it's the safe default. `nebula`
// stays the signature theme but is opt-in.
const THEMES: Theme[] = ['system', 'nebula', 'light', 'dark']

// CSS class names actually applied to <html>. `system` resolves to one of
// these at runtime; it never lands on the element directly.
const APPLIABLE_CLASSES = ['nebula', 'light', 'dark'] as const

// Any leftover stored value from when premium / aurora / luxury existed gets
// silently swapped for the default on the next page load.
const LEGACY_THEMES = ['premium', 'aurora', 'luxury']

interface ThemeMeta {
  label: string
  icon: string
}

const THEME_META: Record<Theme, ThemeMeta> = {
  system: { label: 'System', icon: 'Monitor' },
  nebula: { label: 'Nebula', icon: 'Sparkles' },
  light: { label: 'Light', icon: 'Sun' },
  dark: { label: 'Dark', icon: 'Moon' },
}

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem('campusiq-theme') as Theme | null
  if (stored && THEMES.includes(stored)) return stored
  // No stored preference → follow OS so first-time visitors aren't surprised.
  return 'system'
}

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  // Clear current + legacy classes so a user upgrading from a stale localStorage
  // entry doesn't keep an .aurora / .luxury / etc. class hanging around.
  for (const t of [...APPLIABLE_CLASSES, ...LEGACY_THEMES]) root.classList.remove(t)
  const resolved = theme === 'system' ? resolveSystemTheme() : theme
  if (resolved !== 'light') root.classList.add(resolved)
}

interface ThemeStore {
  theme: Theme
  cycle: () => void
  setTheme: (theme: Theme) => void
}

const useThemeStore = create<ThemeStore>((set) => ({
  theme: getInitialTheme(),
  cycle: () =>
    set((state) => {
      const idx = THEMES.indexOf(state.theme)
      const next = THEMES[(idx + 1) % THEMES.length]!
      localStorage.setItem('campusiq-theme', next)
      applyTheme(next)
      return { theme: next }
    }),
  setTheme: (theme) => {
    localStorage.setItem('campusiq-theme', theme)
    applyTheme(theme)
    set({ theme })
  },
}))

if (typeof window !== 'undefined') {
  applyTheme(getInitialTheme())
  // When the OS toggles light/dark, re-apply if (and only if) the user is on `system`.
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', () => {
    if (useThemeStore.getState().theme === 'system') applyTheme('system')
  })
}

interface UseThemeReturn {
  theme: Theme
  cycle: () => void
  setTheme: (theme: Theme) => void
  themes: Theme[]
  meta: Record<Theme, ThemeMeta>
}

export const useTheme = (): UseThemeReturn => {
  const theme = useThemeStore((s) => s.theme)
  const cycle = useThemeStore((s) => s.cycle)
  const setTheme = useThemeStore((s) => s.setTheme)
  return { theme, cycle, setTheme, themes: THEMES, meta: THEME_META }
}
