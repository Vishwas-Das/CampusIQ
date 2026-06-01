import { useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  Award,
  AlertCircle,
  CheckCircle2,
  Edit,
  ExternalLink,
  Flame,
  Loader2,
  MessageCircle,
  Share2,
  Swords,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import type { BadgeVariant } from '../../components/ui/Badge'
import Avatar from '../../components/ui/Avatar'
import Button from '../../components/ui/Button'
import ProgressBar from '../../components/ui/ProgressBar'
import type { ProgressBarColor } from '../../components/ui/ProgressBar'
import Modal from '../../components/ui/Modal'
import Input from '../../components/ui/Input'
import TextArea from '../../components/ui/TextArea'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, gamificationApi } from '../../api/client'
import type { PublicProfileResponse, Tier } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const TIER_META: Record<Tier, { label: string; variant: BadgeVariant }> = {
  diamond: { label: 'Diamond', variant: 'info' },
  platinum: { label: 'Platinum', variant: 'success' },
  gold: { label: 'Gold', variant: 'warning' },
  silver: { label: 'Silver', variant: 'default' },
  bronze: { label: 'Bronze', variant: 'default' },
}

const BADGE_ICONS: Record<string, LucideIcon> = {
  CheckCircle2,
  Flame,
  MessageCircle,
  Swords,
  Award,
  Zap,
}

