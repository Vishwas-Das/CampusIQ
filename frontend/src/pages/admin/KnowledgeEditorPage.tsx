/**
 * Admin Knowledge Editor — one place to update facts across all
 * college documents without re-uploading PDFs.
 *
 * Three surfaces, top to bottom:
 *   1. QuickUpdateBar — type "lab attendance is 75%" → AI finds the
 *      right chunk → review diff → Apply.
 *   2. ChunkEditorList — left-rail category browser + right-pane
 *      editable chunk cards for the selected document.
 *   3. KnowledgeChatDrawer (floating button) — multi-turn chat that
 *      proposes structured edits; each edit has an Apply button.
 *
 * All three converge on the same chunk-CRUD endpoints. The page does
 * not regenerate the original PDF; chunks are canonical for retrieval.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { AlertCircle, MessageSquare } from 'lucide-react'
import QuickUpdateBar from '../../components/admin/QuickUpdateBar'
import ChunkEditorList from '../../components/admin/ChunkEditorList'
import KnowledgeChatDrawer from '../../components/admin/KnowledgeChatDrawer'
import Button from '../../components/ui/Button'
import { ApiError, collegeDocumentsApi } from '../../api/client'
import { useNotificationStore } from '../../store/notificationStore'
import type { CollegeDocument } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

export default function KnowledgeEditorPage() {
  const [documents, setDocuments] = useState<CollegeDocument[]>([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  // Bumped whenever an edit is applied externally — ChunkEditorList watches
  // this so it can refetch the affected doc's chunks.
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshDocumentId, setRefreshDocumentId] = useState<string | null>(null)

  const pushToast = useNotificationStore((s) => s.push)

  const showToast = useCallback(
    (title: string, body: string, isError = false) => {
      pushToast({
        id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: isError ? 'system' : 'announcement',
        title,
        content: body,
      })
    },
    [pushToast],
  )

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true)
    setDocsError(null)
    try {
      const docs = await collegeDocumentsApi.list()
      setDocuments(docs)
    } catch (err) {
      setDocsError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load college documents',
      )
    } finally {
      setLoadingDocs(false)
    }
  }, [])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  const handleApplied = useCallback((docId: string) => {
    setRefreshDocumentId(docId)
    setRefreshKey((k) => k + 1)
  }, [])

  const handleReprocess = useCallback(
    async (docId: string) => {
      try {
        await collegeDocumentsApi.reprocess(docId)
        showToast(
          'Reprocessing started',
          'CollegeGPT will reflect the rebuilt chunks once processing completes.',
        )
        // Give the backend a moment to flip to "processing" status,
        // then refetch the doc list + chunks.
        setTimeout(() => {
          void loadDocuments()
          setRefreshDocumentId(docId)
          setRefreshKey((k) => k + 1)
        }, 600)
      } catch (err) {
        const detail =
          err instanceof ApiError && typeof err.detail === 'string'
            ? err.detail
            : 'Could not start reprocessing.'
        showToast('Reprocess failed', detail, true)
      }
    },
    [loadDocuments, showToast],
  )

  return (
    <motion.div
      className="space-y-4 relative"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      <motion.div variants={fadeUp} className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Knowledge Editor
          </h2>
          <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
            Update facts across handbooks, timetables, hostel rules,
            placement records, and more — no PDF re-upload required.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={MessageSquare}
          onClick={() => setChatOpen(true)}
        >
          Knowledge Assistant
        </Button>
      </motion.div>

      {docsError && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{docsError}</span>
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <QuickUpdateBar
          allDocuments={documents}
          onApplied={handleApplied}
          pushToast={showToast}
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        {loadingDocs ? (
          <div
            className="rounded-card border p-12 text-center text-sm text-[var(--text-tertiary)]"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-default)',
            }}
          >
            Loading documents…
          </div>
        ) : (
          <ChunkEditorList
            documents={documents}
            pushToast={showToast}
            refreshKey={refreshKey}
            refreshDocumentId={refreshDocumentId}
            onReprocess={handleReprocess}
          />
        )}
      </motion.div>

      <KnowledgeChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        documents={documents}
        onApplied={handleApplied}
        pushToast={showToast}
      />
    </motion.div>
  )
}
