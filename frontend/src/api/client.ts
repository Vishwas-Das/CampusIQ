import { useAuthStore } from '../store/authStore'
import type {
  ATSScoreRequest,
  ATSScoreResponse,
  AdaptivePlanRequest,
  AdaptivePlanResponse,
  GenerateScheduleRequest,
  GenerateScheduleResponse,
  GraphColoringResponse,
  InclusionExclusionRequest,
  InclusionExclusionResponse,
  SimilarityCheckResponse,
  Announcement,
  AnnouncementCreate,
  AnnouncementUpdate,
  AssistantMode,
  AttemptHistoryRow,
  ChatMessage,
  ChatSession,
  ChatSessionCreate,
  ChatSessionWithMessages,
  ChatType,
  AdminDashboardResponse,
  AdminUserListResponse,
  BossBattleDetail,
  BossBattleListResponse,
  BossBattleSubmitResponse,
  ClassAnalytics,
  ChunkCreate,
  ChunkUpdate,
  CollegeDocument,
  CollegeDocumentCategory,
  KnowledgeSuggestion,
  CompanyProfile,
  DashboardResponse,
  DoubtAnswerCreate,
  DoubtAnswerResponse,
  DoubtCreate,
  DoubtDetailResponse,
  DoubtResponse,
  ConfidenceSessionResponse,
  ConfidenceTimelineResponse,
  InterviewMessageRequest,
  InterviewSessionListRow,
  InterviewSessionResponse,
  InterviewStartRequest,
  InterviewTurnResponse,
  InterviewVoiceTurnResponse,
  VoiceCapabilitiesResponse,
  JobApplicationCreate,
  JobApplicationResponse,
  JobApplicationUpdate,
  JobBoardResponse,
  JobListingCreate,
  JobListingResponse,
  Document,
  DocumentChunkPreview,
  DocumentWithSubject,
  GitHubImportRequest,
  GitHubImportResponse,
  LeaderboardResponse,
  LoginRequest,
  ProfileUpdateRequest,
  PublicProfileResponse,
  QuizAttemptCreate,
  QuizAttemptResponse,
  QuizForStudent,
  QuizForTeacher,
  QuizGenerateRequest,
  QuizSummary,
  QuizUpdate,
  ResumeChatHistory,
  ResumeChatRequest,
  ResumeChatResponse,
  ResumeContentUpdate,
  ResumeResponse,
  SignupRequest,
  SkillNodeResponse,
  SkillTreeResponse,
  StudentDetailResponse,
  StudyOptimizerHistoryRow,
  Subject,
  TeacherDashboardResponse,
  SubjectCreate,
  SubjectUpdate,
  TokenResponse,
  UploadCollegeDocumentOptions,
  User,
  WeakAreaResponse,
} from '../types'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:8000/api/v1'

export class ApiError extends Error {
  status: number
  detail: unknown
  body: unknown

  constructor(status: number, detail: unknown, body: unknown) {
    super(typeof detail === 'string' ? detail : 'Request failed')
    this.status = status
    this.detail = detail
    this.body = body
    this.name = 'ApiError'
  }
}

const AUTH_EXEMPT_PATHS = ['/auth/login', '/auth/signup']

interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'headers' | 'method'> {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { body, headers = {}, method = 'GET', ...rest } = options

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const finalHeaders: Record<string, string> = { ...headers }

  // Only set JSON content-type when the body isn't FormData — letting the browser
  // set the multipart boundary automatically.
  if (!isFormData && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json'
  }

  const token = useAuthStore.getState().token
  if (token && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${token}`
  }

  let finalBody: BodyInit | undefined
  if (body === undefined || body === null) {
    finalBody = undefined
  } else if (isFormData || typeof body === 'string') {
    finalBody = body as BodyInit
  } else {
    finalBody = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    method,
    headers: finalHeaders,
    body: finalBody,
  })

  // Parse response body (JSON preferred)
  let data: unknown = null
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      data = await response.json()
    } catch {
      data = null
    }
  } else {
    try {
      data = await response.text()
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const isAuthPath = AUTH_EXEMPT_PATHS.some((p) => path.startsWith(p))
    if (response.status === 401 && !isAuthPath) {
      useAuthStore.getState().logout()
    }
    const detail =
      (typeof data === 'object' && data !== null && 'detail' in data
        ? (data as { detail: unknown }).detail
        : null) ??
      (typeof data === 'string' ? data : null) ??
      `HTTP ${response.status}`
    throw new ApiError(response.status, detail, data)
  }

  return data as T
}

// ── Typed helpers ──

export const api = {
  get: <T = unknown>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = unknown>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
}

// ── Auth-specific API calls ──

export interface PasswordChangeRequest {
  current_password: string
  new_password: string
}

export interface StudentProfileUpdate {
  branch?: string | null
  semester?: number | null
  cgpa?: number | null
  github_url?: string | null
  linkedin_url?: string | null
  skills?: string[] | null
  target_companies?: string[] | null
  target_role?: string | null
}

export const authApi = {
  signup: (data: SignupRequest) => api.post<TokenResponse>('/auth/signup', data),
  login: (email: string, password: string) =>
    api.post<TokenResponse>('/auth/login', { email, password } satisfies LoginRequest),
  me: () => api.get<User>('/auth/me'),
  changePassword: (data: PasswordChangeRequest) =>
    api.patch<{ detail: string }>('/auth/me/password', data),
  updateProfile: (data: StudentProfileUpdate) =>
    api.patch<User>('/auth/me/profile', data),
  deleteAccount: () => api.delete<void>('/auth/me'),
}

// ── Subject CRUD ──

export const subjectsApi = {
  list: () => api.get<Subject[]>('/subjects/'),
  get: (id: string) => api.get<Subject>(`/subjects/${id}`),
  create: (data: SubjectCreate) => api.post<Subject>('/subjects/', data),
  update: (id: string, data: SubjectUpdate) => api.patch<Subject>(`/subjects/${id}`, data),
  delete: (id: string) => api.delete<void>(`/subjects/${id}`),
}

// ── Document CRUD ──

export interface UploadDocumentOptions {
  file: File
  subjectId: string
  title?: string
}

// ── Chat (Note Assistant + others) ──

export interface StreamMessageOptions {
  sessionId: string
  content: string
  subjectId?: string
  /** Note Assistant mode. Server ignores it for non-NA sessions. */
  mode?: AssistantMode
  onChunk: (delta: string) => void
  signal?: AbortSignal
}

export const chatApi = {
  listSessions: (chatType: ChatType = 'note_assistant', subjectId?: string) => {
    const params = new URLSearchParams({ chat_type: chatType })
    if (subjectId) params.set('subject_id', subjectId)
    return api.get<ChatSession[]>(`/chat/sessions?${params.toString()}`)
  },
  createSession: (data: ChatSessionCreate) => api.post<ChatSession>('/chat/sessions', data),
  getSession: (id: string) => api.get<ChatSessionWithMessages>(`/chat/sessions/${id}`),
  deleteSession: (id: string) => api.delete<void>(`/chat/sessions/${id}`),

  /**
   * Stream a new message into an existing session. The Promise resolves once
   * the server is done streaming. Each text delta is delivered to `onChunk`.
   */
  streamMessage: async ({ sessionId, content, subjectId, mode, onChunk, signal }: StreamMessageOptions): Promise<void> => {
    const token = useAuthStore.getState().token
    if (!token) throw new ApiError(401, 'Not authenticated', null)

    const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content, subject_id: subjectId, stream: true, mode }),
      signal,
    })

    if (!response.ok) {
      let detail: unknown = `HTTP ${response.status}`
      try {
        const errBody = await response.json()
        detail = errBody.detail ?? detail
      } catch {
        // ignore
      }
      if (response.status === 401) useAuthStore.getState().logout()
      throw new ApiError(response.status, detail, null)
    }

    if (!response.body) {
      throw new ApiError(500, 'No response body from server', null)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (text) onChunk(text)
    }
    // Flush any remaining bytes from the decoder
    const tail = decoder.decode()
    if (tail) onChunk(tail)
  },

  // Non-streaming convenience for tests / simple flows
  sendMessageBlocking: (sessionId: string, content: string, subjectId?: string, mode?: AssistantMode) =>
    api.post<ChatMessage>(`/chat/sessions/${sessionId}/messages/blocking`, {
      content,
      subject_id: subjectId,
      mode,
    }),
}


export const documentsApi = {
  list: (subjectId?: string) => {
    const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : ''
    return api.get<DocumentWithSubject[]>(`/documents/${query}`)
  },
  get: (id: string) => api.get<Document>(`/documents/${id}`),
  upload: ({ file, subjectId, title }: UploadDocumentOptions) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('subject_id', subjectId)
    if (title) formData.append('title', title)
    return api.post<Document>('/documents/upload', formData)
  },
  chunks: (id: string) => api.get<DocumentChunkPreview[]>(`/documents/${id}/chunks`),
  reprocess: (id: string) => api.post<Document>(`/documents/${id}/reprocess`),
  delete: (id: string) => api.delete<void>(`/documents/${id}`),
  downloadUrl: (id: string) => `${API_BASE_URL}/documents/${id}/download`,
}

// ── College Documents (Phase 10, F5) ──

export const collegeDocumentsApi = {
  list: (category?: CollegeDocumentCategory | 'all') => {
    const query = category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : ''
    return api.get<CollegeDocument[]>(`/college-documents/${query}`)
  },
  get: (id: string) => api.get<CollegeDocument>(`/college-documents/${id}`),
  upload: ({ file, title, documentCategory }: UploadCollegeDocumentOptions) => {
    const formData = new FormData()
    formData.append('file', file)
    if (title) formData.append('title', title)
    if (documentCategory) formData.append('document_category', documentCategory)
    return api.post<CollegeDocument>('/college-documents/upload', formData)
  },
  reprocess: (id: string) => api.post<CollegeDocument>(`/college-documents/${id}/reprocess`),
  delete: (id: string) => api.delete<void>(`/college-documents/${id}`),
  // ── Knowledge Editor: chunk CRUD (admin-only) ──
  listChunks: (id: string) =>
    api.get<DocumentChunkPreview[]>(`/college-documents/${id}/chunks`),
  updateChunk: (docId: string, chunkId: string, body: ChunkUpdate) =>
    api.patch<DocumentChunkPreview>(
      `/college-documents/${docId}/chunks/${chunkId}`,
      body,
    ),
  createChunk: (docId: string, body: ChunkCreate) =>
    api.post<DocumentChunkPreview>(`/college-documents/${docId}/chunks`, body),
  deleteChunk: (docId: string, chunkId: string) =>
    api.delete<void>(`/college-documents/${docId}/chunks/${chunkId}`),
}

export const knowledgeApi = {
  suggest: (statement: string, hintCategory?: CollegeDocumentCategory) =>
    api.post<KnowledgeSuggestion>('/college-documents/suggest', {
      statement,
      hint_category: hintCategory ?? null,
    }),
}

// ── Quizzes (Phase 11, F3) ──

export const quizzesApi = {
  list: (subjectId?: string) => {
    const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : ''
    return api.get<QuizSummary[]>(`/quizzes/${query}`)
  },
  // The same endpoint returns student-view OR teacher-view based on the caller's role.
  getAsStudent: (id: string) => api.get<QuizForStudent>(`/quizzes/${id}`),
  getAsTeacher: (id: string) => api.get<QuizForTeacher>(`/quizzes/${id}`),

  generate: (data: QuizGenerateRequest) => api.post<QuizForTeacher>('/quizzes/generate', data),
  update: (id: string, data: QuizUpdate) => api.patch<QuizForTeacher>(`/quizzes/${id}`, data),
  publish: (id: string, publish: boolean = true) =>
    api.post<QuizForTeacher>(`/quizzes/${id}/publish?publish=${publish}`),
  delete: (id: string) => api.delete<void>(`/quizzes/${id}`),

  submitAttempt: (quizId: string, data: QuizAttemptCreate) =>
    api.post<QuizAttemptResponse>(`/quizzes/${quizId}/attempts`, data),
  myAttempts: (subjectId?: string) => {
    const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : ''
    return api.get<AttemptHistoryRow[]>(`/quizzes/attempts/me${query}`)
  },
  myWeakAreas: () => api.get<WeakAreaResponse[]>('/quizzes/attempts/me/weak-areas'),
}

// ── Dashboard (Phase 12, F13/F16/F20) ──

export const dashboardApi = {
  me: () => api.get<DashboardResponse>('/dashboard/me'),
  teacher: () => api.get<TeacherDashboardResponse>('/dashboard/teacher'),
  admin: () => api.get<AdminDashboardResponse>('/dashboard/admin'),
}

// ── Admin (Phase 4 wiring) ──

export const adminApi = {
  listUsers: (params?: {
    role?: 'student' | 'teacher' | 'admin' | 'all'
    search?: string
    limit?: number
    offset?: number
  }) => {
    const qs = new URLSearchParams()
    if (params?.role) qs.set('role', params.role)
    if (params?.search) qs.set('search', params.search)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return api.get<AdminUserListResponse>(`/admin/users${query}`)
  },
}

// ── Announcements (Phase 13) ──

export const announcementsApi = {
  list: (params?: { subjectId?: string; onlyMine?: boolean; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.subjectId) qs.set('subject_id', params.subjectId)
    if (params?.onlyMine) qs.set('only_mine', 'true')
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return api.get<Announcement[]>(`/announcements/${query}`)
  },
  create: (data: AnnouncementCreate) => api.post<Announcement>('/announcements/', data),
  update: (id: string, data: AnnouncementUpdate) =>
    api.patch<Announcement>(`/announcements/${id}`, data),
  delete: (id: string) => api.delete<void>(`/announcements/${id}`),
}

// ── Analytics (Phase 13) ──

export const analyticsApi = {
  class: (subjectId?: string) => {
    const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : ''
    return api.get<ClassAnalytics>(`/analytics/class${query}`)
  },
  studentDetail: (studentId: string) =>
    api.get<StudentDetailResponse>(`/analytics/students/${studentId}`),
}

// ── Boss Battles (Phase 10) ──

export const bossBattlesApi = {
  list: () => api.get<BossBattleListResponse>('/boss-battles/'),
  get: (id: string) => api.get<BossBattleDetail>(`/boss-battles/${id}`),
  submit: (id: string, data: { answers: Record<string, string>; elapsed_seconds: number }) =>
    api.post<BossBattleSubmitResponse>(`/boss-battles/${id}/submit`, data),
}

// ── Algorithm Showcase (Phase 19, F21/F23/F25/F26) ──

export const algorithmsApi = {
  hammingForQuiz: (quizId: string, maxDistance: number = 2) =>
    api.post<SimilarityCheckResponse>(
      `/algorithms/hamming/quiz/${quizId}?max_distance=${maxDistance}&persist=true`,
    ),
  inclusionExclusion: (data: InclusionExclusionRequest) =>
    api.post<InclusionExclusionResponse>('/algorithms/inclusion-exclusion', data),
  graphColoringForQuizzes: () =>
    api.post<GraphColoringResponse>('/algorithms/graph-coloring/quizzes'),
  generateSchedule: (data: GenerateScheduleRequest) =>
    api.post<GenerateScheduleResponse>('/algorithms/schedule/generate', data),
}

// ── Gamification (Phase 18, F13/F14/F16) ──

export const gamificationApi = {
  leaderboard: (limit: number = 50) =>
    api.get<LeaderboardResponse>(`/gamification/leaderboard?limit=${limit}`),
  mySkillTree: () => api.get<SkillTreeResponse>('/gamification/skill-tree/me'),
  myProfile: () => api.get<PublicProfileResponse>('/gamification/profile/me'),
  updateProfile: (data: ProfileUpdateRequest) =>
    api.patch<PublicProfileResponse>('/gamification/profile/me', data),
  recomputeScore: () => api.post<{ total: number; academic: number; skill: number; interview: number; placement: number }>('/gamification/score/me/recompute'),
}

// ── Public Recruiter Profile (Phase 21, F15) — no auth ──

export const publicProfileApi = {
  get: (studentId: string) =>
    api.get<PublicProfileResponse>(`/profile/public/${studentId}`),
}

// ── Job Tracker (Phase 17, F12) ──

export const jobsApi = {
  list: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : ''
    return api.get<JobListingResponse[]>(`/jobs/${qs}`)
  },
  create: (data: JobListingCreate) => api.post<JobListingResponse>('/jobs/', data),
  delete: (id: string) => api.delete<void>(`/jobs/${id}`),
  seed: () => api.post<{ seeded: number }>('/jobs/seed'),
  myBoard: () => api.get<JobBoardResponse>('/jobs/me/board'),
  saveApplication: (data: JobApplicationCreate) =>
    api.post<JobApplicationResponse>('/jobs/me/applications', data),
  updateApplication: (id: string, data: JobApplicationUpdate) =>
    api.patch<JobApplicationResponse>(`/jobs/me/applications/${id}`, data),
  deleteApplication: (id: string) => api.delete<void>(`/jobs/me/applications/${id}`),
}

// ── Peer Doubt Community (Phase 17, F4) ──

export const communityApi = {
  list: (params?: { search?: string; tag?: string; onlyMine?: boolean; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.search) qs.set('search', params.search)
    if (params?.tag) qs.set('tag', params.tag)
    if (params?.onlyMine) qs.set('only_mine', 'true')
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return api.get<DoubtResponse[]>(`/community/${query}`)
  },
  create: (data: DoubtCreate) => api.post<DoubtResponse>('/community/', data),
  get: (id: string) => api.get<DoubtDetailResponse>(`/community/${id}`),
  upvote: (id: string) => api.post<DoubtResponse>(`/community/${id}/upvote`),
  delete: (id: string) => api.delete<void>(`/community/${id}`),
  answer: (id: string, data: DoubtAnswerCreate) =>
    api.post<DoubtAnswerResponse>(`/community/${id}/answers`, data),
  upvoteAnswer: (id: string) => api.post<DoubtAnswerResponse>(`/community/answers/${id}/upvote`),
  acceptAnswer: (id: string) => api.post<DoubtAnswerResponse>(`/community/answers/${id}/accept`),
}

// ── Mock Interview Text Mode (Phase 16, F9) + Voice Mode (Phase 20) ──

export interface VoiceTurnUploadOptions {
  sessionId: string
  audioBlob: Blob
  browserTranscript?: string | null
}

export const interviewsApi = {
  start: (data: InterviewStartRequest) =>
    api.post<InterviewSessionResponse>('/interviews/', data),
  get: (id: string) => api.get<InterviewSessionResponse>(`/interviews/${id}`),
  sendMessage: (id: string, data: InterviewMessageRequest) =>
    api.post<InterviewTurnResponse>(`/interviews/${id}/messages`, data),
  end: (id: string) => api.post<InterviewSessionResponse>(`/interviews/${id}/end`),
  listMine: () => api.get<InterviewSessionListRow[]>('/interviews/me'),

  // ── Phase 20 — voice mode ──
  voiceCapabilities: () =>
    api.get<VoiceCapabilitiesResponse>('/interviews/voice/capabilities'),

  // Uploads one audio turn as multipart/form-data. The browser_transcript
  // field is optional — include it when the client has already transcribed
  // via the Web Speech API so the server doesn't need to call Whisper.
  sendVoice: ({ sessionId, audioBlob, browserTranscript }: VoiceTurnUploadOptions) => {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'answer.webm')
    if (browserTranscript && browserTranscript.trim()) {
      formData.append('browser_transcript', browserTranscript.trim())
    }
    return api.post<InterviewVoiceTurnResponse>(
      `/interviews/${sessionId}/voice`,
      formData,
    )
  },
}

// ── Confidence Coach (Phase 20, F11) ──

export interface ConfidenceUploadOptions {
  audioBlob: Blob
  prompt: string
  durationSeconds: number
  eyeContactPct?: number | null
  posturePct?: number | null
  browserTranscript?: string | null
}

export const confidenceApi = {
  timeline: () => api.get<ConfidenceTimelineResponse>('/confidence/sessions/me'),
  get: (id: string) => api.get<ConfidenceSessionResponse>(`/confidence/sessions/${id}`),
  submit: ({
    audioBlob,
    prompt,
    durationSeconds,
    eyeContactPct,
    posturePct,
    browserTranscript,
  }: ConfidenceUploadOptions) => {
    const formData = new FormData()
    formData.append('audio', audioBlob, 'confidence.webm')
    formData.append('prompt', prompt)
    formData.append('duration_seconds', String(durationSeconds))
    if (eyeContactPct != null) formData.append('eye_contact_pct', String(eyeContactPct))
    if (posturePct != null) formData.append('posture_pct', String(posturePct))
    if (browserTranscript && browserTranscript.trim()) {
      formData.append('browser_transcript', browserTranscript.trim())
    }
    return api.post<ConfidenceSessionResponse>('/confidence/sessions', formData)
  },
}

// ── Adaptive Learning Engine (Phase 15, F7/F17/F18/F22) ──

export const skillsApi = {
  nodes: () => api.get<SkillNodeResponse[]>('/skills/nodes'),
  companies: () => api.get<CompanyProfile[]>('/skills/companies'),
  buildPlan: (data: AdaptivePlanRequest) =>
    api.post<AdaptivePlanResponse>('/skills/me/plan', data),
  planHistory: () => api.get<StudyOptimizerHistoryRow[]>('/skills/me/plans'),
}

// ── Resume Builder (Phase 14, F6) ──

export const resumeApi = {
  me: () => api.get<ResumeResponse>('/resume/me'),
  update: (data: ResumeContentUpdate) => api.patch<ResumeResponse>('/resume/me', data),
  history: () => api.get<ResumeChatHistory>('/resume/me/messages'),
  resetHistory: () => api.delete<void>('/resume/me/messages'),
  chat: (data: ResumeChatRequest) =>
    api.post<ResumeChatResponse>('/resume/me/chat', data),
  scoreAts: (data: ATSScoreRequest) =>
    api.post<ATSScoreResponse>('/resume/me/ats-score', data),
  importGithub: (data: GitHubImportRequest) =>
    api.post<GitHubImportResponse>('/resume/me/import-github', data),
}

export { API_BASE_URL }