interface Pillar {
  label: string
  value: number
  color: ProgressBarColor
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  // Edit form state
  const [editBranch, setEditBranch] = useState('')
  const [editSemester, setEditSemester] = useState<string>('')
  const [editCgpa, setEditCgpa] = useState<string>('')
  const [editGithub, setEditGithub] = useState('')
  const [editLinkedin, setEditLinkedin] = useState('')
  const [editSkills, setEditSkills] = useState('')
  const [editTargetCompanies, setEditTargetCompanies] = useState('')
  const [editTargetRole, setEditTargetRole] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    try {
      const p = await gamificationApi.myProfile()
      setProfile(p)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load profile',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const openEdit = () => {
    if (!profile) return
    setEditBranch(profile.branch ?? '')
    setEditSemester(profile.semester != null ? String(profile.semester) : '')
    setEditCgpa(profile.cgpa != null ? String(profile.cgpa) : '')
    setEditGithub(profile.github_url ?? '')
    setEditLinkedin(profile.linkedin_url ?? '')
    setEditSkills(profile.skills.join(', '))
    setEditTargetCompanies(profile.target_companies.join(', '))
    setEditTargetRole(profile.target_role ?? '')
    setEditOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await gamificationApi.updateProfile({
        branch: editBranch || null,
        semester: editSemester ? parseInt(editSemester, 10) : null,
        cgpa: editCgpa ? parseFloat(editCgpa) : null,
        github_url: editGithub || null,
        linkedin_url: editLinkedin || null,
        skills: editSkills.split(',').map((s) => s.trim()).filter(Boolean),
        target_companies: editTargetCompanies.split(',').map((s) => s.trim()).filter(Boolean),
        target_role: editTargetRole || null,
      })
      setProfile(updated)
      setEditOpen(false)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to save profile',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-2 justify-center py-10 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading profile…
      </Card>
    )
  }

  if (error || !profile) {
    return (
      <Card className="flex items-start gap-2 text-danger py-4">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-sm">{error ?? 'No profile data'}</span>
      </Card>
    )
  }

  const pillars: Pillar[] = [
    { label: 'Academic', value: profile.academic_pillar, color: 'primary' },
    { label: 'Skills', value: profile.skill_pillar, color: 'purple' },
    { label: 'Interview', value: profile.interview_pillar, color: 'warning' },
    { label: 'Placement', value: profile.placement_pillar, color: 'success' },
  ]

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Header */}
      <motion.div variants={fadeUp}>
        <Card>
          <div className="flex items-center gap-5">
            <Avatar name={profile.name} size="xl" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-[var(--text-primary)]">{profile.name}</h1>
                <Badge variant={TIER_META[profile.tier].variant} size="sm">
                  {TIER_META[profile.tier].label}
                </Badge>
                {profile.rank != null && <Badge size="sm">#{profile.rank}</Badge>}
              </div>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                {profile.branch && profile.semester
                  ? `${profile.branch} · Semester ${profile.semester}`
                  : 'Student'}
                {profile.cgpa != null && ` · CGPA ${profile.cgpa.toFixed(1)}`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" icon={Edit} size="sm" onClick={openEdit}>
                Edit
              </Button>
              <Button
                variant="secondary"
                icon={Share2}
                size="sm"
                onClick={async () => {
                  const url = `${window.location.origin}/p/${profile.user_id}`
                  try {
                    await navigator.clipboard.writeText(url)
                    setShareCopied(true)
                    setTimeout(() => setShareCopied(false), 1800)
                  } catch {
                    // clipboard may be blocked in non-https; fall back to prompt
                    window.prompt('Copy your share link:', url)
                  }
                }}
              >
                {shareCopied ? 'Link copied' : 'Share'}
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Stat cards */}
      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-4">
        <StatCard label="CAMPUSIQ SCORE" value={profile.campus_iq_score.toFixed(0)} icon={Award} />
        <StatCard label="TOTAL XP" value={profile.xp_total.toLocaleString()} icon={Zap} />
        <StatCard label="LEVEL" value={String(profile.current_level)} icon={Flame} />
        <StatCard label="STREAK" value={`${profile.streak_days}d`} icon={Flame} />
      </motion.div>

      {/* Score breakdown */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>CampusIQ Score Breakdown</CardTitle>
            <span className="text-xs text-[var(--text-tertiary)]">
              4-pillar weighted composition (DMS III)
            </span>
          </CardHeader>
          <div className="space-y-3">
            {pillars.map((p) => (
              <ProgressBar
                key={p.label}
                label={p.label}
                value={p.value}
                max={100}
                showValue
                color={p.color}
                size="md"
              />
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--border-default)] text-center">
            <span className="stat-value text-3xl">{profile.campus_iq_score.toFixed(0)}</span>
            <span className="text-[var(--text-tertiary)] text-sm"> / 100</span>
          </div>
        </Card>
      </motion.div>

      {/* Badges */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Badges ({profile.badges.length})</CardTitle>
          </CardHeader>
          {profile.badges.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
              No badges yet. Take quizzes, finish mock interviews, and push your CampusIQ score
              past 75 to unlock them.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {profile.badges.map((badge) => {
                const Icon = BADGE_ICONS[badge.icon ?? ''] ?? Award
                return (
                  <div
                    key={badge.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {badge.name}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)] truncate">
                        {badge.description}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </motion.div>

      {/* Skills */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          {profile.skills.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">
              No skills added yet. Click Edit to declare your skills.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {profile.skills.map((skill) => (
                <Badge key={skill} variant="primary" size="sm">
                  {skill}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </motion.div>

      {/* Targets + links */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Placement Targets</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {profile.target_role && (
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                  Target Role
                </p>
                <p className="text-sm text-[var(--text-primary)]">{profile.target_role}</p>
              </div>
            )}
            {profile.target_companies.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                  Target Companies
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.target_companies.map((c) => (
                    <Badge key={c} size="sm">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {(profile.github_url || profile.linkedin_url) && (
              <div className="flex flex-wrap gap-3 text-sm pt-1">
                {profile.github_url && (
                  <a
                    href={profile.github_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    GitHub
                  </a>
                )}
                {profile.linkedin_url && (
                  <a
                    href={profile.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    LinkedIn
                  </a>
                )}
              </div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Edit profile modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Edit Profile" size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Branch"
              placeholder="CS"
              value={editBranch}
              onChange={(e) => setEditBranch(e.target.value)}
            />
            <Input
              label="Semester"
              type="number"
              min={1}
              max={12}
              value={editSemester}
              onChange={(e) => setEditSemester(e.target.value)}
            />
          </div>
          <Input
            label="CGPA"
            type="number"
            step="0.01"
            min={0}
            max={10}
            value={editCgpa}
            onChange={(e) => setEditCgpa(e.target.value)}
          />
          <Input
            label="GitHub URL"
            placeholder="https://github.com/..."
            value={editGithub}
            onChange={(e) => setEditGithub(e.target.value)}
          />
          <Input
            label="LinkedIn URL"
            placeholder="https://linkedin.com/in/..."
            value={editLinkedin}
            onChange={(e) => setEditLinkedin(e.target.value)}
          />
          <TextArea
            label="Skills (comma-separated)"
            placeholder="Python, React, SQL, Git"
            rows={2}
            value={editSkills}
            onChange={(e) => setEditSkills(e.target.value)}
          />
          <TextArea
            label="Target Companies (comma-separated)"
            placeholder="Google, Amazon, Flipkart"
            rows={2}
            value={editTargetCompanies}
            onChange={(e) => setEditTargetCompanies(e.target.value)}
          />
          <Input
            label="Target Role"
            placeholder="SWE / SDE / ML Engineer"
            value={editTargetRole}
            onChange={(e) => setEditTargetRole(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
