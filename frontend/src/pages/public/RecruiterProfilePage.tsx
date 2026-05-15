import '../marketing/landing.css'

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Award,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  Flame,
  GraduationCap,
  type LucideIcon,
  MessageCircle,
  Share2,
  Sparkles,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react'
import { ApiError, publicProfileApi } from '../../api/client'
import type { PublicProfileResponse } from '../../types/gamification'
import MarketingButton from '../marketing/components/MarketingButton'
import { Mark } from '../marketing/components/MarketingNav'

const fade = {
  initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
}

const TIER_ACCENT: Record<string, { bg: string; text: string; ring: string }> = {
  diamond: { bg: 'rgba(125,211,252,0.18)', text: '#7DD3FC', ring: 'rgba(125,211,252,0.5)' },
  platinum: { bg: 'rgba(226,232,240,0.18)', text: '#E2E8F0', ring: 'rgba(226,232,240,0.5)' },
  gold: { bg: 'rgba(217,170,76,0.20)', text: '#F5C56A', ring: 'rgba(217,170,76,0.55)' },
  silver: { bg: 'rgba(165,180,200,0.18)', text: '#C7D2DD', ring: 'rgba(165,180,200,0.5)' },
  bronze: { bg: 'rgba(217,119,67,0.16)', text: '#E9A77B', ring: 'rgba(217,119,67,0.5)' },
}

// Quick lookup for the lucide icon names returned by the backend badge catalog.
const BADGE_ICONS: Record<string, LucideIcon> = {
  CheckCircle2,
  Flame,
  MessageCircle,
  Swords,
  Award,
  Zap,
  Trophy,
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?'
}

function Pillar({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: number
  emphasis?: boolean
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: emphasis ? 'var(--landing-fg)' : 'var(--landing-fg-muted)',
          marginBottom: 6,
        }}
      >
        <span>{label}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}</span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: emphasis
              ? 'linear-gradient(90deg, #A78BFA, #22D3EE)'
              : 'linear-gradient(90deg, rgba(167,139,250,0.7), rgba(34,211,238,0.7))',
            boxShadow: emphasis ? '0 0 18px rgba(167,139,250,0.45)' : 'none',
            transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
          }}
        />
      </div>
    </div>
  )
}

