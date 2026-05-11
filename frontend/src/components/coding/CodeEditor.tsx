import { lazy, Suspense } from 'react'

// Lazy-load @monaco-editor/react so its ~3MB chunk doesn't ship to surfaces
// that never open a coding problem. Vite will code-split this automatically.
const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.default })),
)

export interface CodeEditorProps {
  value: string
  onChange: (next: string) => void
  /** Monaco language id. Default 'python'. */
  language?: string
  /** Theme — we follow the page's data-theme/document.documentElement.class. */
  readOnly?: boolean
  height?: string
}

/**
 * Thin lazy-loaded wrapper around Monaco. Theme is auto-picked by the host
 * page; if the CampusIQ dark/nebula CSS class is set on <html>, we use
 * vs-dark; otherwise vs (light). This is a one-shot check on mount — switching
 * the page theme without remounting won't repaint, which is acceptable for V1.
 */
export default function CodeEditor({
  value,
  onChange,
  language = 'python',
  readOnly = false,
  height = '100%',
}: CodeEditorProps) {
  const isDark =
    typeof document !== 'undefined' &&
    (document.documentElement.classList.contains('dark') ||
      document.documentElement.classList.contains('nebula'))
  const theme = isDark ? 'vs-dark' : 'vs'

  return (
    <Suspense fallback={<EditorFallback />}>
      <MonacoEditor
        value={value}
        onChange={(next) => onChange(next ?? '')}
        language={language}
        theme={theme}
        height={height}
        options={{
          readOnly,
          fontSize: 13,
          fontFamily:
            'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 4,
          insertSpaces: true,
          renderLineHighlight: 'all',
          padding: { top: 12, bottom: 12 },
          automaticLayout: true,
          wordWrap: 'on',
        }}
      />
    </Suspense>
  )
}

function EditorFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-tertiary)] text-sm">
      Loading editor…
    </div>
  )
}
