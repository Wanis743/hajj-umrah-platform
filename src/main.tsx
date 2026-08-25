import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App.tsx';
import './index.css';
import { I18nProvider } from '@/i18n/I18nProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { RouterProvider } from '@/router/RouterProvider';
import { AuthProvider } from '@/lib/auth';
import { ConfirmProvider } from '@/components/ConfirmDialog';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <AuthProvider>
          <ConfirmProvider>
            <RouterProvider>
              <App />
            </RouterProvider>
            {/* Mounts the ONLY toast viewport in the app — react-hot-toast
                calls used to be fire-and-forget with no renderer attached. */}
            <Toaster
              position="bottom-right"
              gutter={8}
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#1c1f2b',
                  color: '#f4f4f5',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '10px',
                  fontSize: '13px',
                  boxShadow: '0 12px 32px -8px rgba(0,0,0,0.55)',
                },
                success: { iconTheme: { primary: '#10b981', secondary: '#06281d' } },
                error: { iconTheme: { primary: '#f43f5e', secondary: '#2b0d12' } },
              }}
            />
          </ConfirmProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
