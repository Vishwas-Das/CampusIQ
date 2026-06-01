import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  Upload, FileText, Trash2, Download, AlertCircle, Loader2, FolderOpen,
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, CardTitle, Select } from '../../components/ui'
import { documentsApi, subjectsApi, ApiError } from '../../api/client'
import type { DocumentProcessingStatus, DocumentWithSubject, Subject } from '../../types'

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const statusVariant: Record<DocumentProcessingStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  ready: 'success',
  processing: 'warning',
  failed: 'danger',
  pending: 'default',
}

const statusLabel: Record<DocumentProcessingStatus, string> = {
  ready: 'Ready',
  processing: 'Processing',
  failed: 'Failed',
  pending: 'Pending',
}

const ACCEPTED_EXTENSIONS = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md'

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DocumentsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [documents, setDocuments] = useState<DocumentWithSubject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filter, setFilter] = useState<string>('all')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [subjectsData, docsData] = await Promise.all([
        subjectsApi.list(),
        documentsApi.list(),
      ])
      setSubjects(subjectsData)
      setDocuments(docsData)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (typeof err.detail === 'string' ? err.detail : 'Failed to load documents')
          : 'Could not reach the server',
      )
    } finally {
      setLoading(false)
    }
  }

  // Light reload (no spinner) — used by the polling loop
  const refreshDocuments = async () => {
    try {
      const docsData = await documentsApi.list()
      setDocuments(docsData)
    } catch {
      // ignore polling errors
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  // Poll every 2s while any document is still processing
  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.processing_status === 'pending' || d.processing_status === 'processing',
    )
    if (!hasPending) return
    const interval = setInterval(() => void refreshDocuments(), 2000)
    return () => clearInterval(interval)
  }, [documents])

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setUploadError(null)

    // If no subject selected, require at least one subject to exist
    if (subjects.length === 0) {
      setUploadError('Create a subject first before uploading documents')
      e.target.value = ''
      return
    }

    // Use the filter as the target subject if it's a real subject; otherwise use the first
    const targetSubjectId =
      filter !== 'all' && subjects.some((s) => s.id === filter)
        ? filter
        : subjects[0]!.id

    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await documentsApi.upload({
          file,
          subjectId: targetSubjectId,
          title: file.name,
        })
      }
      await loadAll()
    } catch (err) {
      if (err instanceof ApiError) {
        setUploadError(typeof err.detail === 'string' ? err.detail : 'Upload failed')
      } else {
        setUploadError('Could not reach the server')
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (doc: DocumentWithSubject) => {
    const confirmed = window.confirm(`Delete "${doc.file_name}"?`)
    if (!confirmed) return

    setDeletingId(doc.id)
    try {
      await documentsApi.delete(doc.id)
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (err) {
      const msg = err instanceof ApiError && typeof err.detail === 'string'
        ? err.detail
        : 'Failed to delete document'
      window.alert(msg)
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = (doc: DocumentWithSubject) => {
    // Download endpoint requires auth — we open a fetch and trigger a blob download
    const token = localStorage.getItem('campusiq-auth')
    const authToken = token ? JSON.parse(token).state?.token : null
    if (!authToken) {
      window.alert('Not authenticated')
      return
    }
    fetch(documentsApi.downloadUrl(doc.id), {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = doc.file_name
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      })
      .catch(() => window.alert('Download failed'))
  }

  // Build select options from real subjects
  const subjectOptions = [
    { value: 'all', label: 'All Subjects' },
    ...subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  ]

  // Filter documents by selected subject
  const filteredDocs = filter === 'all'
    ? documents
    : documents.filter((d) => d.subject_id === filter)

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Upload Zone */}
      <motion.div variants={fadeUp}>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[var(--border-default)] rounded-xl p-8 text-center cursor-pointer hover:border-[var(--border-strong)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            multiple
            className="hidden"
            onChange={handleFileChange}
            disabled={uploading || subjects.length === 0}
          />
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-3 animate-spin" />
              <p className="text-sm font-medium text-[var(--text-primary)]">Uploading…</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-3" />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Drag and drop files or click to browse
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Supports PDF, DOCX, PPTX, TXT, MD · Max 25 MB
              </p>
              {subjects.length === 0 && !loading && (
                <p className="text-xs text-danger mt-2">Create a subject first to enable uploads</p>
              )}
            </>
          )}
        </div>
        {uploadError && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}
      </motion.div>

      {/* Filter */}
      {subjects.length > 0 && (
        <motion.div variants={fadeUp} className="w-80">
          <Select
            options={subjectOptions}
            value={filter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
            placeholder="Filter by subject"
          />
        </motion.div>
      )}

      {/* Error banner */}
      {error && (
        <motion.div variants={fadeUp} className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">{error}</div>
          <button onClick={() => void loadAll()} className="underline shrink-0">Retry</button>
        </motion.div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--text-tertiary)]">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">Loading documents…</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredDocs.length === 0 && (
        <motion.div variants={fadeUp}>
          <Card className="text-center py-16">
            <div className="h-12 w-12 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="h-6 w-6 text-[var(--text-tertiary)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
              {documents.length === 0 ? 'No documents yet' : 'No documents in this subject'}
            </h3>
            <p className="text-sm text-[var(--text-tertiary)] max-w-sm mx-auto">
              {subjects.length === 0
                ? 'Create a subject first, then upload your course materials.'
                : 'Upload your first document using the area above.'}
            </p>
          </Card>
        </motion.div>
      )}

      {/* Documents Table */}
      {!loading && !error && filteredDocs.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card padding={false}>
            <CardHeader className="px-4 pt-4">
              <CardTitle>
                Documents ({filteredDocs.length})
                {filteredDocs.some((d) => d.processing_status === 'processing' || d.processing_status === 'pending') && (
                  <span className="ml-2 text-xs font-normal text-[var(--text-tertiary)] inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    processing…
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-default)]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">File Name</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Subject</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Original</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Compressed</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Savings</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Chunks</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((doc) => {
                    const stats = doc.compression_stats
                    const hasStats = stats && stats.chunk_count > 0
                    return (
                      <tr
                        key={doc.id}
                        className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--bg-secondary)] transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium text-[var(--text-primary)] truncate" title={doc.title}>{doc.title}</div>
                              <div className="text-[11px] text-[var(--text-tertiary)]">
                                {formatDate(doc.created_at)} · {formatBytes(doc.file_size_bytes)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                          <span className="font-mono text-xs">{doc.subject_code}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariant[doc.processing_status]} size="sm" dot>
                            {statusLabel[doc.processing_status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums">
                          {hasStats ? formatBytes(stats.original_bytes) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums">
                          {hasStats ? formatBytes(stats.compressed_bytes) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-[var(--text-primary)] tabular-nums">
                          {hasStats ? `${stats.savings_percent.toFixed(1)}%` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--text-tertiary)] tabular-nums">
                          {hasStats ? stats.chunk_count : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={Download}
                              onClick={() => handleDownload(doc)}
                              title="Download"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={deletingId === doc.id ? Loader2 : Trash2}
                              disabled={deletingId === doc.id}
                              onClick={() => void handleDelete(doc)}
                              title="Delete"
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}
