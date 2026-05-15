/**
 * Algorithm-showcase types — mirror backend Pydantic schemas in
 * backend/app/schemas/algorithms.py
 */

// ── Hamming similarity (F23) ──

export interface HammingPairResponse {
  student_a_id: string
  student_a_name: string
  student_b_id: string
  student_b_name: string
  quiz_id: string
  quiz_title: string
  hamming_distance: number
  similarity_percent: number
  answer_length: number
}

export interface SimilarityCheckResponse {
  quiz_id: string
  total_attempts: number
  flagged_pairs: HammingPairResponse[]
  flagged_count: number
  mean_pairwise_similarity: number
  persisted_count: number
}

// ── Inclusion-exclusion (F25) ──

export interface SkillSetCount {
  skill: string
  count: number
  sample_names: string[]
}

export interface SkillIntersection {
  skills: string[]
  count: number
}

export interface InclusionExclusionResponse {
  skills: string[]
  per_skill: SkillSetCount[]
  intersections: SkillIntersection[]
  union_count_naive: number
  union_count_actual: number
  overlap_correction: number
  total_students: number
  matching_student_names: string[]
}

export interface InclusionExclusionRequest {
  skills: string[]
}

// ── Graph coloring (F21) ──

export interface QuizSlotAssignmentResponse {
  quiz_id: string
  quiz_title: string
  subject_code: string | null
  color: number
  conflict_quiz_titles: string[]
}

export interface GraphColoringResponse {
  assignments: QuizSlotAssignmentResponse[]
  chromatic_number: number
  quiz_count: number
  edge_count: number
  color_groups: Record<string, string[]>
}

// ── Backtracking schedule (F26) ──

export interface StudyTaskInput {
  topic: string
  hours: number
  priority?: number
  subject_code?: string | null
}

export interface StudyTaskResponse {
  topic: string
  hours: number
  priority: number
  subject_code: string | null
}

export interface ScheduleSlotResponse {
  day_index: number
  hour_index: number
  topic: string | null
  subject_code: string | null
  is_locked: boolean
}

export interface GenerateScheduleResponse {
  slots: ScheduleSlotResponse[]
  scheduled_tasks: StudyTaskResponse[]
  skipped_tasks: StudyTaskResponse[]
  total_value: number
  total_hours_scheduled: number
  explored_nodes: number
}

export type ScheduleStrategy = 'spread' | 'backtracking'

export interface GenerateScheduleRequest {
  tasks: StudyTaskInput[]
  days?: number
  /** Default `spread` — realistic round-robin. `backtracking` is the
   *  branch-and-bound packer used by Crash Mode. */
  strategy?: ScheduleStrategy
  /** Per-day hour ceiling for the `spread` strategy (default 3 server-side). */
  daily_cap_hours?: number
}
