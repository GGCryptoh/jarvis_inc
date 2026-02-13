import { useState, useCallback, useRef, useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

/* ───────────────────── Types ───────────────────── */

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  navigateTo?: string
}

/* ───────────────────── useToast hook ───────────────────── */

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const toast: Toast = { id, message, type, navigateTo }
      setToasts((prev) => [...prev, toast])

      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => {
        dismissToast(id)
      }, 8000)
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
  info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
}

const TypeIcon: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
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
            <span className="flex-1 break-words">{toast.message}</span>
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
