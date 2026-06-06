/**
 * Quiz types — mirror backend Pydantic schemas in
 * backend/app/schemas/quiz.py
 */

export type Difficulty = 'easy' | 'medium' | 'hard'
export type QuestionType = 'mcq' | 'short_answer'

export interface QuestionStudentView {
  id: string
  order_index: number
  question_text: string
  question_type: QuestionType
  options: string[] | null
  difficulty: Difficulty
  topic: string | null
}

export interface QuestionTeacherView extends QuestionStudentView {
  correct_answer: string
  explanation: string | null
}

export interface QuizSummary {
  id: string
  subject_id: string
  document_id: string | null
  created_by_id: string
  title: string
  description: string | null
  difficulty: Difficulty
  time_limit_minutes: number | null
  /** Exact per-attempt duration in seconds. Source of truth — minutes is kept
   *  for legacy display only. */
  time_limit_seconds: number | null
  /** ISO 8601 UTC timestamps for the open / close window. null = no bound. */
  opens_at: string | null
  closes_at: string | null
  is_published: boolean
  is_ai_generated: boolean
  created_at: string
  question_count: number
  attempt_count: number
  avg_score: number | null
  subject_code: string | null
  subject_name: string | null
  /** Set on student-facing responses only — true iff this student has already
   *  submitted an attempt. Drives the "Take" → "View Result" UI switch. */
  has_attempted: boolean | null
}

export interface QuizForStudent extends QuizSummary {
  questions: QuestionStudentView[]
}

export interface QuizForTeacher extends QuizSummary {
  questions: QuestionTeacherView[]
}

export interface QuizGenerateRequest {
  subject_id: string
  /** Legacy single doc — backend folds this into document_ids if both given. */
  document_id?: string | null
  /** Multi-doc selection. null/empty/undefined = backend uses all docs in
   *  the subject. Non-empty = use only those documents. */
  document_ids?: string[] | null
  topic_hint?: string | null
  num_questions?: number
  difficulty?: Difficulty
}

export interface QuestionUpdate {
  id?: string | null
  question_text: string
  question_type?: QuestionType
  options?: string[] | null
  correct_answer: string
  explanation?: string | null
  difficulty?: Difficulty
  topic?: string | null
  order_index?: number
}

export interface QuizUpdate {
  title?: string
  description?: string
  difficulty?: Difficulty
  time_limit_minutes?: number
  time_limit_seconds?: number
  /** Send ISO strings (use new Date(...).toISOString()) — backend stores UTC. */
  opens_at?: string | null
  closes_at?: string | null
  is_published?: boolean
  questions?: QuestionUpdate[]
}

export interface QuestionAnswer {
  question_id: string
  student_answer: string
}

/** Student-raised flag on a question ("this seems broken / ambiguous").
 *  One row per (student, question) — re-flagging just updates the reason. */
export interface QuestionFlag {
  id: string
  question_id: string
  student_id: string
  reason: string | null
  created_at: string
  updated_at: string
}

export interface QuestionFlagCreate {
  reason?: string | null
}

export interface QuizAttemptCreate {
  answers: QuestionAnswer[]
  time_taken_seconds?: number | null
}

export interface GradedAnswer {
  question_id: string
  question_text: string
  student_answer: string
  correct_answer: string
  is_correct: boolean
  topic: string | null
  difficulty: Difficulty
  explanation: string | null
}

export interface QuizAttemptResponse {
  id: string
  quiz_id: string
  student_id: string
  score: number
  total_questions: number
  correct_count: number
  time_taken_seconds: number | null
  completed_at: string
  graded_answers: GradedAnswer[]
  weak_topics: string[]
  next_difficulty_recommendation: Difficulty | null
}

export interface AttemptHistoryRow {
  id: string
  quiz_id: string
  quiz_title: string
  subject_code: string
  subject_name: string
  score: number
  total_questions: number
  correct_count: number
  time_taken_seconds: number | null
  difficulty: Difficulty
  completed_at: string
}

export interface WeakAreaResponse {
  topic: string
  subject_code: string | null
  subject_name: string | null
  score_percent: number
  attempts_count: number
  suggestion: string
}
