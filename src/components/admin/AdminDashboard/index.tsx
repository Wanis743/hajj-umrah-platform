import { SettingsTab } from './SettingsTab';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, BarChart3, BrainCircuit, Users, CalendarCheck, Settings, Bell,
  UsersRound, BadgeCheck, FileText, Plane, PlaneTakeoff, Hotel, BedDouble, Bus, UserCheck, Target,
  Truck, Package, LifeBuoy, AlertTriangle, Siren, Zap, FileBarChart, DatabaseZap, ScrollText, Tent,
  Landmark, Wallet, BookOpenCheck, Gauge, Briefcase, ShieldCheck, Settings2, Compass, ExternalLink, TrendingUp,
  FileStack, Layers,
} from 'lucide-react';


import type { Lang } from '@/i18n/translations';
import type { Pilgrim, HajjPackage, HotelInventory, FlightLogistics, BusFleet, HolySiteCamp, MutawwifGuide, EmergencyIncident, FinancialSummary } from '@/types/kpi';
import Insights from '@/components/admin/DataInsights';
import { PilgrimManager } from '@/components/admin/PilgrimManager';
import { GroupManager } from '@/components/admin/GroupManager';
import { VisaProcessor } from '@/components/admin/VisaProcessor';
import DocumentCenter from '@/components/admin/DocumentCenter';
import { FlightManager } from '@/components/admin/FlightManager';
import { HotelManager } from '@/components/admin/HotelManager';
import { TransportManager } from '@/components/admin/TransportManager';
import { HajjOperations } from '@/components/admin/HajjOperations';
import MutawwifManager from '@/components/admin/MutawwifManager';
import { SupplierManager } from '@/components/admin/SupplierManager';
import PackageManager from '@/components/admin/PackageManager';
import { IncidentManager } from '@/components/admin/IncidentManager';
import { ActionCenter } from '@/components/admin/ActionCenter';
import { AlertDashboard } from '@/components/admin/AlertDashboard';
import DataQualityDashboard from '@/components/admin/DataQualityDashboard';
import AuditLog from '@/components/admin/AuditLog';
import FlightLogisticsManager from '@/components/admin/FlightLogisticsManager';
import HotelHousingManager from '@/components/admin/HotelHousingManager';
import FinancialLedgerManager from '@/components/admin/FinancialLedgerManager';
import HolySitesManager from '@/components/admin/HolySitesManager';
import EmergencySosManager from '@/components/admin/EmergencySosManager';
import CommandPalette from '@/components/admin/CommandPalette';
import type { DashboardFilters, DashboardSnapshot, DashboardRealtimeStatus } from '@/types/dashboard';


import type { ExtendedAdminTab, NavSection } from '@/components/admin/adminDashboardTypes';
import AdminSidebar from '@/components/admin/AdminSidebar';
import AdminDashboardHeader from '@/components/admin/AdminDashboardHeader';
import type { CommandSearchRecord } from '@/components/admin/CommandPalette';


const LazyCommandCenter = lazy(() => import('@/components/admin/CommandCenter'));
const LazyAdvancedAnalytics = lazy(() => import('@/components/admin/AdvancedAnalytics'));
const LazyBookingManager = lazy(() => import('@/components/admin/BookingManager').then((m) => ({ default: m.BookingManager })));
const LazyReportBuilder = lazy(() => import('@/components/admin/ReportBuilder'));
const LazyNewReservationModal = lazy(() => import('@/components/admin/NewReservationModal'));
const LazyExternalOperations = lazy(() => import('@/components/admin/ExternalOperationsCenter').then(m => ({ default: m.ExternalOperationsCenter })));
const LazyGroupOps = lazy(() => import('@/components/admin/GroupOperationsCenter').then(m => ({ default: m.GroupOperationsCenter })));
const LazyImportCenter = lazy(() => import('@/components/admin/ImportCenter').then(m => ({ default: m.ImportCenter ?? m.default })));
const LazyFinanceOS = lazy(() => import('@/components/admin/FinanceOS'));
const LazyOperationsOS = lazy(() => import('@/components/admin/OperationsOS').then(m => ({ default: m.OperationsOS })));
const LazyExportCenter = lazy(() => import('@/components/admin/ExportCenter').then(m => ({ default: m.ExportCenter ?? m.default })));
const LazyCrmWorkspace = lazy(() => import('@/components/admin/crm').then(m => ({ default: m.CrmWorkspace })));
const LazyDmsWorkspace = lazy(() => import('@/components/admin/dms').then(m => ({ default: m.DmsWorkspace })));
const LazyBiWorkspace = lazy(() => import('@/components/admin/bi').then(m => ({ default: m.BiWorkspace })));

