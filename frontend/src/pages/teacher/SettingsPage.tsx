import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  BellRing,
  Briefcase,
  Check,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Shield,
  Sparkles,
  Sun,
  Trash2,
  User as UserIcon,
  type LucideIcon,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { useAuthStore } from '../../store/authStore'
import { useTheme } from '../../hooks/useTheme'
import type { Theme } from '../../types'
import { ApiError, authApi } from '../../api/client'

type SectionKey =
  | 'account'
  | 'profile'
  | 'notifications'
  | 'appearance'
  | 'privacy'
  | 'danger'

interface SectionDef {
  key: SectionKey
  label: string
  description: string
  icon: LucideIcon
}

const SECTIONS: SectionDef[] = [
  { key: 'account', label: 'Account', description: 'Your name, email, and password.', icon: UserIcon },
  { key: 'profile', label: 'Teacher profile', description: 'Department and designation.', icon: Briefcase },
  { key: 'notifications', label: 'Notifications', description: 'How and when CampusIQ pings you.', icon: BellRing },
  { key: 'appearance', label: 'Appearance', description: 'Theme and visual preferences.', icon: Palette },
  { key: 'privacy', label: 'Privacy', description: 'What students can see about you.', icon: Shield },
  { key: 'danger', label: 'Danger zone', description: 'Permanent destructive actions.', icon: AlertTriangle },
]

export default function SettingsPage() {
  const [active, setActive] = useState<SectionKey>('account')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Settings</h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Manage how CampusIQ works for you.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <Card padding={false} className="overflow-hidden self-start">
          <nav className="flex md:flex-col">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const isActive = active === s.key
              const isDanger = s.key === 'danger'
              return (
                <button
                  key={s.key}
                  onClick={() => setActive(s.key)}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors w-full',
                    'border-l-2 md:border-l-2 border-l-transparent',
                    isActive
                      ? isDanger
                        ? 'bg-danger/10 text-danger border-l-danger'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-l-primary'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
                  )}
                >
                  <Icon className={clsx('h-4 w-4 shrink-0', isDanger && 'text-danger')} />
                  <span className="font-medium">{s.label}</span>
                </button>
              )
            })}
          </nav>
        </Card>

        <div className="min-w-0">
          <SectionPanel section={SECTIONS.find((s) => s.key === active)!} />
        </div>
      </div>
    </div>
  )
}

function SectionPanel({ section }: { section: SectionDef }) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{section.label}</h2>
        <p className="text-sm text-[var(--text-tertiary)]">{section.description}</p>
      </div>
      <div className="h-px bg-[var(--border-subtle)]" />
      {section.key === 'account' && <AccountSection />}
      {section.key === 'profile' && <TeacherProfileSection />}
      {section.key === 'notifications' && <NotificationsSection />}
      {section.key === 'appearance' && <AppearanceSection />}
      {section.key === 'privacy' && <PrivacySection />}
      {section.key === 'danger' && <DangerSection />}
    </Card>
  )
}

