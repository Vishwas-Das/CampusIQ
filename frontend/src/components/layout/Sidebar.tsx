import { NavLink, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  LayoutDashboard, BookOpen, GraduationCap, Brain, MessageSquare,
  Calendar, FileText, Target, Mic, Video, Briefcase, MessageCircle,
  Zap, Trophy, User, Settings, ChevronLeft, ChevronRight,
  Upload, BarChart3, Users, Shield, Bell, ClipboardList,
  GitBranch, AlertTriangle, LogOut, Swords, PenLine,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

type Role = 'student' | 'teacher' | 'admin'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  end?: boolean
}

interface NavSection {
  group: string
  items: NavItem[]
}

const studentNav: NavSection[] = [
  {
    group: 'LEARN MODE',
    items: [
      { to: '/student', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/student/notes', icon: BookOpen, label: 'AI Note Assistant' },
      { to: '/student/college-gpt', icon: GraduationCap, label: 'CollegeGPT' },
      { to: '/student/quizzes', icon: Brain, label: 'Quiz Engine' },
      { to: '/student/community', icon: MessageSquare, label: 'Doubt Community' },
      { to: '/student/schedule', icon: Calendar, label: 'Study Schedule' },
    ],
  },
  {
    group: 'PLACE MODE',
    items: [
      { to: '/student/resume', icon: FileText, label: 'Resume Builder' },
      { to: '/student/skill-gap', icon: Target, label: 'Skill Gap Analyzer' },
      { to: '/student/interview', icon: Mic, label: 'Mock Interview' },
      { to: '/student/confidence', icon: Video, label: 'Confidence Coach' },
      { to: '/student/jobs', icon: Briefcase, label: 'Job Tracker' },
      { to: '/student/placement-chat', icon: MessageCircle, label: 'Placement Chat' },
      { to: '/student/crash-mode', icon: AlertTriangle, label: 'Crash Mode' },
    ],
  },
  {
    group: 'PROFILE',
    items: [
      { to: '/student/skill-tree', icon: GitBranch, label: 'Skill Tree' },
      { to: '/student/leaderboard', icon: Trophy, label: 'Leaderboard' },
      { to: '/student/boss-battles', icon: Swords, label: 'Boss Battles' },
      { to: '/student/profile', icon: User, label: 'My Profile' },
    ],
  },
]

const teacherNav: NavSection[] = [
  {
    group: 'DASHBOARD',
    items: [
      { to: '/teacher', icon: LayoutDashboard, label: 'Overview', end: true },
      { to: '/teacher/subjects', icon: BookOpen, label: 'My Subjects' },
      { to: '/teacher/announcements', icon: Bell, label: 'Announcements' },
    ],
  },
  {
    group: 'CONTENT',
    items: [
      { to: '/teacher/documents', icon: Upload, label: 'Documents' },
      { to: '/teacher/quizzes', icon: ClipboardList, label: 'Quiz Management' },
      { to: '/teacher/quiz-scheduling', icon: Calendar, label: 'Quiz Scheduling' },
    ],
  },
  {
    group: 'ANALYTICS',
    items: [
      { to: '/teacher/analytics', icon: BarChart3, label: 'Class Performance' },
      { to: '/teacher/students', icon: Users, label: 'Student Details' },
      { to: '/teacher/similarity', icon: Shield, label: 'Similarity Checker' },
    ],
  },
  {
    group: 'INBOX',
    items: [
      { to: '/teacher/doubts', icon: MessageSquare, label: 'Direct Messages' },
    ],
  },
]

const adminNav: NavSection[] = [
  {
    group: 'DASHBOARD',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Overview', end: true },
      { to: '/admin/college-docs', icon: Upload, label: 'College Documents' },
      { to: '/admin/knowledge', icon: PenLine, label: 'Knowledge Editor' },
      { to: '/admin/users', icon: Users, label: 'User Management' },
    ],
  },
  {
    group: 'ANALYTICS',
    items: [
      { to: '/admin/skill-analytics', icon: BarChart3, label: 'Skill Analytics' },
      { to: '/admin/notifications', icon: Bell, label: 'Notification Status' },
    ],
  },
]

const navByRole: Record<Role, NavSection[]> = {
  student: studentNav,
  teacher: teacherNav,
  admin: adminNav,
}

export interface SidebarProps {
  role?: Role
  collapsed: boolean
  onToggle: () => void
  user?: { name?: string; email?: string }
}

export default function Sidebar({ role = 'student', collapsed, onToggle, user }: SidebarProps) {
  const navigation = navByRole[role] || studentNav
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-screen z-40',
        'flex flex-col transition-all duration-300',
        'bg-[var(--bg-sidebar)] border-r border-[var(--sidebar-border)]',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-[var(--sidebar-border)] shrink-0">
        <div className="h-8 w-8 rounded-lg bg-white flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-black" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight text-[var(--sidebar-text-active)]">CampusIQ</span>
        )}
        <button
          onClick={onToggle}
          className="ml-auto p-1 text-[var(--text-tertiary)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-hover)] rounded-md transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        {navigation.map((section) => (
          <div key={section.group}>
            {!collapsed && (
              <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)] px-2 mb-2">
                {section.group}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 rounded-lg transition-all duration-150',
                      collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
                      isActive
                        ? 'bg-[var(--sidebar-hover)] text-[var(--sidebar-text-active)] font-medium'
                        : 'text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-hover)]',
                    )
                  }
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && (
                    <span className="text-sm truncate">{item.label}</span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-[var(--sidebar-border)] p-2 space-y-1 shrink-0">
        <NavLink
          to={`/${role}/settings`}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg transition-colors',
              collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
              isActive
                ? 'bg-[var(--sidebar-hover)] text-[var(--sidebar-text-active)]'
                : 'text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-hover)]',
            )
          }
        >
          <Settings className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Settings</span>}
        </NavLink>

        <button
          onClick={handleLogout}
          className={clsx(
            'w-full flex items-center gap-3 rounded-lg transition-colors',
            collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
            'text-[var(--sidebar-text)] hover:text-[var(--sidebar-text-active)] hover:bg-[var(--sidebar-hover)]',
          )}
          title="Log out"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Log Out</span>}
        </button>

        <div className={clsx(
          'flex items-center gap-3 rounded-lg p-2',
          collapsed && 'justify-center',
        )}>
          <div className="h-7 w-7 rounded-full bg-[var(--sidebar-active)] text-[var(--sidebar-text)] font-semibold flex items-center justify-center shrink-0 text-xs">
            {(user?.name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--sidebar-text-active)] truncate">
                {user?.name || 'User'}
              </div>
              <div className="text-xs text-[var(--text-tertiary)] capitalize">{role}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
