import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { AlertCircle, Edit, Loader2, Megaphone, Trash2 } from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import TextArea from '../../components/ui/TextArea'
import Select from '../../components/ui/Select'
import { ApiError, announcementsApi, subjectsApi } from '../../api/client'
import type { Announcement, AnnouncementTarget, Subject } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<AnnouncementTarget>('all')
  const [subjectId, setSubjectId] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, s] = await Promise.all([
        announcementsApi.list({ onlyMine: true }),
        subjectsApi.list(),
      ])
      setItems(a)
      setSubjects(s)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load announcements',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const targetOptions = useMemo(
    () => [
      { value: 'all', label: 'All Students' },
      { value: 'college', label: 'My College' },
      ...(subjects.length > 0 ? [{ value: 'subject', label: 'Specific Subject' }] : []),
    ],
    [subjects],
  )

  const subjectOptions = useMemo(
    () => [
      { value: '', label: 'Select a subject…' },
      ...subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    ],
    [subjects],
  )

  const resetForm = () => {
    setEditingId(null)
    setTitle('')
    setBody('')
    setTarget('all')
    setSubjectId('')
  }

  const handleSubmit = async () => {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required')
      return
    }
    if (target === 'subject' && !subjectId) {
      setError('Pick a subject for subject-targeted announcements')
      return
    }
    setPosting(true)
    setError(null)
    try {
      if (editingId) {
        await announcementsApi.update(editingId, { title: title.trim(), body: body.trim() })
      } else {
        await announcementsApi.create({
          title: title.trim(),
          body: body.trim(),
          target,
          subject_id: target === 'subject' ? subjectId : null,
        })
      }
      resetForm()
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Post failed',
      )
    } finally {
      setPosting(false)
    }
  }

  const handleEdit = (item: Announcement) => {
    setEditingId(item.id)
    setTitle(item.title)
    setBody(item.body)
    setTarget(item.target)
    setSubjectId(item.subject_id ?? '')
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this announcement?')) return
    try {
      await announcementsApi.delete(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Delete failed',
      )
    }
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Announcements</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Post updates and notices for your students
          </p>
        </div>
      </motion.div>

      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-[var(--text-secondary)]" />
              <CardTitle>{editingId ? 'Edit Announcement' : 'New Announcement'}</CardTitle>
            </div>
          </CardHeader>
          <div className="space-y-4">
            <Input
              label="Title"
              placeholder="Enter announcement title…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <TextArea
              label="Body"
              placeholder="Write your announcement here…"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-48">
                <Select
                  label="Target"
                  options={targetOptions}
                  value={target}
                  onChange={(e) => setTarget(e.target.value as AnnouncementTarget)}
                  disabled={editingId !== null}
                />
              </div>
              {target === 'subject' && (
                <div className="w-72">
                  <Select
                    label="Subject"
                    options={subjectOptions}
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    disabled={editingId !== null}
                  />
                </div>
              )}
              <Button icon={Megaphone} disabled={posting} onClick={() => void handleSubmit()}>
                {posting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    {editingId ? 'Saving…' : 'Posting…'}
                  </>
                ) : editingId ? (
                  'Save changes'
                ) : (
                  'Post Announcement'
                )}
              </Button>
              {editingId && (
                <Button variant="secondary" onClick={resetForm} disabled={posting}>
                  Cancel edit
                </Button>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      <div className="border-t border-[var(--border-default)]" />

      <motion.div variants={fadeUp}>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
          Posted Announcements
        </h2>
      </motion.div>

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-6 text-[var(--text-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </Card>
      )}

      {!loading && items.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
            You haven't posted any announcements yet. Create one above to notify your students.
          </p>
        </Card>
      )}

      {!loading &&
        items.map((ann, i) => (
          <motion.div
            key={ann.id}
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05, duration: 0.3 }}
          >
            <Card>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-[var(--text-primary)]">{ann.title}</h3>
                    <Badge variant="default" size="sm">
                      {ann.target === 'subject'
                        ? ann.subject_code ?? 'Subject'
                        : ann.target === 'college'
                          ? 'College'
                          : 'All Students'}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] whitespace-pre-line">
                    {ann.body}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-2">
                    {formatDate(ann.created_at)}
                    {ann.author_name && <> · by {ann.author_name}</>}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" icon={Edit} onClick={() => handleEdit(ann)} />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() => void handleDelete(ann.id)}
                  />
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
    </motion.div>
  )
}
