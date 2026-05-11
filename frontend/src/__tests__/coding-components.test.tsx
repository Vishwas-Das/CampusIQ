import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DifficultyBadge from '../components/coding/DifficultyBadge'
import TestResultPanel from '../components/coding/TestResultPanel'
import type { TestResult } from '../components/coding/pyodideRunner'

// ────────────────────────────────────────────────────────────────
// Pyodide is dynamically imported by pyodideRunner.ts — mock it once
// here so jsdom never tries to fetch the 10MB WASM bundle.
// ────────────────────────────────────────────────────────────────
const mockRunPythonAsync = vi.fn(async () => undefined)
const mockSetStdout = vi.fn()
const mockSetStderr = vi.fn()
const mockGlobalsSet = vi.fn()
let stdoutBatched: ((s: string) => void) | null = null

vi.mock('pyodide', () => ({
  loadPyodide: async () => ({
    runPythonAsync: mockRunPythonAsync,
    setStdout: (opts: { batched: (s: string) => void }) => {
      mockSetStdout(opts)
      stdoutBatched = opts.batched
    },
    setStderr: (opts: { batched: (s: string) => void }) => {
      mockSetStderr(opts)
    },
    globals: { set: mockGlobalsSet },
  }),
}))


describe('DifficultyBadge', () => {
  it('renders the difficulty label', () => {
    render(<DifficultyBadge difficulty="easy" />)
    expect(screen.getByText('Easy')).toBeInTheDocument()
  })

  it('applies the difficulty colour class', () => {
    const { rerender } = render(<DifficultyBadge difficulty="medium" />)
    expect(screen.getByText('Medium').className).toMatch(/warning/)

    rerender(<DifficultyBadge difficulty="hard" />)
    expect(screen.getByText('Hard').className).toMatch(/danger/)
  })
})


describe('TestResultPanel', () => {
  it('shows the empty-state prompt before first run', () => {
    render(<TestResultPanel results={null} />)
    expect(screen.getByText(/hit/i)).toBeInTheDocument()
    expect(screen.getByText('Run')).toBeInTheDocument()
  })

  it('renders an Accepted banner when all tests pass', () => {
    const results: TestResult[] = [
      { index: 0, passed: true, got: [0, 1], expected: [0, 1], error: null },
      { index: 1, passed: true, got: [1, 2], expected: [1, 2], error: null },
    ]
    render(
      <TestResultPanel
        results={results}
        status="passed"
        passedCount={2}
        totalCount={2}
        runtimeMs={123}
      />,
    )
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.getByText('123 ms')).toBeInTheDocument()
  })

  it('shows Expected/Got for failed cases', () => {
    const results: TestResult[] = [
      { index: 0, passed: true, got: [0, 1], expected: [0, 1], error: null },
      { index: 1, passed: false, got: [], expected: [1, 2], error: null },
    ]
    render(
      <TestResultPanel
        results={results}
        status="failed"
        passedCount={1}
        totalCount={2}
      />,
    )
    expect(screen.getByText('1 / 2 tests passed')).toBeInTheDocument()
    expect(screen.getByText(/expected/i)).toBeInTheDocument()
    expect(screen.getByText(/got/i)).toBeInTheDocument()
  })

  it('renders the error message for a runtime error', () => {
    const results: TestResult[] = [
      {
        index: 0,
        passed: false,
        got: null,
        expected: 5,
        error: 'NameError: name `foo` is not defined',
      },
    ]
    render(
      <TestResultPanel
        results={results}
        status="error"
        errorMessage="NameError: name `foo` is not defined"
        passedCount={0}
        totalCount={1}
      />,
    )
    expect(screen.getByText('Runtime error')).toBeInTheDocument()
    expect(
      screen.getAllByText(/NameError/).length,
    ).toBeGreaterThan(0)
  })
})


describe('pyodideRunner.runUserCode', () => {
  it('builds the harness and parses results from stdout', async () => {
    const { runUserCode } = await import('../components/coding/pyodideRunner')

    // Configure the mock so the python execution "prints" a results JSON.
    mockRunPythonAsync.mockImplementation(async () => {
      if (stdoutBatched) {
        stdoutBatched(
          JSON.stringify([
            { index: 0, passed: true, got: [0, 1], expected: [0, 1], error: null },
            { index: 1, passed: false, got: [], expected: [1, 2], error: null },
          ]),
        )
      }
    })

    const outcome = await runUserCode({
      userCode: 'def two_sum(nums, target):\n    return [0, 1]\n',
      functionName: 'two_sum',
      testCases: [
        { input: [[2, 7, 11, 15], 9], expected: [0, 1] },
        { input: [[3, 2, 4], 6], expected: [1, 2] },
      ],
      comparator: 'sorted',
    })

    expect(outcome.status).toBe('failed')
    expect(outcome.passedCount).toBe(1)
    expect(outcome.totalCount).toBe(2)
    expect(outcome.results).toHaveLength(2)
    expect(mockGlobalsSet).toHaveBeenCalledWith('__function_name', 'two_sum')
    expect(mockGlobalsSet).toHaveBeenCalledWith('__comparator', 'sorted')
  })
})
