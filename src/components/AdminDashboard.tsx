import { useState, useEffect } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { languages } from '@/i18n/translations';
import { useRouter } from '@/router/RouterProvider';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { agencyConfig } from '@/config/agency';
import logoSrc from '@/assets/agency-logo.png';
import type { DashboardFilters } from '@/types/dashboard';
import type { ExtendedAdminTab } from '@/components/admin/adminDashboardTypes';
import AdminDashboardView from '@/components/admin/AdminDashboard';
import { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

export default function AdminDashboard() {
  const { lang, setLang } = useI18n();
  const { navigate } = useRouter();
  const { session } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const currentLang = languages.find((l) => l.code === lang);

  const [activeTab, setActiveTab] = useState<ExtendedAdminTab>('launcher');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [departureDate, setDepartureDate] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const [dateSaved, setDateSaved] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notifications] = useState<Array<{ id: string; text: string; time: Date }>>([]);
  const [dashboardFilters, setDashboardFilters] = useState<DashboardFilters>({ dateFrom: '', dateTo: '', branchId: '', packageId: '' }) // branchId stays empty: single-agency deployment;

  const {
    pilgrims, packages, hotels, flights, buses, camps, guides, incidents, financials,
    bookings, groups, visas, leads, alerts, actions, reservations, payments, documents, suppliers,
    dataLoading, dashboardSnapshot, dashboardRealtimeStatus, fetchAllData, fetchDashboardSnapshot,
  } = useAdminDashboardData(activeTab, dashboardFilters);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('home'); };
  const saveDepartureDate = async () => { setSavingDate(true); const { error } = await supabase.rpc('update_departure_setting', { p_next_departure_date: departureDate || null }); if (!error) { setDateSaved(true); setTimeout(() => setDateSaved(false), 3000); } setSavingDate(false); };

  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => { const target = e.target as HTMLElement; if (!target.closest('[data-notif-panel]')) setNotifOpen(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [notifOpen]);

  return (
    <AdminDashboardView
      lang={lang}
      setLang={setLang}
      isAr={isAr}
      t={t}
      currentLang={currentLang}
      session={session}
      theme={theme}
      toggleTheme={toggleTheme}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
      notifOpen={notifOpen}
      setNotifOpen={setNotifOpen}
      isNewModalOpen={isNewModalOpen}
      setIsNewModalOpen={setIsNewModalOpen}
      commandOpen={commandOpen}
      setCommandOpen={setCommandOpen}
      langOpen={langOpen}
      setLangOpen={setLangOpen}
      notifications={notifications}
      pilgrims={pilgrims}
      packages={packages}
      hotels={hotels}
      flights={flights}
      buses={buses}
      camps={camps}
      guides={guides}
      incidents={incidents}
      financials={financials}
      bookings={bookings}
      groups={groups}
      visas={visas}
      leads={leads}
      alerts={alerts}
      actions={actions}
      reservations={reservations}
      payments={payments}
      documents={documents}
      suppliers={suppliers}
      dashboardSnapshot={dashboardSnapshot}
      dashboardFilters={dashboardFilters}
      setDashboardFilters={setDashboardFilters}
      dashboardRealtimeStatus={dashboardRealtimeStatus}
      dataLoading={dataLoading}
      departureDate={departureDate}
      setDepartureDate={setDepartureDate}
      savingDate={savingDate}
      dateSaved={dateSaved}
      setDateSaved={setDateSaved}
      handleLogout={handleLogout}
      saveDepartureDate={saveDepartureDate}
      fetchAllData={fetchAllData}
      fetchDashboardSnapshot={fetchDashboardSnapshot}
      logoSrc={logoSrc}
      agencyConfig={agencyConfig}
    />
  );
}
