/**
 * Pyodide-based Python test runner for the V1 coding platform.
 *
 * Loads Pyodide lazily on first call (singleton-cached on the module so the
 * ~10MB WASM only downloads once per session). Builds a deterministic Python
 * test harness that wraps the user's code, executes each test case, and dumps
 * a JSON results array to stdout. The TS side captures stdout, parses the
 * JSON, and returns a structured outcome.
 *
 * The runner enforces a 5-second wall-clock timeout (`Promise.race`) — if a
 * user's code hangs (infinite loop, recursion blowup, etc.) the run resolves
 * with status='error'. We can't actually kill the Pyodide worker mid-run
 * cross-context, so the worst-case is a tab that needs reloading; acceptable
 * for V1.
 */

export interface RunnerTestCase {
  input: unknown[]
  expected: unknown
}

export interface TestResult {
  index: number
  passed: boolean
  got: unknown
  expected: unknown
  error: string | null
}

export interface RunOutcome {
  results: TestResult[]
  passedCount: number
  totalCount: number
  status: 'passed' | 'failed' | 'error'
  errorMessage: string | null
  runtimeMs: number
}

export interface RunOptions {
  userCode: string
  functionName: string
  testCases: RunnerTestCase[]
  comparator: string
  /** Hard cap. Default 5000ms. */
  timeoutMs?: number
}

// ────────────────────────────────────────────────────────────────
// Lazy-loaded singleton
// ────────────────────────────────────────────────────────────────

// Use `unknown` to avoid pulling in pyodide's types statically — the module is
// dynamically imported so its types aren't available until first use anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pyodide = any

let pyodidePromise: Promise<Pyodide> | null = null

export function loadPyodideSingleton(): Promise<Pyodide> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const mod = await import('pyodide')
      // pyodide's bundled WASM/.data files need to be loadable — we point at
      // the official CDN. Could be swapped for a self-hosted asset later.
      const pyo = await mod.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.4/full/',
      })
      return pyo
    })()
  }
  return pyodidePromise
}

// ────────────────────────────────────────────────────────────────
// Harness
// ────────────────────────────────────────────────────────────────

const HARNESS_TAIL = `
import json as __json

__test_cases = __json.loads(__test_cases_json)

def __compare(a, b, mode):
    if mode == "sorted":
        try: return sorted(a) == sorted(b)
        except Exception: return a == b
    if mode == "set":
        try: return set(a) == set(b)
        except Exception: return a == b
    return a == b

__results = []
__fn = globals().get(__function_name)
if not callable(__fn):
    __results = [{
        "index": 0,
        "passed": False,
        "got": None,
        "expected": None,
        "error": f"Function \`{__function_name}\` is not defined.",
    }]
else:
    for __i, __tc in enumerate(__test_cases):
        try:
            __got = __fn(*__tc["input"])
            __ok = __compare(__got, __tc["expected"], __comparator)
            __results.append({
                "index": __i,
                "passed": bool(__ok),
                "got": __got,
                "expected": __tc["expected"],
                "error": None,
            })
        except Exception as __e:
            __results.append({
                "index": __i,
                "passed": False,
                "got": None,
                "expected": __tc["expected"],
                "error": f"{type(__e).__name__}: {__e}",
            })

print(__json.dumps(__results, default=str))
`

// ────────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────────

export async function runUserCode(opts: RunOptions): Promise<RunOutcome> {
  const start = performance.now()
  const total = opts.testCases.length

  let pyo: Pyodide
  try {
    pyo = await loadPyodideSingleton()
  } catch (err) {
    return {
      results: [],
      passedCount: 0,
      totalCount: total,
      status: 'error',
      errorMessage: `Failed to load Python runtime: ${describeError(err)}`,
      runtimeMs: performance.now() - start,
    }
  }

  // Funnel print() output into a buffer instead of the browser console.
  let stdout = ''
  let stderr = ''
  pyo.setStdout({ batched: (s: string) => { stdout += s + '\n' } })
  pyo.setStderr({ batched: (s: string) => { stderr += s + '\n' } })

  // Push variables into Python globals so we don't have to embed JSON in
  // a triple-quoted Python string (which would break on triple-quote payloads).
  pyo.globals.set('__test_cases_json', JSON.stringify(opts.testCases))
  pyo.globals.set('__function_name', opts.functionName)
  pyo.globals.set('__comparator', opts.comparator)

  const fullSource = `${opts.userCode}\n${HARNESS_TAIL}`
  const timeoutMs = opts.timeoutMs ?? 5_000

  try {
    await Promise.race([
      pyo.runPythonAsync(fullSource),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Time limit exceeded (${timeoutMs}ms)`)),
          timeoutMs,
        ),
      ),
    ])
  } catch (err) {
    return {
      results: opts.testCases.map((tc, i) => ({
        index: i,
        passed: false,
        got: null,
        expected: tc.expected,
        error: i === 0 ? describeError(err) : null,
      })),
      passedCount: 0,
      totalCount: total,
      status: 'error',
      errorMessage: describeError(err) + (stderr ? `\n${stderr}` : ''),
      runtimeMs: performance.now() - start,
    }
  }

  // Parse the JSON dump from the last line of stdout.
  const trimmed = stdout.trim()
  const lastLine = trimmed.split('\n').pop() ?? ''
  let parsed: TestResult[]
  try {
    parsed = JSON.parse(lastLine) as TestResult[]
  } catch {
    return {
      results: opts.testCases.map((tc, i) => ({
        index: i,
        passed: false,
        got: null,
        expected: tc.expected,
        error: null,
      })),
      passedCount: 0,
      totalCount: total,
      status: 'error',
      errorMessage: 'Runner produced no parseable output.',
      runtimeMs: performance.now() - start,
    }
  }

  const passedCount = parsed.filter((r) => r.passed).length
  const allPassed = passedCount === parsed.length
  const anyHardError = parsed.some(
    (r) => r.error !== null && r.error !== undefined,
  )
  const status: RunOutcome['status'] = allPassed
    ? 'passed'
    : anyHardError && passedCount === 0
      ? 'error'
      : 'failed'

  return {
    results: parsed,
    passedCount,
    totalCount: parsed.length,
    status,
    errorMessage: null,
    runtimeMs: performance.now() - start,
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}
