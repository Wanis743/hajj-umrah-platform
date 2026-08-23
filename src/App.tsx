import React, { Suspense } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AdminLogin from '@/components/AdminLogin';
import AdminMfaSetup from '@/components/AdminMfaSetup';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useRouter } from '@/router/RouterProvider';
import { useAuth } from '@/lib/auth';

const HomePage = React.lazy(() => import('@/components/HomePage'));
const ReservationPage = React.lazy(() => import('@/components/ReservationPage'));
const AdminDashboard = React.lazy(() => import('@/components/AdminDashboard'));
export default function App() {
  const { route } = useRouter();
  const { session, loading, isStaff, mfaRequired } = useAuth();

  const fallback = (
    <div className="flex min-h-screen items-center justify-center bg-sand-50 dark:bg-sand-950">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-oasis-500 border-t-transparent" />
    </div>
  );

  if (route === 'admin') {
    if (loading) {
      return fallback;
    }
    return (
      <div className="min-h-screen bg-zinc-50 transition-colors dark:bg-zinc-950">
        {session && isStaff ? (
          mfaRequired ? <AdminMfaSetup onVerified={() => window.location.reload()} /> : (
            <ErrorBoundary>
              <Suspense fallback={fallback}>
                <AdminDashboard />
              </Suspense>
            </ErrorBoundary>
          )
        ) : (
          <AdminLogin />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sand-50 transition-colors dark:bg-sand-950">
      <Navbar />
      <Suspense fallback={fallback}>
        {route === 'reserve' ? <ReservationPage /> : <HomePage />}
      </Suspense>
      <Footer />
    </div>
  );
}
