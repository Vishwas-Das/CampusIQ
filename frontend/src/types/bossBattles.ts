/**
 * Boss Battle types — Phase 10. Mirrors backend payloads in
 * `backend/app/services/boss_battles.py`.
 */

export interface BossBattleQuestion {
  id: string
  question: string
  options: string[]
}

export interface BossBattleEntry {
  id: string
  score: number
  rank: number | null
  submitted_at: string
}

export type BossBattleStatus = 'active' | 'upcoming' | 'past'

export interface BossBattle {
  id: string
  title: string
  description: string | null
  challenge_type: 'boss_battle'
  is_active: boolean
  start_time: string
  end_time: string
  time_limit_seconds: number | null
  xp_reward: number
  question_count: number
  questions: BossBattleQuestion[]
  status: BossBattleStatus
  my_entry: BossBattleEntry | null
}

export interface BossBattleLeaderboardRow {
  rank: number
  student_id: string
  name: string
  score: number
  submitted_at: string
}

export interface BossBattleDetail extends BossBattle {
  leaderboard: BossBattleLeaderboardRow[]
}

export interface BossBattleListResponse {
  active: BossBattle[]
  upcoming: BossBattle[]
  past: BossBattle[]
}

export interface BossBattleAnswerBreakdown {
  question_id: string
  question: string
  student_answer: string | null
  correct_answer: string
  is_correct: boolean
}

export interface BossBattleSubmitResponse {
  entry: BossBattleEntry
  score: number
  correct_count: number
  total_questions: number
  speed_bonus: number
  breakdown: BossBattleAnswerBreakdown[]
}
