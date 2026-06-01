import { useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import { Bell, CheckCircle2, XCircle, Info, Clock } from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import StatCard from '../../components/dashboard/StatCard'

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

type NotificationStatus = 'Acked' | 'Sent' | 'Failed'
type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

interface NotificationRecord {
  type: string
  recipient: string
  status: NotificationStatus
  retries: number
  lastSent: string
  ackedAt: string
}

const notifications: NotificationRecord[] = [
  { type: 'Quiz Result', recipient: 'Rahul Verma', status: 'Acked', retries: 0, lastSent: 'Apr 5, 2:30 PM', ackedAt: 'Apr 5, 2:30 PM' },
  { type: 'Score Update', recipient: 'Priya Sharma', status: 'Acked', retries: 0, lastSent: 'Apr 5, 1:15 PM', ackedAt: 'Apr 5, 1:16 PM' },
  { type: 'Deadline Reminder', recipient: 'Karthik Nair', status: 'Sent', retries: 0, lastSent: 'Apr 5, 3:00 PM', ackedAt: '-' },
  { type: 'Interview Feedback', recipient: 'Sneha Gupta', status: 'Acked', retries: 1, lastSent: 'Apr 5, 11:00 AM', ackedAt: 'Apr 5, 11:02 AM' },
  { type: 'Quiz Result', recipient: 'Vikram Reddy', status: 'Failed', retries: 3, lastSent: 'Apr 4, 9:00 PM', ackedAt: '-' },
  { type: 'Score Update', recipient: 'Meera Patel', status: 'Sent', retries: 0, lastSent: 'Apr 5, 3:10 PM', ackedAt: '-' },
  { type: 'Deadline Reminder', recipient: 'Arjun Singh', status: 'Failed', retries: 3, lastSent: 'Apr 4, 6:00 PM', ackedAt: '-' },
  { type: 'Interview Feedback', recipient: 'Divya Iyer', status: 'Acked', retries: 0, lastSent: 'Apr 5, 10:45 AM', ackedAt: 'Apr 5, 10:45 AM' },
]

function getStatusVariant(status: NotificationStatus): BadgeVariant {
  if (status === 'Acked') return 'success'
  if (status === 'Failed') return 'danger'
  return 'default'
}

type FilterType = 'All' | 'Pending' | 'Failed'

const filters: FilterType[] = ['All', 'Pending', 'Failed']

export default function NotificationStatusPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('All')

  const filtered = notifications.filter((n) => {
    if (activeFilter === 'All') return true
    if (activeFilter === 'Pending') return n.status === 'Sent'
    if (activeFilter === 'Failed') return n.status === 'Failed'
    return true
  })

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Notification Status</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">Monitor TCP-style reliable notification delivery</p>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
        <StatCard label="DELIVERY RATE" value="97.2%" icon={CheckCircle2} trend={1.5} />
        <StatCard label="PENDING" value="12" icon={Clock} />
        <StatCard label="FAILED" value="3" icon={XCircle} />
      </motion.div>

      {/* Status Filter */}
      <motion.div variants={fadeUp} className="flex gap-1 p-1 rounded-lg bg-[var(--bg-tertiary)] w-fit">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-md transition-all duration-200',
              activeFilter === f
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            {f}
          </button>
        ))}
      </motion.div>

      {/* Notification Table */}
      <motion.div variants={fadeUp}>
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">Recipient</th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">Retries</th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">Last Sent</th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">Acked At</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n, i) => (
                  <motion.tr
                    key={`${n.recipient}-${n.type}`}
                    className="border-b border-[var(--border-default)] last:border-b-0"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 + i * 0.04 }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Bell className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-primary)] font-medium">{n.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{n.recipient}</td>
                    <td className="px-4 py-3">
                      <Badge variant={getStatusVariant(n.status)} size="sm" dot>{n.status}</Badge>
                    </td>
                    <td className={clsx(
                      'px-4 py-3 font-medium',
                      n.retries >= 3 ? 'text-danger' : 'text-[var(--text-secondary)]'
                    )}>
                      {n.retries}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{n.lastSent}</td>
                    <td className="px-4 py-3 text-[var(--text-tertiary)]">{n.ackedAt}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>

      {/* How it works */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-[var(--text-secondary)]" />
              <CardTitle>How TCP-Style Delivery Works</CardTitle>
            </div>
          </CardHeader>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Each notification gets a sequence number. The client sends an ACK on receipt. The server retries
            with exponential backoff (1s, 2s, 4s, 8s) up to 3 times. If no ACK is received after all retries,
            the notification is marked as Failed and an admin is alerted.
          </p>
        </Card>
      </motion.div>
    </motion.div>
  )
}
