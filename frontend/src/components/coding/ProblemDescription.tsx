import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Lightbulb } from 'lucide-react'
import { baseMarkdownComponents } from '../chat/markdownComponents'
import Disclosure from '../ui/Disclosure'
import DifficultyBadge from './DifficultyBadge'
import type { CodingDifficulty, ProblemExample } from '../../types'

export interface ProblemDescriptionProps {
  title: string
  difficulty: CodingDifficulty
  topicTags: string[]
  description: string
  examples: ProblemExample[]
  hints: string[]
  /** Reference solution shown after AC. */
  referenceSolution?: Record<string, string> | null
  /** Whether the user has solved this problem. */
  solved: boolean
}

/**
 * Left pane of the problem-detail page. Pure markdown + examples + a stack of
 * progressively-revealable hints + an optional reference solution disclosure
 * once the user has AC'd.
 */
export default function ProblemDescription({
  title,
  difficulty,
  topicTags,
  description,
  examples,
  hints,
  referenceSolution,
  solved,
}: ProblemDescriptionProps) {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <DifficultyBadge difficulty={difficulty} />
          {solved && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider bg-success/15 text-success border border-success/30">
              Solved
            </span>
          )}
          {topicTags.map((t) => (
            <span
              key={t}
              className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]"
            >
              {t}
            </span>
          ))}
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] m-0 leading-tight">
          {title}
        </h1>
      </header>

      <section className="prose-fix">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={baseMarkdownComponents}>
          {description}
        </ReactMarkdown>
      </section>

      {examples.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
            Examples
          </h2>
          <div className="space-y-3">
            {examples.map((ex, i) => (
              <div
                key={i}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-sm space-y-1.5"
              >
                <div className="font-mono text-[12.5px]">
                  <span className="text-[var(--text-tertiary)]">Input: </span>
                  <span className="text-[var(--text-primary)]">{ex.input}</span>
                </div>
                <div className="font-mono text-[12.5px]">
                  <span className="text-[var(--text-tertiary)]">Output: </span>
                  <span className="text-[var(--text-primary)]">{ex.output}</span>
                </div>
                {ex.explanation && (
                  <div className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed">
                    {ex.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {hints.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
            Hints
          </h2>
          <div className="flex flex-wrap gap-2">
            {hints.map((hint, i) => (
              <HintItem key={i} index={i + 1} hint={hint} />
            ))}
          </div>
        </section>
      )}

      {solved && referenceSolution && (
        <ReferenceSolution sourceMap={referenceSolution} />
      )}
    </div>
  )
}

function HintItem({ index, hint }: { index: number; hint: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Disclosure
      open={open}
      onToggle={() => setOpen((o) => !o)}
      buttonLabel={
        <span className="inline-flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5" />
          {open ? `Hide hint ${index}` : `Show hint ${index}`}
        </span>
      }
    >
      <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--text-secondary)] leading-relaxed max-w-md">
        {hint}
      </div>
    </Disclosure>
  )
}

function ReferenceSolution({ sourceMap }: { sourceMap: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const source = sourceMap.python ?? Object.values(sourceMap)[0] ?? ''
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
        Reference solution
      </h2>
      <Disclosure
        open={open}
        onToggle={() => setOpen((o) => !o)}
        buttonLabel={open ? 'Hide solution' : 'Show solution'}
      >
        <pre className="rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-3 my-2 text-[12.5px] font-mono text-[var(--text-primary)] overflow-x-auto whitespace-pre-wrap break-words max-w-full">
          {source}
        </pre>
      </Disclosure>
    </section>
  )
}