export interface AdminDashboardViewProps {
  lang: Lang;
  setLang: (lang: Lang) => void;
  isAr: boolean;
  t: (ar: string, fr: string, en: string) => string;
  currentLang?: { code: string; label: string; flag: string };
  session: import('@supabase/supabase-js').Session | null;
  theme: string;
  toggleTheme: () => void;
  activeTab: ExtendedAdminTab;
  setActiveTab: (tab: ExtendedAdminTab) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  notifOpen: boolean;
  setNotifOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  isNewModalOpen: boolean;
  setIsNewModalOpen: (value: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  langOpen: boolean;
  setLangOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  notifications: Array<{ id: string; text: string; time: Date }>;
  pilgrims: Pilgrim[];
  packages: HajjPackage[];
  hotels: HotelInventory[];
  flights: FlightLogistics[];
  buses: BusFleet[];
  camps: HolySiteCamp[];
  guides: MutawwifGuide[];
  incidents: EmergencyIncident[];
  financials: FinancialSummary;
  bookings: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  visas: Array<Record<string, unknown>>;
  leads: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  suppliers: Array<Record<string, unknown>>;
  dashboardSnapshot: DashboardSnapshot | null;
  dashboardFilters: DashboardFilters;
  setDashboardFilters: (filters: DashboardFilters) => void;
  dashboardRealtimeStatus: DashboardRealtimeStatus;
  dataLoading: boolean;
  departureDate: string;
  setDepartureDate: (date: string) => void;
  savingDate: boolean;
  dateSaved: boolean;
  setDateSaved: (value: boolean) => void;
  handleLogout: () => Promise<void>;
  saveDepartureDate: () => Promise<void>;
  fetchAllData: () => Promise<void>;
  fetchDashboardSnapshot: () => Promise<void>;
  logoSrc: string;
  agencyConfig: { name: string; legalName?: string; phone?: string; email?: string; wilaya?: string; registrationNumber?: string; timezone?: string };
}


export default function AdminDashboardView(props: AdminDashboardViewProps) {
  const {
    lang, setLang, isAr, t, currentLang, session, theme, toggleTheme,
    activeTab, setActiveTab, sidebarOpen, setSidebarOpen, notifOpen, setNotifOpen,
    isNewModalOpen, setIsNewModalOpen, commandOpen, setCommandOpen, langOpen, setLangOpen,
    notifications, pilgrims, packages, hotels, flights, buses, camps, guides, incidents,
    bookings, groups, visas, leads, alerts, actions, reservations, payments,
    documents, suppliers, dashboardSnapshot, dashboardFilters, setDashboardFilters,
    dashboardRealtimeStatus, dataLoading, departureDate, setDepartureDate, savingDate,
    dateSaved, handleLogout, saveDepartureDate, fetchAllData,
    fetchDashboardSnapshot, logoSrc, agencyConfig,
  } = props;

  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('admin-rail-pinned') === '1';
  });
  const [railHovered, setRailHovered] = useState(false);
  const [recentTabs, setRecentTabs] = useState<ExtendedAdminTab[]>([]);

  useEffect(() => { localStorage.setItem('admin-rail-pinned', pinned ? '1' : '0'); }, [pinned]);
  const railExpanded = pinned || railHovered || sidebarOpen;

  const count = (n: number) => (n > 0 ? (n > 999 ? '999+' : String(n)) : undefined);
  const openIncidents = incidents.filter((i) => i.status !== 'resolved').length;
  const pendingVisas = visas.filter((v) => {
    const s = typeof v.status === 'string' ? v.status.toLowerCase() : '';
    return s !== 'issued' && s !== 'approved' && s !== 'delivered';
  }).length;

  const navSections: NavSection[] = useMemo(() => [
    {
      id: 'overview', label: t('نظرة عامة', 'Aperçu', 'Overview'), icon: Gauge, items: [
        { id: 'command_center', ar: 'مركز القيادة', fr: 'Centre de commandement', en: 'Command Center', icon: LayoutDashboard, descAr: 'المؤشرات الحية والحالة العامة', descFr: 'KPI temps réel', descEn: 'Live KPIs & status', keywords: ['home', 'kpi', 'رئيسية'] },
        { id: 'kpi_universe', ar: 'التحليلات والرسوم', fr: 'Analyse & Graphiques', en: 'Analytics & Charts', icon: BarChart3, descAr: 'الرسوم البيانية والاتجاهات', descFr: 'Graphiques & tendances', descEn: 'Charts & trends', keywords: ['charts', 'graph', 'رسوم'] },
        { id: 'data_insights', ar: 'الرؤى والتحليلات', fr: 'Insights', en: 'Insights', icon: BrainCircuit, descAr: 'تحليلات وتوصيات', descFr: 'Analyse des données', descEn: 'Data analysis', keywords: ['insights', 'تحليلات'] },
      ],
    },
    {
      id: 'journey', label: t('رحلة الحاج', 'Parcours pèlerin', 'Pilgrim Journey'), icon: Compass, items: [
        { id: 'pilgrims', ar: 'الحجاج', fr: 'Pèlerins', en: 'Pilgrims', icon: Users, badge: count(pilgrims.length), descAr: 'ملفات الحجاج', descFr: 'Dossiers pèlerins', descEn: 'Pilgrim records' },
        { id: 'bookings', ar: 'الحجوزات', fr: 'Réservations', en: 'Bookings', icon: CalendarCheck, badge: count(bookings.length), descAr: 'إدارة الحجوزات والدفعات', descFr: 'Réservations & paiements', descEn: 'Bookings & payments' },
        { id: 'groups', ar: 'المجموعات', fr: 'Groupes', en: 'Groups', icon: UsersRound, badge: count(groups.length), descAr: 'الأفواج والسعة', descFr: 'Groupes & capacité', descEn: 'Groups & capacity' },
        { id: 'visas', ar: 'التأشيرات', fr: 'Visas', en: 'Visas', icon: BadgeCheck, badge: count(pendingVisas), descAr: 'مسار التأشيرة الخارجي', descFr: 'Visas & External', descEn: 'Visa & External pipeline', keywords: ['external'] },
        { id: 'documents', ar: 'الوثائق', fr: 'Documents', en: 'Documents', icon: FileText, badge: count(documents.length), descAr: 'الجوازات والمرفقات', descFr: 'Passeports & pièces', descEn: 'Passports & files' },
      ],
    },
    {
      id: 'logistics', label: t('النقل واللوجستيك', 'Transport & Logistique', 'Travel & Logistics'), icon: Plane, items: [
        { id: 'flights', ar: 'الرحلات الجوية', fr: 'Vols', en: 'Flights', icon: Plane, badge: count(flights.length), descAr: 'جدول الرحلات', descFr: 'Programme des vols', descEn: 'Flight schedule' },
        { id: 'flight_logistics', ar: 'كشوف الرحلات', fr: 'Manifestes vols', en: 'Flight Manifests', icon: PlaneTakeoff, descAr: 'التوزيع والمقاعد والكشوف', descFr: 'Sièges & manifestes', descEn: 'Seating & manifests' },
        { id: 'transport', ar: 'النقل البري', fr: 'Transport terrestre', en: 'Ground Transport', icon: Bus, badge: count(buses.length), descAr: 'الحافلات والتنقلات', descFr: 'Bus & navettes', descEn: 'Buses & transfers' },
      ],
    },
    {
      id: 'hosting', label: t('الإقامة والمشاعر', 'Hébergement & Lieux saints', 'Housing & Holy Sites'), icon: Hotel, items: [
        { id: 'hotels', ar: 'الفنادق', fr: 'Hôtels', en: 'Hotels', icon: Hotel, badge: count(hotels.length), descAr: 'مخزون الفنادق والعقود', descFr: 'Stock hôtelier', descEn: 'Hotel inventory' },
        { id: 'housing', ar: 'توزيع الغرف', fr: 'Attribution chambres', en: 'Room Allocation', icon: BedDouble, descAr: 'إسناد الحجاج للغرف', descFr: 'Affectation des chambres', descEn: 'Assign pilgrims to rooms' },
        { id: 'hajj_ops', ar: 'عمليات الحج', fr: 'Opérations Hajj', en: 'Hajj Operations', icon: Tent, badge: count(camps.length), descAr: 'المخيمات والتفويج', descFr: 'Camps & rotations', descEn: 'Camps & rotations' },
        { id: 'holy_sites', ar: 'المشاعر المقدسة', fr: 'Lieux saints', en: 'Holy Sites', icon: Landmark, descAr: 'منى وعرفة ومزدلفة', descFr: 'Mina, Arafat, Muzdalifa', descEn: 'Mina, Arafat, Muzdalifah' },
        { id: 'guides', ar: 'المطوفون', fr: 'Guides', en: 'Guides', icon: UserCheck, badge: count(guides.length), descAr: 'المرشدون وتوزيعهم', descFr: 'Guides & affectations', descEn: 'Guides & assignments' },
        { id: 'group_ops', ar: 'تحكم المجموعات', fr: 'Contrôle groupes', en: 'Group Control', icon: TrendingUp, descAr: 'تتبع جاهزية الأفواج', descFr: 'Suivi groupes', descEn: 'Group readiness tracking' },
        { id: 'external_ops', ar: 'العمليات الخارجية', fr: 'Opérations externes', en: 'External Operations', icon: ExternalLink, descAr: 'العمليات الخارجية والخطوط', descFr: 'External, Airlines, Hôtels', descEn: 'External, Airlines, Hotels ops' },
      ],
    },
    {
      id: 'business', label: t('التجارة والمالية', 'Commercial & Finance', 'Commerce & Finance'), icon: Briefcase, items: [
        { id: 'packages', ar: 'الباقات', fr: 'Forfaits', en: 'Packages', icon: Package, badge: count(packages.length), descAr: 'برامج الحج والعمرة', descFr: 'Programmes Hajj/Omra', descEn: 'Hajj & Umrah programs' },
        { id: 'crm', ar: 'المبيعات والعملاء', fr: 'Ventes & CRM', en: 'Sales & CRM', icon: Target, badge: count(leads.length), descAr: 'العملاء المحتملون', descFr: 'Prospects', descEn: 'Leads pipeline' },
        { id: 'finance_os', ar: 'المالية', fr: 'Finance', en: 'Finance', icon: Wallet, descAr: 'المقبوضات والمدفوعات', descFr: 'Encaissements & dépenses', descEn: 'Revenue & expenses' },
        { id: 'ledger', ar: 'دفتر القيود', fr: 'Grand livre', en: 'Ledger', icon: BookOpenCheck, descAr: 'القيد المزدوج', descFr: 'Comptabilité en partie double', descEn: 'Double-entry accounting' },
        { id: 'suppliers', ar: 'الموردون', fr: 'Fournisseurs', en: 'Suppliers', icon: Truck, badge: count(suppliers.length), descAr: 'العقود والمستحقات', descFr: 'Contrats & dus', descEn: 'Contracts & payables' },
      ],
    },
    {
      id: 'support', label: t('الدعم والطوارئ', 'Support & Urgences', 'Support & Safety'), icon: LifeBuoy, items: [
        { id: 'actions', ar: 'مركز الإجراءات', fr: "Centre d'actions", en: 'Action Center', icon: Zap, badge: count(actions.length), descAr: 'المهام المطلوبة', descFr: 'Tâches à traiter', descEn: 'Tasks to handle' },
        { id: 'tickets', ar: 'التذاكر', fr: 'Tickets', en: 'Tickets', icon: LifeBuoy, descAr: 'طلبات الدعم', descFr: 'Demandes de support', descEn: 'Support requests' },
        { id: 'incidents', ar: 'الحوادث', fr: 'Incidents', en: 'Incidents', icon: AlertTriangle, badge: count(openIncidents), badgeRed: openIncidents > 0, descAr: 'الحوادث المفتوحة', descFr: 'Incidents ouverts', descEn: 'Open incidents' },
        { id: 'sos', ar: 'الطوارئ SOS', fr: 'Urgences SOS', en: 'Emergency SOS', icon: Siren, descAr: 'نداءات الاستغاثة', descFr: 'Alertes SOS', descEn: 'SOS alerts' },
      ],
    },
    {
      id: 'governance', label: t('الحوكمة', 'Gouvernance', 'Governance'), icon: ShieldCheck, items: [
        { id: 'alerts', ar: 'التنبيهات', fr: 'Alertes', en: 'Alerts', icon: Bell, badge: count(alerts.length), descAr: 'تنبيهات النظام', descFr: 'Alertes système', descEn: 'System alerts' },
        { id: 'reports', ar: 'التقارير', fr: 'Rapports', en: 'Reports', icon: FileBarChart, descAr: 'منشئ التقارير والتصدير', descFr: 'Générateur de rapports', descEn: 'Report builder & export' },
        { id: 'data_quality', ar: 'جودة البيانات', fr: 'Qualité des données', en: 'Data Quality', icon: DatabaseZap, descAr: 'الفحوصات والتناسق', descFr: 'Contrôles & cohérence', descEn: 'Checks & consistency' },
        { id: 'audit', ar: 'سجل المراجعة', fr: "Journal d'audit", en: 'Audit Log', icon: ScrollText, descAr: 'تتبع كل عملية', descFr: 'Traçabilité', descEn: 'Full traceability' },
        { id: 'dms', ar: 'إدارة الوثائق', fr: 'Gestion documentaire', en: 'Document Management', icon: FileStack, descAr: 'النسخ والمراجعة والأدلة', descFr: 'Versions, révision, preuves', descEn: 'Versions, review, evidence', keywords: ['dms', 'ocr', 'extraction', 'expiry', 'seal', 'evidence', 'وثائق', 'ختم'] },
        { id: 'bi', ar: 'استوديو التحليل', fr: 'Studio BI', en: 'BI Studio', icon: Layers, descAr: 'مجموعات ومقاييس وتحليل ولوحات', descFr: 'Jeux, mesures, analyses, tableaux', descEn: 'Datasets, metrics, analysis, dashboards', keywords: ['bi', 'semantic', 'dataset', 'metric', 'drill', 'lineage', 'dashboard', 'تحليل', 'مقياس', 'أثر'] },
        { id: 'import_center', ar: 'مركز الاستيراد', fr: "Centre d'import", en: 'Import Center', icon: DatabaseZap, descAr: 'استيراد CSV/XLSX/JSON بـ13 خطوة', descFr: 'Import CSV/XLSX/JSON en 13 étapes', descEn: 'Import CSV/XLSX/JSON (13-step wizard)' },
        { id: 'export_center', ar: 'مركز التصدير', fr: "Centre d'export", en: 'Export Center', icon: FileBarChart, descAr: 'تصدير البيانات بصيغ متعددة', descFr: 'Export multi-format', descEn: 'Multi-format data export' },
      ],
    },
    {
      id: 'system', label: t('النظام', 'Système', 'System'), icon: Settings2, items: [
        { id: 'settings', ar: 'الإعدادات', fr: 'Paramètres', en: 'Settings', icon: Settings, descAr: 'إعدادات الوكالة', descFr: "Paramètres de l'agence", descEn: 'Agency settings' },
      ],
    },
     
  ], [t, pilgrims.length, bookings.length, groups.length, documents.length, flights.length, buses.length, hotels.length, camps.length, guides.length, packages.length, leads.length, suppliers.length, actions.length, alerts.length, openIncidents, pendingVisas]);


  const flatItems = useMemo(() => navSections.flatMap((s) => s.items.map((i) => ({ ...i, sectionLabel: s.label }))), [navSections]);
  const activeItem = flatItems.find((i) => i.id === activeTab) ?? flatItems[0];
  const activeTitle = { ar: activeItem.ar, fr: activeItem.fr, en: activeItem.en };
  const activeSectionLabel = activeItem.sectionLabel;
  const activeDesc = t(activeItem.descAr ?? '', activeItem.descFr ?? '', activeItem.descEn ?? '');

  const goTab = useCallback((tab: ExtendedAdminTab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
    try {
      window.localStorage.setItem('admin-active-tab', tab);
      const recents = JSON.parse(window.localStorage.getItem('admin-recent-tabs') || '[]') as string[];
      const next = [tab, ...recents.filter((r) => r !== tab)].slice(0, 5);
      window.localStorage.setItem('admin-recent-tabs', JSON.stringify(next));
      setRecentTabs(next as ExtendedAdminTab[]);
      window.history.replaceState(null, '', `#/admin/${tab}`);
    } catch { /* storage unavailable */ }
  }, [setActiveTab, setSidebarOpen]);

  // Restore tab from URL hash / last session, and keep hash in sync
  useEffect(() => {
    const valid = new Set(flatItems.map((i) => i.id));
    
    const fromHashRaw = window.location.hash;
    if (fromHashRaw === '#/admin' || fromHashRaw === '#/admin/' || fromHashRaw === '' || fromHashRaw === '#/') {
      if (activeTab !== 'launcher') setActiveTab('launcher');
      return undefined;
    }

    const fromHash = fromHashRaw.replace('#/admin/', '').replace('#/', '').replace('#', '');
    const stored = window.localStorage.getItem('admin-active-tab') || '';
    const target = valid.has(fromHash as ExtendedAdminTab) ? fromHash : (valid.has(stored as ExtendedAdminTab) ? stored : '');

    if (target && target !== activeTab) setActiveTab(target as ExtendedAdminTab);
    try {
      setRecentTabs(JSON.parse(window.localStorage.getItem('admin-recent-tabs') || '[]'));
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: alt+1..8 jumps to a section's first tab, alt+[ / ] cycles tabs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const idx = Number(e.key) - 1;
      if (!Number.isNaN(idx) && idx >= 0 && idx < navSections.length) {
        e.preventDefault();
        goTab(navSections[idx].items[0].id);
        return;
      }
      if (e.key === ']' || e.key === '[') {
        e.preventDefault();
        const pos = flatItems.findIndex((i) => i.id === activeTab);
        const nextPos = (pos + (e.key === ']' ? 1 : -1) + flatItems.length) % flatItems.length;
        goTab(flatItems[nextPos].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navSections, flatItems, activeTab, goTab]);

  if (activeTab === 'launcher') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-sand-50 dark:bg-sand-950 p-6">
        <div className="w-full max-w-4xl">
          <h1 className="text-3xl font-bold text-center mb-12 text-sand-900 dark:text-sand-50">Choose Environment</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <button onClick={() => goTab('command_center')} className="group relative overflow-hidden rounded-2xl border border-sand-200 bg-white/50 p-8 text-left shadow-lg backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-xl dark:border-sand-800 dark:bg-black/50">
              <div className="absolute inset-0 bg-gradient-to-br from-oasis-500/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <LayoutDashboard className="mb-6 h-12 w-12 text-oasis-600 dark:text-oasis-400" />
              <h2 className="text-2xl font-semibold text-sand-900 dark:text-sand-50">Operations OS</h2>
              <p className="mt-4 text-sand-600 dark:text-sand-400">Manage pilgrims, bookings, flights, hotels, visas, and daily Hajj & Umrah operations.</p>
            </button>
            <button onClick={() => goTab('finance_os')} className="group relative overflow-hidden rounded-2xl border border-sand-200 bg-white/50 p-8 text-left shadow-lg backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-xl dark:border-sand-800 dark:bg-black/50">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <Wallet className="mb-6 h-12 w-12 text-blue-600 dark:text-blue-400" />
              <h2 className="text-2xl font-semibold text-sand-900 dark:text-sand-50">Finance OS</h2>
              <p className="mt-4 text-sand-600 dark:text-sand-400">A full financial desktop: windowed apps for the journal, budgets, reconciliation, statements and audit — on the live ledger.</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'operations_os') {
      return (
        <Suspense fallback={<div className="p-8 text-center">Loading Operations OS...</div>}>
          <LazyOperationsOS onBack={() => setActiveTab('command_center')} />
        </Suspense>
      );
    }

    if (activeTab === 'finance_os') {
    return (
      <Suspense fallback={<div className="p-8 text-center">Loading Finance OS...</div>}>
        <LazyFinanceOS onBack={() => goTab('launcher')} />
      </Suspense>
    );
  }

  const filteredSections = navSections;

  const commandPilgrims: CommandSearchRecord[] = pilgrims.map((p) => ({
    id: p.id, reference: p.reference, full_name: p.fullName, passport_number: p.passportNumber, status: p.visaStatus,
  }));
  const commandBookings: CommandSearchRecord[] = bookings.map((b) => ({
    id: String(b.id ?? ''), reference: typeof b.reference === 'string' ? b.reference : undefined,
    pilgrim_name: typeof b.pilgrim_name === 'string' ? b.pilgrim_name : undefined,
    full_name: typeof b.full_name === 'string' ? b.full_name : undefined,
    status: typeof b.status === 'string' ? b.status : undefined,
  }));
  const commandGroups: CommandSearchRecord[] = groups.map((g) => ({
    id: String(g.id ?? ''), code: typeof g.code === 'string' ? g.code : undefined,
    name: typeof g.name === 'string' ? g.name : undefined,
    group_id: typeof g.group_id === 'string' ? g.group_id : undefined,
    pilgrim_count: typeof g.pilgrim_count === 'number' ? g.pilgrim_count : undefined,
    capacity: typeof g.capacity === 'number' ? g.capacity : undefined,
  }));
  const commandFlights: CommandSearchRecord[] = flights.map((f) => ({
    id: f.id, flight_number: f.flightNumber, airline: f.airline, arrivalCity: f.arrivalCity,
  }));
  const commandHotels: CommandSearchRecord[] = hotels.map((h) => ({
    id: h.id, hotelName: h.hotelName, city: h.city,
  }));
  const commandSuppliers: CommandSearchRecord[] = suppliers.map((s) => ({
    id: String(s.id ?? ''), name: typeof s.name === 'string' ? s.name : undefined,
    category: typeof s.category === 'string' ? s.category : undefined,
  }));

  return (
    <div data-testid="admin-shell" className={`admin-dashboard admin-shell h-screen antialiased overflow-hidden ${isAr ? 'font-arabic' : ''}`} dir={isAr ? 'rtl' : 'ltr'}>
      <div className="aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className="admin-frame">
        {(sidebarOpen || (railHovered && !pinned)) && (
          <div className="admin-rail-scrim" onClick={() => { setSidebarOpen(false); setRailHovered(false); }} />
        )}

        {/* Hover hotspot that reveals the rail */}
        <div className="admin-rail-hotspot" onMouseEnter={() => setRailHovered(true)} aria-hidden="true" />

        <AdminSidebar
          isAr={isAr}
          t={t}
          activeTab={activeTab}
          setActiveTab={goTab}
          recentTabs={recentTabs}

          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          pinned={pinned}
          setPinned={setPinned}
          expanded={railExpanded}
          onHoverChange={setRailHovered}
          filteredSections={filteredSections}
          agencyName={agencyConfig.name}
          logoSrc={logoSrc}
          
          onLogout={handleLogout}
        />
        {/* Main */}
        <div className={`admin-main flex flex-col min-w-0 overflow-hidden ${pinned ? 'is-pinned' : ''}`}>

          <AdminDashboardHeader
            isAr={isAr}
            t={t}
            lang={lang}
            setLang={setLang}
            currentLang={currentLang}
            theme={theme}
            toggleTheme={toggleTheme}
            activeTab={activeTab}
            activeTitle={activeTitle}
            activeSectionLabel={activeSectionLabel}
            activeDesc={activeDesc}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            commandOpen={commandOpen}
            setCommandOpen={setCommandOpen}
            notifOpen={notifOpen}
            setNotifOpen={setNotifOpen}
            notifications={notifications}
            langOpen={langOpen}
            setLangOpen={setLangOpen}
            agencyName={agencyConfig.name}
            logoSrc={logoSrc}
            userEmail={session?.user?.email ?? null}
            openIncidents={openIncidents}
            dataLoading={dataLoading}
            onNew={() => setIsNewModalOpen(true)}
            onRefresh={() => { void fetchAllData(); void fetchDashboardSnapshot(); }}
            onLogout={() => { void handleLogout(); }}
            onOpenFinanceOS={() => goTab('finance_os')}
          />


        <main className="flex-1 overflow-y-auto">
          <div key={activeTab} className="admin-view p-6">
            <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="h-6 w-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" /></div>}>
              {/* First-load skeleton — only shown on initial page load, not on tab change */}
              {dataLoading && (
                <div className="space-y-4" aria-hidden="true">
                  <div className="h-7 w-48 skeleton" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 skeleton" />)}
                  </div>
                  <div className="h-64 skeleton" />
                </div>
              )}
              {/* Content — rendered immediately after first load; background refreshes don't re-block */}
              {!dataLoading && (
                <>
                  {activeTab === 'command_center' && <LazyCommandCenter snapshot={dashboardSnapshot} filters={dashboardFilters} onFiltersChange={setDashboardFilters} onRefresh={() => void fetchDashboardSnapshot()} onNavigate={(tab) => goTab(tab as ExtendedAdminTab)} realtimeStatus={dashboardRealtimeStatus} />}
                  {activeTab === 'kpi_universe' && <LazyAdvancedAnalytics filters={dashboardFilters} snapshot={dashboardSnapshot} />}
                  {activeTab === 'data_insights' && <Insights pilgrims={pilgrims as never}
                        bookings={bookings}
                        groups={groups}
                        visas={visas}
                        payments={payments}
                        hotels={hotels as unknown as Record<string, unknown>[]}
                        flights={flights as unknown as Record<string, unknown>[]}
                        buses={buses as unknown as Record<string, unknown>[]}
                        camps={camps as unknown as Record<string, unknown>[]}
                        incidents={incidents as unknown as Record<string, unknown>[]}
                        reservations={reservations}
                        alerts={alerts as never}
                        leads={leads}
                        packages={packages as unknown as Record<string, unknown>[]}
                        guides={guides as never}
                        documents={documents}
                        suppliers={suppliers} executiveSnapshot={dashboardSnapshot} />}
                  {activeTab === 'pilgrims' && <PilgrimManager pilgrims={pilgrims as never} onOpenNewReservationModal={() => setIsNewModalOpen(true)} />}
                  {activeTab === 'bookings' && <LazyBookingManager />} {activeTab === 'groups' && <GroupManager />} {activeTab === 'visas' && <VisaProcessor />} {activeTab === 'documents' && <DocumentCenter documents={documents as never} />}
                  {activeTab === 'flights' && <FlightManager flights={flights as never} />} {activeTab === 'flight_logistics' && <FlightLogisticsManager />} {activeTab === 'hotels' && <HotelManager hotels={hotels} />} {activeTab === 'housing' && <HotelHousingManager />} {activeTab === 'transport' && <TransportManager vehicles={buses as never} />} {activeTab === 'hajj_ops' && <HajjOperations camps={camps as never} />} {activeTab === 'holy_sites' && <HolySitesManager />} {activeTab === 'guides' && <MutawwifManager guides={guides as never} />}
                  {activeTab === 'crm' && <LazyCrmWorkspace />} {activeTab === 'ledger' && <FinancialLedgerManager />} {activeTab === 'suppliers' && <SupplierManager suppliers={suppliers} />} {activeTab === 'packages' && <PackageManager packages={packages as never} />}
                  {activeTab === 'tickets' && <IncidentManager incidents={incidents as never} tickets={[]} />} {activeTab === 'incidents' && <IncidentManager incidents={incidents as never} tickets={[]} />} {activeTab === 'sos' && <EmergencySosManager />} {activeTab === 'actions' && <ActionCenter actions={actions as never} />}
                  {activeTab === 'alerts' && <AlertDashboard alerts={alerts as never} />} {activeTab === 'reports' && <LazyReportBuilder />} {activeTab === 'data_quality' && <DataQualityDashboard />} {activeTab === 'audit' && <AuditLog />}
                  {activeTab === 'dms' && <LazyDmsWorkspace />}
                  {activeTab === 'bi' && <LazyBiWorkspace />}
                  {activeTab === 'group_ops' && <Suspense fallback={null}><LazyGroupOps /></Suspense>}
                  {activeTab === 'external_ops' && <Suspense fallback={null}><LazyExternalOperations /></Suspense>}
                  {activeTab === 'import_center' && <Suspense fallback={null}><LazyImportCenter /></Suspense>}
                  {activeTab === 'export_center' && <Suspense fallback={null}><LazyExportCenter /></Suspense>}

              {activeTab === 'settings' && <SettingsTab 
                agencyConfig={agencyConfig}
                departureDate={departureDate}
                setDepartureDate={setDepartureDate}
                saveDepartureDate={saveDepartureDate}
                savingDate={savingDate}
                dateSaved={dateSaved}
                dashboardRealtimeStatus={dashboardRealtimeStatus}
                session={session as unknown as { user: { email?: string; last_sign_in_at?: string } } | null}
                handleLogout={handleLogout}
              />}
                </>
              )}
            </Suspense>
          </div>
        </main>
        </div>
      </div>



      <LazyNewReservationModal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} onAdded={() => { void fetchDashboardSnapshot(); if (activeTab !== 'command_center') void fetchAllData(); }} />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onNavigate={(tab) => { goTab(tab); }}
        navSections={navSections}
        pilgrims={commandPilgrims}
        bookings={commandBookings}
        groups={commandGroups}
        flights={commandFlights}
        hotels={commandHotels}
        suppliers={commandSuppliers}
      />
    </div>
  );
}