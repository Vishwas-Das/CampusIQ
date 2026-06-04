import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
} from 'react-router-dom'

import AppLayout from '../components/layout/AppLayout'
import ProtectedRoute from './ProtectedRoute'
import PublicOnlyRoute from './PublicOnlyRoute'

// Auth pages (no sidebar)
import LandingPage from '../pages/auth/LandingPage'
import LoginPage from '../pages/auth/LoginPage'
import SignupPage from '../pages/auth/SignupPage'

// Public pages (no auth, accessible to anyone)
import RecruiterProfilePage from '../pages/public/RecruiterProfilePage'

// Student pages
import StudentDashboard from '../pages/student/DashboardPage'
import NoteAssistantPage from '../pages/student/NoteAssistantPage'
import CollegeGPTPage from '../pages/student/CollegeGPTPage'
import QuizListPage from '../pages/student/QuizListPage'
import QuizTakingPage from '../pages/student/QuizTakingPage'
import QuizResultPage from '../pages/student/QuizResultPage'
import CommunityPage from '../pages/student/CommunityPage'
import SchedulePage from '../pages/student/SchedulePage'
import ResumeBuilderPage from '../pages/student/ResumeBuilderPage'
import SkillGapPage from '../pages/student/SkillGapPage'
import MockInterviewPage from '../pages/student/MockInterviewPage'
import ConfidenceCoachPage from '../pages/student/ConfidenceCoachPage'
import JobTrackerPage from '../pages/student/JobTrackerPage'
import PlacementChatPage from '../pages/student/PlacementChatPage'
import CrashModePage from '../pages/student/CrashModePage'
import SkillTreePage from '../pages/student/SkillTreePage'
import LeaderboardPage from '../pages/student/LeaderboardPage'
import ProfilePage from '../pages/student/ProfilePage'
import SettingsPage from '../pages/student/SettingsPage'
import TeacherSettingsPage from '../pages/teacher/SettingsPage'
import BossBattlesPage from '../pages/student/BossBattlesPage'
import ResumePrintPage from '../pages/student/ResumePrintPage'

// Teacher pages
import TeacherDashboard from '../pages/teacher/DashboardPage'
import SubjectsPage from '../pages/teacher/SubjectsPage'
import DocumentsPage from '../pages/teacher/DocumentsPage'
import QuizManagementPage from '../pages/teacher/QuizManagementPage'
import AnnouncementsPage from '../pages/teacher/AnnouncementsPage'
import QuizSchedulingPage from '../pages/teacher/QuizSchedulingPage'
import AnalyticsPage from '../pages/teacher/AnalyticsPage'
import StudentDetailsPage from '../pages/teacher/StudentDetailsPage'
import SimilarityCheckerPage from '../pages/teacher/SimilarityCheckerPage'

// Admin pages
import AdminDashboard from '../pages/admin/DashboardPage'
import CollegeDocsPage from '../pages/admin/CollegeDocsPage'
import KnowledgeEditorPage from '../pages/admin/KnowledgeEditorPage'
import UserManagementPage from '../pages/admin/UserManagementPage'
import SkillAnalyticsPage from '../pages/admin/SkillAnalyticsPage'
import NotificationStatusPage from '../pages/admin/NotificationStatusPage'

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      {/* Landing is always public */}
      <Route path="/" element={<LandingPage />} />

      {/* Public recruiter profile (F15) — no auth, share-link friendly */}
      <Route path="p/:studentId" element={<RecruiterProfilePage />} />

      {/* Login/Signup — redirect to home if already authenticated */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
      </Route>

      {/* Student routes (login required, role: student) */}
      <Route element={<ProtectedRoute allowedRoles={['student']} />}>
        {/* Resume print view — outside AppLayout so the entire page is the resume. */}
        <Route path="student/resume/print" element={<ResumePrintPage />} />
        <Route path="student" element={<AppLayout />}>
          <Route index element={<StudentDashboard />} />
          <Route path="notes" element={<NoteAssistantPage />} />
          <Route path="college-gpt" element={<CollegeGPTPage />} />
          <Route path="quizzes" element={<QuizListPage />} />
          <Route path="quizzes/:quizId/take" element={<QuizTakingPage />} />
          <Route path="quizzes/:quizId/result/:attemptId" element={<QuizResultPage />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="resume" element={<ResumeBuilderPage />} />
          <Route path="skill-gap" element={<SkillGapPage />} />
          <Route path="interview" element={<MockInterviewPage />} />
          <Route path="confidence" element={<ConfidenceCoachPage />} />
          <Route path="jobs" element={<JobTrackerPage />} />
          <Route path="placement-chat" element={<PlacementChatPage />} />
          <Route path="crash-mode" element={<CrashModePage />} />
          <Route path="skill-tree" element={<SkillTreePage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="boss-battles" element={<BossBattlesPage />} />
        </Route>
      </Route>

      {/* Teacher routes (login required, role: teacher) */}
      <Route element={<ProtectedRoute allowedRoles={['teacher']} />}>
        <Route path="teacher" element={<AppLayout />}>
          <Route index element={<TeacherDashboard />} />
          <Route path="subjects" element={<SubjectsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="quizzes" element={<QuizManagementPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="quiz-scheduling" element={<QuizSchedulingPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="students" element={<StudentDetailsPage />} />
          <Route path="similarity" element={<SimilarityCheckerPage />} />
          <Route path="doubts" element={<CommunityPage />} />
          <Route path="settings" element={<TeacherSettingsPage />} />
        </Route>
      </Route>

      {/* Admin routes (login required, role: admin) */}
      <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
        <Route path="admin" element={<AppLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="college-docs" element={<CollegeDocsPage />} />
          <Route path="knowledge" element={<KnowledgeEditorPage />} />
          <Route path="users" element={<UserManagementPage />} />
          <Route path="skill-analytics" element={<SkillAnalyticsPage />} />
          <Route path="notifications" element={<NotificationStatusPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </>,
  ),
)

export function AppRouter() {
  return <RouterProvider router={router} />
}
