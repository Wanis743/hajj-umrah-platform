import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
          </ConfirmProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
