/**
 * Peer Doubt Community types — mirror backend Pydantic schemas in
 * backend/app/schemas/community.py
 */

export type DoubtVisibility = 'public' | 'private'

export interface DoubtAnswerResponse {
  id: string
  doubt_id: string
  answered_by_id: string | null
  answered_by_name: string | null
  answered_by_role: string | null
  answer_text: string
  is_ai_generated: boolean
  is_accepted: boolean
  upvote_count: number
  created_at: string
}

export interface DoubtResponse {
  id: string
  student_id: string
  student_name: string | null
  subject_id: string | null
  subject_code: string | null
  visibility: DoubtVisibility
  assigned_teacher_id: string | null
  assigned_teacher_name: string | null
  title: string
  body: string
  tags: string[]
  is_resolved: boolean
  upvote_count: number
  view_count: number
  answer_count: number
  has_ai_answer: boolean
  created_at: string
}

export interface DoubtDetailResponse extends DoubtResponse {
  answers: DoubtAnswerResponse[]
}

export interface DoubtCreate {
  title: string
  body: string
  tags?: string[]
  subject_id?: string | null
  visibility?: DoubtVisibility
  assigned_teacher_id?: string | null
}

export interface DoubtAnswerCreate {
  answer_text: string
}

export interface AccessibleTeacher {
  id: string
  full_name: string
  department_name: string | null
  designation: string | null
  subject_codes: string[]
}
