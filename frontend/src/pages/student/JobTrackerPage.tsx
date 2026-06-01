import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  Bookmark,
  Calendar,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import Card, { CardLabel } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import type { BadgeVariant } from '../../components/ui/Badge'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import TextArea from '../../components/ui/TextArea'
import { ApiError, jobsApi } from '../../api/client'
import type {
  ApplicationStatus,
  JobApplicationResponse,
  JobBoardResponse,
  JobListingResponse,
  JobType,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const COLUMNS: { status: ApplicationStatus; title: string }[] = [
  { status: 'saved', title: 'Saved' },
  { status: 'applied', title: 'Applied' },
  { status: 'oa_received', title: 'OA Received' },
  { status: 'interview_scheduled', title: 'Interview' },
  { status: 'offer_received', title: 'Offer' },
  { status: 'rejected', title: 'Rejected' },
]

const JOB_TYPE_LABEL: Record<JobType, string> = {
  full_time: 'Full-time',
  internship: 'Internship',
  contract: 'Contract',
  part_time: 'Part-time',
}

function getFitVariant(fit: number | null | undefined): BadgeVariant {
  if (fit == null) return 'default'
  if (fit >= 80) return 'success'
  if (fit >= 60) return 'warning'
  return 'default'
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export default function JobTrackerPage() {
  const [listings, setListings] = useState<JobListingResponse[]>([])
  const [board, setBoard] = useState<JobBoardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const [addOpen, setAddOpen] = useState(false)

  // Add listing form
  const [newTitle, setNewTitle] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [newType, setNewType] = useState<JobType>('full_time')
  const [newDescription, setNewDescription] = useState('')
  const [newRequirements, setNewRequirements] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      // Ensure we have sample data on first load
      const [listingsData, boardData] = await Promise.all([
        jobsApi.list(),
        jobsApi.myBoard(),
      ])
      if (listingsData.length === 0) {
        await jobsApi.seed().catch(() => {})
        const [seededListings, seededBoard] = await Promise.all([
          jobsApi.list(),
          jobsApi.myBoard(),
        ])
        setListings(seededListings)
        setBoard(seededBoard)
      } else {
        setListings(listingsData)
        setBoard(boardData)
      }
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load jobs',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const appliedJobIds = useMemo(() => {
    if (!board) return new Set<string>()
    const all = [
      ...board.saved,
      ...board.applied,
      ...board.oa_received,
      ...board.interview_scheduled,
      ...board.offer_received,
      ...board.rejected,
    ]
    return new Set(all.map((a) => a.job_listing_id))
  }, [board])

  const filteredListings = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return listings
    return listings.filter(
      (l) =>
        l.title.toLowerCase().includes(needle) ||
        l.company_name.toLowerCase().includes(needle) ||
        (l.location || '').toLowerCase().includes(needle),
    )
  }, [listings, search])

  const handleSave = async (listing: JobListingResponse) => {
    try {
      await jobsApi.saveApplication({
        job_listing_id: listing.id,
        status: 'saved',
      })
      const board = await jobsApi.myBoard()
      setBoard(board)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to save application',
      )
    }
  }

  const handleMove = async (application: JobApplicationResponse, status: ApplicationStatus) => {
    try {
      await jobsApi.updateApplication(application.id, { status })
      const board = await jobsApi.myBoard()
      setBoard(board)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to move application',
      )
    }
  }

  const handleDelete = async (applicationId: string) => {
    if (!window.confirm('Remove this application from your board?')) return
    try {
      await jobsApi.deleteApplication(applicationId)
      const board = await jobsApi.myBoard()
      setBoard(board)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to remove application',
      )
    }
  }

  const handleCreate = async () => {
    if (!newTitle.trim() || !newCompany.trim()) {
      setError('Title and company are required')
      return
    }
    setCreating(true)
    try {
      await jobsApi.create({
        title: newTitle.trim(),
        company_name: newCompany.trim(),
        location: newLocation || null,
        job_type: newType,
        description: newDescription || null,
        requirements: newRequirements || null,
      })
      setAddOpen(false)
      setNewTitle('')
      setNewCompany('')
      setNewLocation('')
      setNewType('full_time')
      setNewDescription('')
      setNewRequirements('')
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not create listing',
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <motion.div className="space-y-4" variants={stagger} initial="initial" animate="animate">
      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <Button icon={Plus} onClick={() => setAddOpen(true)}>
          Add Listing
        </Button>
        <div className="w-72">
          <Input
            icon={Search}
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {loading && (
          <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </span>
        )}
      </motion.div>

      {/* Available listings strip */}
      {!loading && filteredListings.length > 0 && (
        <motion.div variants={fadeUp} className="space-y-2">
          <CardLabel>Available Listings</CardLabel>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {filteredListings.map((listing) => {
              const alreadyApplied = appliedJobIds.has(listing.id)
              return (
                <Card key={listing.id} hover className="w-64 shrink-0">
                  <div className="flex items-start justify-between mb-1">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-[var(--text-primary)] truncate">
                        {listing.company_name}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)] truncate">
                        {listing.title}
                      </p>
                    </div>
                    <Badge variant={getFitVariant(listing.fit_score)} size="sm">
                      {listing.fit_score != null ? `${listing.fit_score.toFixed(0)}%` : '—'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1 mb-2">
                    <Badge size="sm">{JOB_TYPE_LABEL[listing.job_type]}</Badge>
                    {listing.location && (
                      <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                        <MapPin className="h-3 w-3" />
                        {listing.location}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={alreadyApplied ? 'secondary' : 'primary'}
                    icon={Bookmark}
                    className="w-full"
                    onClick={() => void handleSave(listing)}
                    disabled={alreadyApplied}
                  >
                    {alreadyApplied ? 'In board' : 'Save to board'}
                  </Button>
                </Card>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Kanban board */}
      {board && (
        <motion.div
          variants={fadeUp}
          className="flex gap-4 overflow-x-auto pb-4"
          style={{ minHeight: 'calc(100vh - 22rem)' }}
        >
          {COLUMNS.map((col) => {
            const cards = board[col.status]
            return (
              <div key={col.status} className="w-64 shrink-0 flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <CardLabel>{col.title}</CardLabel>
                  <Badge size="sm">{cards.length}</Badge>
                </div>
                <div className="space-y-3 flex-1">
                  {cards.length === 0 && (
                    <div className="text-xs text-[var(--text-tertiary)] italic px-2">
                      No applications
                    </div>
                  )}
                  {cards.map((app) => (
                    <Card key={app.id} hover className="cursor-pointer group">
                      <div className="flex items-start justify-between mb-1.5">
                        <p className="font-semibold text-sm text-[var(--text-primary)] truncate">
                          {app.job.company_name}
                        </p>
                        <button
                          onClick={() => void handleDelete(app.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-tertiary)] hover:text-danger"
                          title="Remove"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mb-2 truncate">
                        {app.job.title}
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={getFitVariant(app.fit_score)} size="sm">
                          {app.fit_score != null ? `${app.fit_score.toFixed(0)}%` : '—'}
                        </Badge>
                        <Badge size="sm">{JOB_TYPE_LABEL[app.job.job_type]}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)] mb-2">
                        {app.job.location && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="h-3 w-3" />
                            {app.job.location}
                          </span>
                        )}
                        {app.job.application_deadline && (
                          <span className="flex items-center gap-0.5">
                            <Calendar className="h-3 w-3" />
                            {formatDate(app.job.application_deadline)}
                          </span>
                        )}
                      </div>
                      <Select
                        options={COLUMNS.map((c) => ({ value: c.status, label: c.title }))}
                        value={app.status}
                        onChange={(e) =>
                          void handleMove(app, e.target.value as ApplicationStatus)
                        }
                        className="!py-1 text-xs"
                      />
                    </Card>
                  ))}
                </div>
              </div>
            )
          })}
        </motion.div>
      )}

      {/* Add listing modal */}
      <Modal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Job Listing"
        size="md"
      >
        <div className="space-y-3">
          <Input label="Title" placeholder="e.g. SWE Intern" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <Input label="Company" placeholder="e.g. Flipkart" value={newCompany} onChange={(e) => setNewCompany(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Location" placeholder="e.g. Bangalore" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} />
            <Select
              label="Type"
              options={[
                { value: 'full_time', label: 'Full-time' },
                { value: 'internship', label: 'Internship' },
                { value: 'contract', label: 'Contract' },
                { value: 'part_time', label: 'Part-time' },
              ]}
              value={newType}
              onChange={(e) => setNewType(e.target.value as JobType)}
            />
          </div>
          <TextArea
            label="Description"
            placeholder="What's the role about?"
            rows={3}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
          />
          <TextArea
            label="Requirements"
            placeholder="Skills, experience, tech stack — used to compute your fit score"
            rows={3}
            value={newRequirements}
            onChange={(e) => setNewRequirements(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating || !newTitle.trim() || !newCompany.trim()}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create listing'
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