export default function RecruiterProfilePage() {
  const { studentId } = useParams<{ studentId: string }>()
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!studentId) {
      setError('Missing profile id.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    publicProfileApi
      .get(studentId)
      .then((data) => {
        if (!cancelled) setProfile(data)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setError("That profile doesn't exist or isn't public.")
        } else {
          setError('Could not load this profile right now.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  const onCopyShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard may be blocked in non-https contexts; fall back to selection
      setCopied(false)
    }
  }

  return (
    <div className="landing-theme">
      <div
        style={{
          minHeight: '100vh',
          // Tighter horizontal padding on narrow viewports so QR-scanned
          // phone visits don't waste a third of the screen on margins.
          padding: 'clamp(28px, 5vw, 48px) clamp(14px, 4vw, 24px) 80px',
          position: 'relative',
        }}
      >
        <span
          aria-hidden
          className="halo"
          style={{
            width: 520,
            height: 520,
            background: 'radial-gradient(circle, rgba(139,92,246,0.40), transparent 60%)',
            top: '-160px',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        />

        <div style={{ maxWidth: 1040, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          {/* Top bar with brand mark + share button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 36,
            }}
          >
            <Link
              to="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <Mark size={26} />
              <span
                className="display"
                style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}
              >
                CampusIQ
              </span>
            </Link>

            {profile && (
              <MarketingButton
                size="md"
                variant="secondary"
                icon={Share2}
                onClick={onCopyShare}
              >
                {copied ? 'Link copied' : 'Copy share link'}
              </MarketingButton>
            )}
          </div>

          {loading && (
            <div
              className="glass"
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--landing-fg-muted)',
              }}
            >
              Loading profile…
            </div>
          )}

          {error && !loading && (
            <div
              className="glass"
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--landing-fg-muted)',
              }}
            >
              <p style={{ fontSize: 16, margin: '0 0 16px', color: 'var(--landing-fg)' }}>
                {error}
              </p>
              <Link to="/" style={{ textDecoration: 'none' }}>
                <MarketingButton size="md" variant="secondary">
                  Back to CampusIQ
                </MarketingButton>
              </Link>
            </div>
          )}

          {profile && !loading && !error && (
            <ProfileBody profile={profile} />
          )}

          {/* Footer */}
          <p
            style={{
              textAlign: 'center',
              marginTop: 56,
              fontSize: 12,
              color: 'var(--landing-fg-faint)',
              letterSpacing: '0.08em',
            }}
          >
            Generated by CampusIQ — built for engineering students at RVCE.
          </p>
        </div>
      </div>
    </div>
  )
}

function ProfileBody({ profile }: { profile: PublicProfileResponse }) {
  const tier = TIER_ACCENT[profile.tier] ?? TIER_ACCENT.bronze
  const initials = initialsFromName(profile.name)
  const memberSince = new Date(profile.member_since)
  const memberSinceLabel = memberSince.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const profileDetails: { label: string; value: string }[] = []
  if (profile.branch) profileDetails.push({ label: 'Branch', value: profile.branch })
  if (profile.semester) profileDetails.push({ label: 'Semester', value: `${profile.semester}` })
  if (profile.cgpa !== null && profile.cgpa !== undefined) {
    profileDetails.push({ label: 'CGPA', value: profile.cgpa.toFixed(2) })
  }
  profileDetails.push({ label: 'Member since', value: memberSinceLabel })

  return (
    <>
      {/* Hero card */}
      <motion.section
        {...fade}
        className="glass-strong"
        style={{
          padding: 'clamp(24px, 4vw, 40px)',
          borderRadius: 'var(--landing-radius-lg)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <span
          aria-hidden
          className="halo"
          style={{
            width: 320,
            height: 320,
            background: 'radial-gradient(circle, rgba(34,211,238,0.30), transparent 60%)',
            bottom: '-80px',
            right: '-80px',
          }}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              flexWrap: 'wrap',
            }}
          >
            {/* Avatar with initials */}
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle at 30% 30%, rgba(167,139,250,0.55), transparent 70%), radial-gradient(circle at 70% 70%, rgba(34,211,238,0.45), transparent 70%), #0F1116',
                border: '1px solid var(--landing-border-strong)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 24,
                fontWeight: 600,
                color: 'var(--landing-fg)',
                flexShrink: 0,
              }}
            >
              {initials}
            </div>

            <div style={{ flex: 1, minWidth: 220 }}>
              <span className="eyebrow">Public profile</span>
              <h1
                className="display"
                style={{
                  fontSize: 'clamp(28px, 4vw, 44px)',
                  margin: '6px 0 8px',
                }}
              >
                {profile.name}
              </h1>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <span
                  className="chip"
                  style={{
                    background: tier.bg,
                    borderColor: tier.ring,
                    color: tier.text,
                  }}
                >
                  <Trophy size={12} strokeWidth={2.5} />
                  {profile.tier.toUpperCase()} TIER
                </span>
                {profile.rank !== null && profile.rank !== undefined && (
                  <span className="chip">
                    <Sparkles size={12} strokeWidth={2.5} />
                    Rank #{profile.rank}
                  </span>
                )}
                <span className="chip">
                  <GraduationCap size={12} strokeWidth={2.5} />
                  Level {profile.current_level} · {profile.xp_total.toLocaleString()} XP
                </span>
              </div>
            </div>
          </div>

          {/* Hero stat: total CampusIQ score */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            <div
              className="glass"
              style={{
                padding: 20,
                background:
                  'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(34,211,238,0.10) 100%)',
              }}
            >
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                CampusIQ Score
              </div>
              <div
                className="display"
                style={{ fontSize: 'clamp(40px, 6vw, 56px)', lineHeight: 1 }}
              >
                <span className="gradient-text">
                  {profile.campus_iq_score.toFixed(1)}
                </span>
                <span
                  style={{
                    fontSize: 16,
                    color: 'var(--landing-fg-muted)',
                    marginLeft: 8,
                    fontWeight: 400,
                  }}
                >
                  / 100
                </span>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--landing-fg-muted)',
                  marginTop: 10,
                  marginBottom: 0,
                  lineHeight: 1.5,
                }}
              >
                Composite of academic, skill, interview, and placement readiness.
              </p>
            </div>

            <div
              className="glass"
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                justifyContent: 'center',
              }}
            >
              <Pillar label="Academic" value={profile.academic_pillar} emphasis />
              <Pillar label="Skill" value={profile.skill_pillar} />
              <Pillar label="Interview" value={profile.interview_pillar} />
              <Pillar label="Placement" value={profile.placement_pillar} />
            </div>
          </div>

          {/* Profile detail strip */}
          {profileDetails.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {profileDetails.map((d) => (
                <div
                  key={d.label}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid var(--landing-border)',
                    background: 'rgba(255,255,255,0.025)',
                  }}
                >
                  <div className="eyebrow" style={{ marginBottom: 4 }}>
                    {d.label}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--landing-fg)' }}>{d.value}</div>
                </div>
              ))}
            </div>
          )}

          {(profile.github_url || profile.linkedin_url) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {profile.github_url && (
                <ExternalLinkChip href={profile.github_url} label="GitHub" />
              )}
              {profile.linkedin_url && (
                <ExternalLinkChip href={profile.linkedin_url} label="LinkedIn" />
              )}
            </div>
          )}
        </div>
      </motion.section>

      {/* Skills + targets row */}
      <motion.section
        {...fade}
        transition={{ ...fade.transition, delay: 0.1 }}
        style={{
          marginTop: 24,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        <DetailCard title="Skills" empty={profile.skills.length === 0 && 'No skills declared yet.'}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {profile.skills.map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
          </div>
        </DetailCard>

        <DetailCard
          title="Targets"
          empty={
            !profile.target_role && profile.target_companies.length === 0
              ? 'No placement targets set.'
              : null
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {profile.target_role && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 14,
                  color: 'var(--landing-fg)',
                }}
              >
                <Briefcase size={14} strokeWidth={2.25} />
                Aiming for: <span className="gradient-text">{profile.target_role}</span>
              </div>
            )}
            {profile.target_companies.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {profile.target_companies.map((c) => (
                  <span key={c} className="chip chip-accent">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </DetailCard>
      </motion.section>

      {/* Badges */}
      <motion.section
        {...fade}
        transition={{ ...fade.transition, delay: 0.18 }}
        style={{ marginTop: 24 }}
      >
        <DetailCard
          title="Badges"
          subtitle={`${profile.badges.length} earned`}
          empty={profile.badges.length === 0 ? 'No badges earned yet.' : null}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {profile.badges.map((b) => {
              const Icon = (b.icon && BADGE_ICONS[b.icon]) || Award
              return (
                <div
                  key={b.id}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: '1px solid var(--landing-border)',
                    background: 'rgba(255,255,255,0.025)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background:
                        'linear-gradient(135deg, rgba(167,139,250,0.20), rgba(34,211,238,0.14))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--landing-violet-soft)',
                    }}
                  >
                    <Icon size={18} strokeWidth={2} />
                  </div>
                  <div
                    className="display"
                    style={{ fontSize: 14, fontWeight: 600, color: 'var(--landing-fg)' }}
                  >
                    {b.name}
                  </div>
                  {b.description && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--landing-fg-muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      {b.description}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </DetailCard>
      </motion.section>
    </>
  )
}

function DetailCard({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string
  subtitle?: string
  empty?: string | null | false
  children: React.ReactNode
}) {
  return (
    <div
      className="glass"
      style={{
        padding: 'clamp(20px, 3vw, 28px)',
        borderRadius: 'var(--landing-radius-md)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
        }}
      >
        <h2
          className="display"
          style={{ fontSize: 18, fontWeight: 600, margin: 0 }}
        >
          {title}
        </h2>
        {subtitle && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--landing-fg-muted)',
              letterSpacing: '0.08em',
            }}
          >
            {subtitle}
          </span>
        )}
      </div>
      {empty ? (
        <p
          style={{
            color: 'var(--landing-fg-muted)',
            fontSize: 13,
            margin: 0,
          }}
        >
          {empty}
        </p>
      ) : (
        children
      )}
    </div>
  )
}

function ExternalLinkChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="chip"
      style={{
        textDecoration: 'none',
        color: 'var(--landing-fg)',
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <ExternalLink size={12} strokeWidth={2.25} />
      {label}
    </a>
  )
}
