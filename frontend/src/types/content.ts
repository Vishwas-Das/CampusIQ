/**
 * Subject + document types — mirror backend Pydantic schemas
 * in backend/app/schemas/{subject,document}.py
 */

export type DocumentProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface CompressionStats {
  original_bytes: number
  compressed_bytes: number
  savings_percent: number
  chunk_count: number
}

export interface DocumentChunkPreview {
  id: string
  chunk_index: number
  chunk_text: string
  compression_ratio: number | null
  compressed_bytes: number | null
  original_bytes: number | null
}

export interface Subject {
  id: string
  teacher_id: string
  /**
   * NotebookLM-style visibility:
   * - `null` → public teacher subject (visible to every student).
   * - non-null → student's personal notebook, only visible to that student.
   */
  owner_student_id: string | null
  college_id: string | null
  code: string
  name: string
  description: string | null
  semester: number | null
  branch: string | null
  created_at: string
  document_count: number
  quiz_count: number
  student_count: number
}

export interface SubjectCreate {
  /** Optional for student-created notebooks (auto-generated server-side). */
  code?: string
  name: string
  description?: string
  semester?: number
  branch?: string
}

export interface SubjectUpdate {
  name?: string
  description?: string
  semester?: number
  branch?: string
}

export interface Document {
  id: string
  subject_id: string
  uploaded_by_id: string
  /**
   * NotebookLM-style visibility:
   * - `null` → public document (uploaded by a teacher or admin, visible to
   *   anyone who can read the subject).
   * - non-null → personal note scoped to that student only.
   */
  owner_student_id: string | null
  title: string
  file_name: string
  content_type: string | null
  file_size_bytes: number | null
  summary: string | null
  /** Teacher-supplied chapter / unit label (e.g. "Unit 2 - Network Layer").
   *  When set, this also becomes the default download filename. */
  chapter: string | null
  /** Short teacher announcement ("Here is the notes for chapter 1"). Renders
   *  above the AI summary in the student's note preview. */
  description: string | null
  processing_status: DocumentProcessingStatus
  created_at: string
  compression_stats: CompressionStats | null
}

export interface DocumentWithSubject extends Document {
  subject_code: string
  subject_name: string
}

// ── CollegeGPT (Phase 10, F5) ──

export type CollegeDocumentCategory =
  | 'handbook'
  | 'timetable'
  | 'placement_record'
  | 'faculty_list'
  | 'hostel_rules'
  | 'other'

export interface CollegeDocument {
  id: string
  college_id: string | null
  uploaded_by_id: string
  title: string
  file_name: string
  file_type: string | null
  document_category: CollegeDocumentCategory
  summary: string | null
  processing_status: DocumentProcessingStatus
  created_at: string
  compression_stats: CompressionStats | null
}

export interface UploadCollegeDocumentOptions {
  file: File
  title?: string
  documentCategory?: CollegeDocumentCategory
}

// ── Knowledge Editor — admin chunk CRUD + AI suggestions ──

export interface ChunkUpdate {
  chunk_text: string
}

export interface ChunkCreate {
  chunk_text: string
  chunk_index?: number
}

export interface SuggestionCandidate {
  document_id: string
  document_title: string
  document_category: CollegeDocumentCategory
  similarity: number
}

export interface KnowledgeSuggestion {
  kind: 'update_existing' | 'create_new'
  similarity: number
  document_id: string | null
  document_title: string | null
  document_category: CollegeDocumentCategory | null
  chunk_id: string | null
  chunk_index: number | null
  current_chunk_text: string | null
  proposed_chunk_text: string
  candidate_documents: SuggestionCandidate[]
}
