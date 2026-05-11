/**
 * Coding-practice platform types — mirrors backend/app/schemas/coding.py.
 */

export type CodingDifficulty = 'easy' | 'medium' | 'hard'
export type CodingLanguage = 'python' | 'cpp' | 'java'
export type CodingSubmissionStatus = 'passed' | 'failed' | 'error'
export type UserProblemStatus = 'solved' | 'attempted' | 'unsolved'

export interface ProblemExample {
  input: string
  output: string
  explanation?: string | null
}

export interface CodingTestCase {
  /** Positional arguments passed to the user's function. */
  input: unknown[]
  expected: unknown
}

export interface FunctionSignature {
  params: { name: string; type: string }[]
  returns?: string | null
}

export interface ProblemListItem {
  id: string
  slug: string
  title: string
  difficulty: CodingDifficulty
  topic_tags: string[]
  user_status: UserProblemStatus
}

export interface ProblemDetail {
  id: string
  slug: string
  title: string
  description: string
  difficulty: CodingDifficulty
  function_name: string
  function_signature: FunctionSignature
  examples: ProblemExample[]
  hints: string[]
  starter_code: Record<string, string>
  reference_solution: Record<string, string> | null
  visible_test_cases: CodingTestCase[]
  comparator: string
  topic_tags: string[]
  skill_node_names: string[]
  user_status: UserProblemStatus
}

export interface ProblemRunnerPayload {
  function_name: string
  visible_test_cases: CodingTestCase[]
  hidden_test_cases: CodingTestCase[]
  comparator: string
}

export interface SubmitRequest {
  language: CodingLanguage
  code: string
  status: CodingSubmissionStatus
  passed_count: number
  total_count: number
  runtime_ms?: number | null
  error_message?: string | null
}

export interface SubmissionResponse {
  id: string
  problem_id: string
  language: CodingLanguage
  code: string
  status: CodingSubmissionStatus
  passed_count: number
  total_count: number
  runtime_ms?: number | null
  error_message?: string | null
  submitted_at: string
}

export interface SubmitResultResponse {
  submission: SubmissionResponse
  first_solve: boolean
  xp_earned: number
  new_level?: number | null
  leveled_up: boolean
}

export interface CodingStatsResponse {
  solved_easy: number
  solved_medium: number
  solved_hard: number
  total_problems: number
  total_submissions: number
  streak_days: number
}

export interface ListProblemsOptions {
  difficulty?: CodingDifficulty
  topic?: string
  userStatus?: UserProblemStatus
}
