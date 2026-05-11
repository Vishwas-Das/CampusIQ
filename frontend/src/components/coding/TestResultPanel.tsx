import { Check, X, AlertTriangle, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import type { TestResult } from './pyodideRunner'

export interface TestResultPanelProps {
  /** Whether the runner is still in-flight. */
  loading?: boolean
  /** Null before first run. */
  results: TestResult[] | null
  /** Top-level error (e.g. timeout, syntax error). Falls back to per-test errors. */
  errorMessage?: string | null
  /** "passed" | "failed" | "error". */
  status?: 'passed' | 'failed' | 'error' | null
  passedCount?: number
  totalCount?: number
  runtimeMs?: number
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'string') return JSON.stringify(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * Right-side panel under the editor showing per-test pass/fail. Mirrors the
 * Claude.ai answer-card aesthetic from the modes work: subtle bordered rows,
 * caps-tracked status labels, monospace for the value diffs.
 */
export default function TestResultPanel({
  loading,
  results,
  errorMessage,
  status,
  passedCount,
  totalCount,
  runtimeMs,
}: TestResultPanelProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-tertiary)] flex items-center gap-2">
        <Clock className="h-4 w-4 animate-pulse" />
        Running your code…
      </div>
    )
  }

  if (results === null) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-tertiary)]">
        Hit <span className="font-semibold text-[var(--text-secondary)]">Run</span> to check
        against visible tests, or <span className="font-semibold text-[var(--text-secondary)]">Submit</span> to
        check against the full set.
      </div>
    )
  }

  const headerStatusColour =
    status === 'passed'
      ? 'text-success border-success/30 bg-success/10'
      : status === 'failed'
        ? 'text-warning border-warning/30 bg-warning/10'
        : 'text-danger border-danger/30 bg-danger/10'

  const headerLabel =
    status === 'passed'
      ? 'Accepted'
      : status === 'failed'
        ? `${passedCount ?? 0} / ${totalCount ?? results.length} tests passed`
        : 'Runtime error'

  return (
    <div className="space-y-3">
      <div
        className={clsx(
          'rounded-lg border px-3 py-2 flex items-center justify-between',
          headerStatusColour,
        )}
      >
        <span className="text-[12px] font-semibold uppercase tracking-wider">
          {headerLabel}
        </span>
        {typeof runtimeMs === 'number' && (
          <span className="text-[11px] opacity-80">{runtimeMs.toFixed(0)} ms</span>
        )}
      </div>

      {errorMessage && status === 'error' && (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-[12px] font-mono whitespace-pre-wrap text-danger">
          {errorMessage}
        </div>
      )}

      <ol className="space-y-2">
        {results.map((r) => (
          <li
            key={r.index}
            className={clsx(
              'rounded-md border p-3 text-sm',
              r.passed
                ? 'border-success/25 bg-success/5'
                : 'border-[var(--border-default)] bg-[var(--bg-secondary)]',
            )}
          >
            <div className="flex items-center gap-2 mb-1.5">
              {r.passed ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : r.error ? (
                <AlertTriangle className="h-3.5 w-3.5 text-danger" />
              ) : (
                <X className="h-3.5 w-3.5 text-warning" />
              )}
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Case {r.index + 1}
              </span>
              <span
                className={clsx(
                  'text-[11px] font-semibold',
                  r.passed
                    ? 'text-success'
                    : r.error
                      ? 'text-danger'
                      : 'text-warning',
                )}
              >
                {r.passed ? 'Passed' : r.error ? 'Error' : 'Wrong answer'}
              </span>
            </div>
            {!r.passed && (
              <div className="space-y-0.5 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
                {r.error ? (
                  <div className="whitespace-pre-wrap text-danger">{r.error}</div>
                ) : (
                  <>
                    <div>
                      <span className="text-[var(--text-tertiary)]">Expected: </span>
                      <span className="text-[var(--text-primary)]">{formatValue(r.expected)}</span>
                    </div>
                    <div>
                      <span className="text-[var(--text-tertiary)]">Got:&nbsp;&nbsp;&nbsp;&nbsp; </span>
                      <span className="text-[var(--text-primary)]">{formatValue(r.got)}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
