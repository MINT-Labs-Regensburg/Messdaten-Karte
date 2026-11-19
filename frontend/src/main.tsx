import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/figtree'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './i18n'
import './styles/base.css'
import './styles/app.css'
import './styles/map.css'
import App from './App'
import { ApiError } from './api/client'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/Toast'
import { ThemeProvider } from './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Client-Fehler (4xx) wiederholen nichts; Netzwerkfehler höchstens zweimal
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
})

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
