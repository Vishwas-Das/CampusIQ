import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import ProgressBar from '../../components/ui/ProgressBar'
import { ApiError, collegeDocumentsApi } from '../../api/client'
import type { CollegeDocument, CollegeDocumentCategory } from '../../types'

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const categoryOptions: { value: CollegeDocumentCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All Categories' },
  { value: 'handbook', label: 'Handbook' },
  { value: 'timetable', label: 'Timetable' },
  { value: 'placement_record', label: 'Placement Record' },
  { value: 'faculty_list', label: 'Faculty List' },
  { value: 'hostel_rules', label: 'Hostel Rules' },
  { value: 'other', label: 'Other' },
]

const uploadCategoryOptions = categoryOptions.filter((o) => o.value !== 'all')

const categoryVariant: Record<CollegeDocumentCategory, BadgeVariant> = {
  handbook: 'primary',
  timetable: 'info',
  placement_record: 'success',
  faculty_list: 'warning',
  hostel_rules: 'danger',
  other: 'default',
}

const categoryLabel: Record<CollegeDocumentCategory, string> = {
  handbook: 'Handbook',
  timetable: 'Timetable',
  placement_record: 'Placement Record',
  faculty_list: 'Faculty List',
  hostel_rules: 'Hostel Rules',
  other: 'Other',
}

const statusVariant: Record<string, BadgeVariant> = {
  ready: 'success',
  processing: 'warning',
  pending: 'info',
  failed: 'danger',
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

export default function CollegeDocsPage() {
  const [documents, setDocuments] = useState<CollegeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CollegeDocumentCategory | 'all'>('all')
  const [uploadCategory, setUploadCategory] =
    useState<CollegeDocumentCategory>('handbook')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await collegeDocumentsApi.list()
      setDocuments(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load college documents',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // Background poll while any document is processing
  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.processing_status === 'pending' || d.processing_status === 'processing',
    )
    if (!hasPending) return
    const id = setInterval(() => void refresh(), 3000)
    return () => clearInterval(id)
  }, [documents])

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      await collegeDocumentsApi.upload({
        file,
        documentCategory: uploadCategory,
      })
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Upload failed',
      )
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this college document? This cannot be undone.')) return
    try {
      await collegeDocumentsApi.delete(id)
      setDocuments((prev) => prev.filter((d) => d.id !== id))
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Delete failed',
      )
    }
  }

  const handleReprocess = async (id: string) => {
    try {
      await collegeDocumentsApi.reprocess(id)
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Reprocess failed',
      )
    }
  }

  const visibleDocs = useMemo(() => {
    if (categoryFilter === 'all') return documents
    return documents.filter((d) => d.document_category === categoryFilter)
  }, [documents, categoryFilter])

  const totals = useMemo(() => {
    let original = 0
    let compressed = 0
    for (const d of documents) {
      if (d.compression_stats) {
        original += d.compression_stats.original_bytes
        compressed += d.compression_stats.compressed_bytes
      }
    }
    const savings =
      original > 0 ? Math.round((1 - compressed / original) * 1000) / 10 : 0
    return { original, compressed, savings }
  }, [documents])

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {/* Upload Zone */}
      <motion.div variants={fadeUp} className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            Upload as:
          </span>
          <div className="w-56">
            <Select
              options={uploadCategoryOptions}
              value={uploadCategory}
              onChange={(e) =>
                setUploadCategory(e.target.value as CollegeDocumentCategory)
              }
            />
          </div>
        </div>

        <label
          htmlFor="college-doc-upload"
          className="block border-2 border-dashed border-[var(--border-default)] rounded-xl p-8 text-center cursor-pointer hover:border-[var(--border-strong)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.pptx,.ppt"
            className="hidden"
            id="college-doc-upload"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleUpload(file)
            }}
          />
          {uploading ? (
            <Loader2 className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-3 animate-spin" />
          ) : (
            <Upload className="h-8 w-8 text-[var(--text-tertiary)] mx-auto mb-3" />
          )}
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {uploading ? 'Uploading…' : 'Click to upload a college document'}
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            PDF, DOCX, TXT, MD, PPTX — uploaded as <strong>{categoryLabel[uploadCategory]}</strong>
          </p>
        </label>
      </motion.div>

      {/* Category Filter */}
      <motion.div variants={fadeUp} className="w-64">
        <Select
          options={categoryOptions}
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as CollegeDocumentCategory | 'all')
          }
        />
      </motion.div>

      {/* Documents Table */}
      <motion.div variants={fadeUp}>
        <Card padding={false}>
          <CardHeader className="px-4 pt-4">
            <CardTitle>College Documents</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    File Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    Uploaded
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    Chunks
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    Original
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    Saved
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-tertiary)]">
                      <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && visibleDocs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[var(--text-tertiary)]">
                      No college documents yet. Upload one above to get started.
                    </td>
                  </tr>
                )}
                {visibleDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--text-primary)] truncate">
                            {doc.title}
                          </div>
                          <div className="text-[10px] text-[var(--text-tertiary)] truncate">
                            {doc.file_name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={categoryVariant[doc.document_category]} size="sm">
                        {categoryLabel[doc.document_category]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={statusVariant[doc.processing_status] || 'default'}
                        size="sm"
                        dot
                      >
                        {doc.processing_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums">
                      {doc.compression_stats?.chunk_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums">
                      {formatBytes(doc.compression_stats?.original_bytes)}
                    </td>
                    <td className="px-4 py-3 text-right text-success tabular-nums">
                      {doc.compression_stats?.savings_percent
                        ? `${doc.compression_stats.savings_percent}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={RefreshCw}
                          onClick={() => void handleReprocess(doc.id)}
                          title="Reprocess"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Eye}
                          title="View summary"
                          disabled={!doc.summary}
                          onClick={() => doc.summary && window.alert(doc.summary)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Trash2}
                          onClick={() => void handleDelete(doc.id)}
                          title="Delete"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>

      {/* Total Storage Savings */}
      {totals.original > 0 && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Total Storage Savings (Huffman, F19)</CardTitle>
            </CardHeader>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Original Size</span>
                <span className="font-medium text-[var(--text-primary)] tabular-nums">
                  {formatBytes(totals.original)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">Compressed Size</span>
                <span className="font-medium text-[var(--text-primary)] tabular-nums">
                  {formatBytes(totals.compressed)}
                </span>
              </div>
              <ProgressBar
                value={totals.savings}
                max={100}
                label="Compression Savings"
                showValue={false}
                color="success"
                size="lg"
              />
              <div className="text-center">
                <span className="text-2xl font-bold text-success">{totals.savings}%</span>
                <span className="text-sm text-[var(--text-tertiary)] ml-2">
                  space saved via Huffman compression
                </span>
              </div>
            </div>
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}
