import { useState, useCallback, useRef, useEffect } from 'react'
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'

/* ───────────────────── Types ───────────────────── */

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  navigateTo?: string
  count: number // how many duplicates collapsed into this toast
}

/* ───────────────────── useToast hook ───────────────────── */

const MAX_VISIBLE = 3
const DEDUP_WINDOW_MS = 10_000
const AUTO_DISMISS_MS = 6000

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const recentRef = useRef<Map<string, { id: string; time: number }>>(new Map())

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const addToast = useCallback(
    (message: string, type: ToastType = 'info', navigateTo?: string) => {
      // Deduplicate: if same message was shown within window, increment count
      const dedupeKey = `${type}:${message}`
      const recent = recentRef.current.get(dedupeKey)
      if (recent && Date.now() - recent.time < DEDUP_WINDOW_MS) {
        // Bump count on existing toast instead of adding new one
        setToasts((prev) =>
          prev.map((t) =>
            t.id === recent.id ? { ...t, count: t.count + 1 } : t
          )
        )
        recent.time = Date.now()
        return recent.id
      }

      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const toast: Toast = { id, message, type, navigateTo, count: 1 }

      setToasts((prev) => {
        const next = [...prev, toast]
        // Auto-dismiss oldest if over limit
        if (next.length > MAX_VISIBLE) {
          const oldest = next[0]
          const timer = timersRef.current.get(oldest.id)
          if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(oldest.id)
          }
          return next.slice(1)
        }
        return next
      })

      recentRef.current.set(dedupeKey, { id, time: Date.now() })

      const timer = setTimeout(() => {
        dismissToast(id)
        recentRef.current.delete(dedupeKey)
      }, AUTO_DISMISS_MS)
      timersRef.current.set(id, timer)

      return id
    },
    [dismissToast],
  )

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  return { toasts, addToast, dismissToast }
}

/* ───────────────────── Style maps ───────────────────── */

const typeStyles: Record<ToastType, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
}

const TypeIcon: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

/* ───────────────────── ToastContainer component ───────────────────── */

interface ToastContainerProps {
  toasts: Toast[]
  dismissToast: (id: string) => void
  onNavigate?: (path: string) => void
}

export function ToastContainer({ toasts, dismissToast, onNavigate }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = TypeIcon[toast.type]
        const hasNav = !!toast.navigateTo && !!onNavigate

        return (
          <div
            key={toast.id}
            role="alert"
            onClick={() => {
              if (hasNav) {
                onNavigate!(toast.navigateTo!)
                dismissToast(toast.id)
              }
            }}
            className={[
              'flex items-start gap-2 px-3 py-2.5 rounded border backdrop-blur-sm shadow-lg',
              'font-pixel text-[9px] tracking-wider leading-relaxed',
              'transition-all duration-300 ease-out',
              typeStyles[toast.type],
              hasNav ? 'cursor-pointer hover:brightness-125' : '',
            ].join(' ')}
          >
            <Icon size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1 break-words">
              {toast.message}
              {toast.count > 1 && (
                <span className="ml-1 opacity-60">(+{toast.count - 1} more)</span>
              )}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                dismissToast(toast.id)
              }}
              className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
