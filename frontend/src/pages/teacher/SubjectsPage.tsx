import { useEffect, useState, type FormEvent } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  Plus, ChevronRight, FileText, Brain, AlertCircle, Loader2, Trash2, BookOpen,
} from 'lucide-react'
import { Button, Card, Badge, Input, Modal, TextArea } from '../../components/ui'
import { subjectsApi, ApiError } from '../../api/client'
import type { Subject, SubjectCreate } from '../../types'

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

interface CreateFormState {
  code: string
  name: string
  description: string
  semester: string
  branch: string
}

const emptyForm: CreateFormState = {
  code: '',
  name: '',
  description: '',
  semester: '',
  branch: '',
}

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateFormState>(emptyForm)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadSubjects = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await subjectsApi.list()
      setSubjects(data)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (typeof err.detail === 'string' ? err.detail : 'Failed to load subjects')
          : 'Could not reach the server',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSubjects()
  }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setCreateError(null)
    setCreateOpen(true)
  }

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setCreateError(null)

    if (!form.code.trim() || !form.name.trim()) {
      setCreateError('Code and name are required')
      return
    }

    const payload: SubjectCreate = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
    }
    if (form.description.trim()) payload.description = form.description.trim()
    if (form.semester) payload.semester = parseInt(form.semester, 10)
    if (form.branch.trim()) payload.branch = form.branch.trim()

    setCreating(true)
    try {
      const newSubject = await subjectsApi.create(payload)
      setSubjects((prev) => [newSubject, ...prev])
      setCreateOpen(false)
      setForm(emptyForm)
    } catch (err) {
      if (err instanceof ApiError) {
        let detail: unknown = err.detail
        if (Array.isArray(detail)) detail = detail[0]?.msg ?? 'Invalid input'
        setCreateError(typeof detail === 'string' ? detail : 'Failed to create subject')
      } else {
        setCreateError('Could not reach the server')
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (subject: Subject) => {
    const confirmed = window.confirm(
      `Delete "${subject.name}"?\n\nThis will also delete all documents and quizzes in this subject.`,
    )
    if (!confirmed) return

    setDeletingId(subject.id)
    try {
      await subjectsApi.delete(subject.id)
      setSubjects((prev) => prev.filter((s) => s.id !== subject.id))
    } catch (err) {
      const msg = err instanceof ApiError && typeof err.detail === 'string'
        ? err.detail
        : 'Failed to delete subject'
      window.alert(msg)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">My Subjects</h2>
          <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
            {loading ? 'Loading…' : `${subjects.length} subject${subjects.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Button icon={Plus} onClick={openCreate}>Create Subject</Button>
      </motion.div>

      {/* Error banner */}
      {error && (
        <motion.div variants={fadeUp} className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{error}</div>
          <button onClick={() => void loadSubjects()} className="underline shrink-0">Retry</button>
        </motion.div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--text-tertiary)]">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Loading subjects…</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && subjects.length === 0 && (
        <motion.div variants={fadeUp}>
          <Card className="text-center py-16">
            <div className="h-12 w-12 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] flex items-center justify-center mx-auto mb-4">
              <BookOpen className="h-6 w-6 text-[var(--text-tertiary)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">No subjects yet</h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4 max-w-sm mx-auto">
              Create your first subject to start uploading documents and generating quizzes.
            </p>
            <Button icon={Plus} onClick={openCreate}>Create Subject</Button>
          </Card>
        </motion.div>
      )}

      {/* Subject grid */}
      {!loading && !error && subjects.length > 0 && (
        <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {subjects.map((subject, i) => (
            <motion.div
              key={subject.id}
              initial={{ opacity: 1, y: 0, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.05 + i * 0.04, duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <Card hover className="group relative">
                <div className="flex items-start justify-between mb-2">
                  <Badge variant="primary" size="sm">{subject.code}</Badge>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleDelete(subject)}
                      disabled={deletingId === subject.id}
                      className="p-1 text-[var(--text-tertiary)] hover:text-danger rounded transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                      title="Delete subject"
                    >
                      {deletingId === subject.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                    <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <h3 className="font-semibold text-[var(--text-primary)] text-sm mb-1">{subject.name}</h3>
                {subject.description && (
                  <p className="text-xs text-[var(--text-tertiary)] line-clamp-2 mb-3">{subject.description}</p>
                )}
                {(subject.semester || subject.branch) && (
                  <div className="flex items-center gap-2 mb-3 text-[11px] text-[var(--text-tertiary)]">
                    {subject.branch && <span>{subject.branch}</span>}
                    {subject.semester && <span>Sem {subject.semester}</span>}
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {subject.document_count} docs
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Brain className="h-3 w-3" />
                    {subject.quiz_count} quizzes
                  </span>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Create Subject Modal */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Create Subject">
        <form onSubmit={handleCreate} className="space-y-4">
          {createError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{createError}</span>
            </div>
          )}
          <Input
            label="SUBJECT CODE"
            placeholder="e.g. CS341"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
            disabled={creating}
            autoFocus
          />
          <Input
            label="SUBJECT NAME"
            placeholder="e.g. Design and Analysis of Algorithms"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            disabled={creating}
          />
          <TextArea
            label="DESCRIPTION (OPTIONAL)"
            placeholder="What does this course cover?"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            disabled={creating}
            rows={2}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="SEMESTER"
              type="number"
              min="1"
              max="8"
              placeholder="4"
              value={form.semester}
              onChange={(e) => setForm({ ...form, semester: e.target.value })}
              disabled={creating}
            />
            <Input
              label="BRANCH"
              placeholder="CSE"
              value={form.branch}
              onChange={(e) => setForm({ ...form, branch: e.target.value })}
              disabled={creating}
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" loading={creating}>
              {creating ? 'Creating…' : 'Create Subject'}
            </Button>
          </div>
        </form>
      </Modal>
    </motion.div>
  )
}
