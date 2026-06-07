/**
 * Chat types — mirror backend Pydantic schemas in backend/app/schemas/chat.py
 */

export type ChatType =
  | 'note_assistant'
  | 'college_gpt'
  | 'placement_chatbot'
  | 'resume_builder'
  | 'admin_knowledge'
  | 'dsa_coach'

export type MessageRole = 'user' | 'assistant' | 'system'

// DSA Coach: two modes, and a three-rung hint-intensity ladder.
export type CoachMode = 'hint' | 'solution'
export type HintLevel = 'nudge' | 'guide' | 'spell_it_out'

/**
 * Note Assistant response modes — the student picks one per message.
 * - explain   — concept explanation in plain markdown (default)
 * - diagram   — Mermaid diagram followed by an explanation
 * - questions — solved / unsolved practice problems in fenced cards
 */
export type AssistantMode = 'explain' | 'diagram' | 'questions'

export interface SourceCitation {
  document_id: string
  document_title: string
  subject_code: string
  subject_name: string
  chunk_index: number
  similarity: number
}

export interface ChatMessage {
  id: string
  session_id: string
  role: MessageRole
  content: string
  source_citations: SourceCitation[] | null
  /** Note Assistant mode the response was generated in (null for legacy + non-NA chats). */
  mode?: AssistantMode | null
  created_at: string
}

export interface ChatSession {
  id: string
  user_id: string
  chat_type: ChatType
  subject_id: string | null
  /** For DSA coach sessions: the coding problem this chat is bound to. */
  coding_problem_id: string | null
  title: string | null
  created_at: string
  last_message_at: string
}

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[]
}

export interface ChatSessionCreate {
  chat_type?: ChatType
  subject_id?: string
  coding_problem_id?: string
  title?: string
}

export interface ChatMessageRequest {
  content: string
  subject_id?: string
  stream?: boolean
  /** Note Assistant mode (server ignores it for non-NA sessions). */
  mode?: AssistantMode
}