// 1. Account
function AccountSection() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [showLogoutModal, setShowLogoutModal] = useState(false)

  const [pwdCurrent, setPwdCurrent] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdSaved, setPwdSaved] = useState(false)
  const [pwdSaving, setPwdSaving] = useState(false)

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdError(null)
    setPwdSaved(false)
    if (pwdNew.length < 8) {
      setPwdError('New password must be at least 8 characters.')
      return
    }
    if (pwdNew !== pwdConfirm) {
      setPwdError('New passwords do not match.')
      return
    }
    setPwdSaving(true)
    try {
      await authApi.changePassword({ current_password: pwdCurrent, new_password: pwdNew })
      setPwdSaved(true)
      setPwdCurrent('')
      setPwdNew('')
      setPwdConfirm('')
    } catch (err) {
      setPwdError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not update password.',
      )
    } finally {
      setPwdSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Profile</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Full name" value={user?.full_name ?? ''} readOnly />
          <Input label="Email" value={user?.email ?? ''} readOnly />
          <Input label="Role" value={user?.role ?? ''} readOnly />
          <Input
            label="Joined"
            value={user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
            readOnly
          />
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          To change your name or email, contact your college admin.
        </p>
      </div>

      <div className="h-px bg-[var(--border-subtle)]" />

      <form onSubmit={handlePasswordSubmit} className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Change password</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            type="password"
            label="Current password"
            icon={Lock}
            value={pwdCurrent}
            onChange={(e) => setPwdCurrent(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            type="password"
            label="New password"
            icon={Lock}
            value={pwdNew}
            onChange={(e) => setPwdNew(e.target.value)}
            autoComplete="new-password"
          />
          <Input
            type="password"
            label="Confirm new password"
            icon={Lock}
            value={pwdConfirm}
            onChange={(e) => setPwdConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {pwdError && <p className="text-xs text-danger">{pwdError}</p>}
        {pwdSaved && (
          <p className="text-xs text-success flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" /> Password updated.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={pwdSaving} disabled={!pwdCurrent || !pwdNew || !pwdConfirm}>
            Update password
          </Button>
        </div>
      </form>

      <div className="h-px bg-[var(--border-subtle)]" />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Session</h3>
        <p className="text-xs text-[var(--text-tertiary)]">
          Sign out of CampusIQ on this device.
        </p>
        <Button variant="secondary" icon={LogOut} onClick={() => setShowLogoutModal(true)}>
          Log out
        </Button>
      </div>

      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="Log out?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowLogoutModal(false)}>
              Stay signed in
            </Button>
            <Button
              variant="danger"
              icon={LogOut}
              onClick={() => {
                logout()
                navigate('/login', { replace: true })
              }}
            >
              Yes, log out
            </Button>
          </div>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          You'll need to sign in again next time.
        </p>
      </Modal>
    </div>
  )
}

// 2. Teacher profile
function TeacherProfileSection() {
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const tp = user?.teacher_profile

  const [department, setDepartment] = useState(tp?.department_name ?? '')
  const [designation, setDesignation] = useState(tp?.designation ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const updated = await authApi.updateTeacherProfile({
        department_name: department || null,
        designation: designation || null,
      })
      updateUser(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not save profile.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (user?.role !== 'teacher') {
    return (
      <p className="text-sm text-[var(--text-tertiary)]">
        Teacher profile is for teacher accounts.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Department"
          placeholder="Computer Science & Engineering"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
        <Input
          label="Designation"
          placeholder="Assistant Professor"
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
        />
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">
        Shown on your profile to students and on the college teacher directory.
      </p>

      {error && <p className="text-xs text-danger">{error}</p>}
      {saved && (
        <p className="text-xs text-success flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5" /> Profile saved.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>Save changes</Button>
      </div>
    </form>
  )
}

// 3. Notifications
interface NotificationPrefs {
  emailWeeklyClassReport: boolean
  emailLowEngagement: boolean
  emailNewDoubts: boolean
  pushQuizCompleted: boolean
  pushAnnouncementReply: boolean
  pushAttendance: boolean
  inAppEverything: boolean
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  emailWeeklyClassReport: true,
  emailLowEngagement: true,
  emailNewDoubts: false,
  pushQuizCompleted: true,
  pushAnnouncementReply: true,
  pushAttendance: false,
  inAppEverything: true,
}

const NOTIFICATION_STORAGE_KEY = 'campusiq.teacher-notification-prefs'

function readNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY)
    if (!raw) return DEFAULT_NOTIFICATION_PREFS
    return { ...DEFAULT_NOTIFICATION_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) }
  } catch {
    return DEFAULT_NOTIFICATION_PREFS
  }
}

function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(readNotificationPrefs)
  const [saved, setSaved] = useState(false)

  const update = <K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [key]: value }
      localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  const groups: { title: string; items: { key: keyof NotificationPrefs; label: string; hint: string }[] }[] = [
    {
      title: 'Email',
      items: [
        { key: 'emailWeeklyClassReport', label: 'Weekly class report', hint: 'Monday digest of class average, top weak topics, attempts.' },
        { key: 'emailLowEngagement', label: 'Low engagement alerts', hint: 'When a student has not attempted a quiz in 7+ days.' },
        { key: 'emailNewDoubts', label: 'New doubts posted', hint: 'When a student posts a doubt under your subject.' },
      ],
    },
    {
      title: 'Push',
      items: [
        { key: 'pushQuizCompleted', label: 'Quiz attempt completed', hint: 'When a student finishes one of your quizzes.' },
        { key: 'pushAnnouncementReply', label: 'Announcement replies', hint: 'When students reply to your announcements.' },
        { key: 'pushAttendance', label: 'Attendance alerts', hint: 'Notifications about class attendance patterns.' },
      ],
    },
    {
      title: 'In-app',
      items: [
        { key: 'inAppEverything', label: 'Show all events', hint: 'Real-time updates inside CampusIQ.' },
      ],
    },
  ]

  return (
    <div className="space-y-6">
      <p className="text-xs text-[var(--text-tertiary)]">
        Choices save to your browser instantly. Backend delivery hooks land in a later phase.
      </p>
      {groups.map((g) => (
        <div key={g.title} className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{g.title}</h3>
          <div className="space-y-2">
            {g.items.map((item) => (
              <ToggleRow
                key={item.key}
                label={item.label}
                hint={item.hint}
                checked={prefs[item.key]}
                onChange={(v) => update(item.key, v)}
              />
            ))}
          </div>
        </div>
      ))}
      {saved && (
        <p className="text-xs text-success flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5" /> Saved.
        </p>
      )}
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-3 p-3 rounded-md border border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative shrink-0 h-6 w-11 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-[var(--border-default)]',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </label>
  )
}

// 4. Appearance
const THEME_DESCRIPTIONS: Record<Theme, { description: string; icon: LucideIcon }> = {
  system: { description: 'Follow your OS setting.', icon: Monitor },
  nebula: { description: 'Signature deep-navy theme.', icon: Sparkles },
  light: { description: 'Clean light surface.', icon: Sun },
  dark: { description: 'Easy on the eyes at night.', icon: Moon },
}

function AppearanceSection() {
  const { theme, setTheme, themes, meta } = useTheme()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Theme</h3>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
          Applies instantly across the entire app. Saved to this browser.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {themes.map((value) => {
          const { description, icon: Icon } = THEME_DESCRIPTIONS[value]
          const isActive = theme === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={clsx(
                'flex flex-col items-start gap-1.5 p-3 rounded-md border text-left transition-colors',
                isActive
                  ? 'border-primary bg-primary/5'
                  : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]',
              )}
            >
              <div className="flex items-center justify-between w-full">
                <Icon className={clsx('h-4 w-4', isActive ? 'text-primary' : 'text-[var(--text-secondary)]')} />
                {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{meta[value].label}</p>
              <p className="text-xs text-[var(--text-tertiary)]">{description}</p>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">
        Tip: the icon button at the top-right of the page also cycles through these themes.
      </p>
    </div>
  )
}

// 5. Privacy
interface PrivacyPrefs {
  showEmailToStudents: boolean
  showInDirectory: boolean
  allowStudentMessages: boolean
  showAnalyticsToCollege: boolean
}

const DEFAULT_PRIVACY: PrivacyPrefs = {
  showEmailToStudents: false,
  showInDirectory: true,
  allowStudentMessages: true,
  showAnalyticsToCollege: true,
}

const PRIVACY_STORAGE_KEY = 'campusiq.teacher-privacy-prefs'

function readPrivacyPrefs(): PrivacyPrefs {
  try {
    const raw = localStorage.getItem(PRIVACY_STORAGE_KEY)
    if (!raw) return DEFAULT_PRIVACY
    return { ...DEFAULT_PRIVACY, ...(JSON.parse(raw) as Partial<PrivacyPrefs>) }
  } catch {
    return DEFAULT_PRIVACY
  }
}

function PrivacySection() {
  const [prefs, setPrefs] = useState<PrivacyPrefs>(readPrivacyPrefs)
  const [saved, setSaved] = useState(false)

  const update = <K extends keyof PrivacyPrefs>(key: K, value: PrivacyPrefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [key]: value }
      localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-tertiary)]">
        Control what students and your college can see about you.
      </p>
      <ToggleRow
        label="Show email to students"
        hint="Students enrolled in your subjects can see your email address."
        checked={prefs.showEmailToStudents}
        onChange={(v) => update('showEmailToStudents', v)}
      />
      <ToggleRow
        label="Appear in teacher directory"
        hint="Listed on your college's public CampusIQ teacher directory."
        checked={prefs.showInDirectory}
        onChange={(v) => update('showInDirectory', v)}
      />
      <ToggleRow
        label="Allow direct messages from students"
        hint="Students can send you in-app questions outside of doubts."
        checked={prefs.allowStudentMessages}
        onChange={(v) => update('allowStudentMessages', v)}
      />
      <ToggleRow
        label="Share class analytics with college admin"
        hint="Admin can view your class average and engagement metrics."
        checked={prefs.showAnalyticsToCollege}
        onChange={(v) => update('showAnalyticsToCollege', v)}
      />
      {saved && (
        <p className="text-xs text-success flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5" /> Saved.
        </p>
      )}
    </div>
  )
}

// 6. Danger zone
function DangerSection() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requiredText = 'DELETE'
  const canConfirm = confirmText === requiredText

  const handleDelete = async () => {
    setError(null)
    setDeleting(true)
    try {
      await authApi.deleteAccount()
      logout()
      navigate('/login', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not delete account.',
      )
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-md border border-danger/30 bg-danger/5 space-y-1">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-danger" />
          <span className="text-sm font-semibold text-danger">Delete account</span>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Permanently remove your CampusIQ teacher account, your quizzes, your
          announcements, and your class history. This cannot be undone.
        </p>
      </div>

      <Button variant="danger" icon={Trash2} onClick={() => setShowConfirm(true)}>
        Delete my account
      </Button>

      <Modal
        isOpen={showConfirm}
        onClose={() => {
          setShowConfirm(false)
          setConfirmText('')
          setError(null)
        }}
        title="Delete account?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={deleting ? undefined : Trash2}
              loading={deleting}
              disabled={!canConfirm || deleting}
              onClick={handleDelete}
            >
              Permanently delete
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--text-secondary)]">
            This will delete everything tied to your teacher account — quizzes
            you authored, announcements, scheduled exams, and analytics.
            Students who attempted your quizzes will keep their scores but
            those quizzes will be unavailable. There is no undo.
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            Type <Badge variant="danger">{requiredText}</Badge> below to confirm.
          </p>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={requiredText}
            autoFocus
          />
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </Modal>
    </div>
  )
}
