import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  message: string
  kind: 'info' | 'error'
}

interface ToastApi {
  show: (message: string, kind?: 'info' | 'error') => void
}

const ToastContext = createContext<ToastApi>({ show: () => undefined })
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = nextId++
    setItems((list) => [...list, { id, message, kind }])
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), 4500)
  }, [])

  const api = useMemo(() => ({ show }), [show])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
