import {
  BookOpen, Wallet, Scale, ShieldCheck, Target, LineChart, PieChart, TrendingUp,
  Gauge, Settings, Info, Landmark, BarChart3,
} from 'lucide-react';

import { JournalWorkspace } from '../JournalWorkspace';
import { ChartOfAccounts } from '../ChartOfAccounts';
import { ReconciliationWorkspace } from '../ReconciliationWorkspace';
import { CloseCenter } from '../CloseCenter';
import { PlanningWorkspace } from '../PlanningWorkspace';
import { ModelingWorkspace } from '../ModelingWorkspace';
import { ReportsWorkspace } from '../ReportsWorkspace';
import { UnitEconomicsWorkspace } from '../UnitEconomicsWorkspace';
import { TreasuryWorkspace } from '@/platform/treasury/TreasuryWorkspace';
import { OverviewApp } from './apps/OverviewApp';
import { SettingsApp } from './apps/SettingsApp';
import { AboutApp } from './apps/AboutApp';
import type { AppDef } from './osTypes';

/**
 * The Finance OS app registry. Each entry is a real, installable application
 * with its own window: nothing here is aliased, stubbed or duplicated.
 * Apps are single-instance — opening one that's already running focuses it.
 */
export const APPS: AppDef[] = [
  {
    id: 'overview',
    title: { ar: 'غرفة القيادة', fr: 'Cockpit', en: 'Cockpit' },
    desc: { ar: 'مؤشرات مالية حية وإجراءات سريعة', fr: 'Indicateurs financiers en direct', en: 'Live financial signals and quick actions' },
    icon: Gauge,
    tile: 'from-sky-500 to-indigo-600',
    category: 'insight',
    defaultSize: { w: 1020, h: 640 },
    minSize: { w: 640, h: 480 },
    component: OverviewApp,
    showOnDesktop: true,
    pinned: true,
  },
  {
    id: 'journal',
    title: { ar: 'دفتر اليومية', fr: 'Journal', en: 'Journal' },
    desc: { ar: 'تسجيل ومراجعة قيود الأستاذ العام', fr: 'Saisir et valider les écritures', en: 'Record and post general ledger entries' },
    icon: BookOpen,
    tile: 'from-indigo-500 to-violet-600',
    category: 'accounting',
    defaultSize: { w: 1000, h: 640 },
    minSize: { w: 580, h: 420 },
    component: JournalWorkspace,
    showOnDesktop: true,
    pinned: true,
  },
  {
    id: 'ledger',
    title: { ar: 'دليل الحسابات', fr: 'Plan comptable', en: 'Chart of Accounts' },
    desc: { ar: 'إدارة هيكل الحسابات والأرصدة', fr: 'Gérer la hiérarchie des comptes', en: 'Manage account hierarchies and balances' },
    icon: Wallet,
    tile: 'from-emerald-500 to-teal-600',
    category: 'accounting',
    defaultSize: { w: 960, h: 620 },
    minSize: { w: 560, h: 400 },
    component: ChartOfAccounts,
    showOnDesktop: true,
    pinned: false,
  },
  {
    id: 'reconcile',
    title: { ar: 'التسوية البنكية', fr: 'Rapprochement', en: 'Reconciliation' },
    desc: { ar: 'مطابقة كشوف البنك مع قيود الأستاذ', fr: 'Comparer relevés et écritures', en: 'Match bank statements against ledger lines' },
    icon: Scale,
    tile: 'from-purple-500 to-fuchsia-600',
    category: 'accounting',
    defaultSize: { w: 1120, h: 680 },
    minSize: { w: 720, h: 480 },
    component: ReconciliationWorkspace,
    showOnDesktop: true,
    pinned: false,
  },
  {
    id: 'close',
    title: { ar: 'مركز الإقفال', fr: 'Centre de clôture', en: 'Close Center' },
    desc: { ar: 'إجراءات الإقفال الشهري والسنوي', fr: 'Procédures de clôture mensuelle', en: 'Execute period-end procedures' },
    icon: ShieldCheck,
    tile: 'from-rose-500 to-red-600',
    category: 'accounting',
    defaultSize: { w: 900, h: 620 },
    minSize: { w: 560, h: 440 },
    component: CloseCenter,
    showOnDesktop: true,
    pinned: false,
  },
  {
    id: 'planning',
    title: { ar: 'الميزانية', fr: 'Budgets', en: 'Budgets' },
    desc: { ar: 'إعداد الميزانيات وتتبع الانحرافات', fr: 'Définir les budgets, suivre les écarts', en: 'Define budgets and track variance' },
    icon: Target,
    tile: 'from-blue-500 to-cyan-600',
    category: 'planning',
    defaultSize: { w: 1100, h: 680 },
    minSize: { w: 700, h: 480 },
    component: PlanningWorkspace,
    showOnDesktop: false,
    pinned: false,
  },
  {
    id: 'modeling',
    title: { ar: 'النمذجة المالية', fr: 'Modélisation', en: 'Modeling' },
    desc: { ar: 'محاكاة الإسقاطات والهوامش', fr: 'Simuler projections et marges', en: 'Simulate projections and margins' },
    icon: LineChart,
    tile: 'from-amber-500 to-orange-600',
    category: 'planning',
    defaultSize: { w: 1100, h: 680 },
    minSize: { w: 700, h: 480 },
    component: ModelingWorkspace,
    showOnDesktop: true,
    pinned: false,
  },
  {
    id: 'reports',
    title: { ar: 'البيانات المالية', fr: 'États financiers', en: 'Statements' },
    desc: { ar: 'قائمة الدخل والميزانية والتصدير', fr: 'P&L, bilan et export CSV', en: 'P&L, balance sheet and CSV export' },
    icon: PieChart,
    tile: 'from-cyan-500 to-sky-600',
    category: 'insight',
    defaultSize: { w: 1040, h: 660 },
    minSize: { w: 620, h: 460 },
    component: ReportsWorkspace,
    showOnDesktop: true,
    pinned: true,
  },
  {
    id: 'unit',
    title: { ar: 'اقتصاديات الوحدة', fr: 'Économie unitaire', en: 'Unit Economics' },
    desc: { ar: 'ربحية كل مجموعة تشغيلية', fr: 'Rentabilité par groupe', en: 'Profitability per operational group' },
    icon: TrendingUp,
    tile: 'from-lime-500 to-emerald-600',
    category: 'insight',
    defaultSize: { w: 1100, h: 660 },
    minSize: { w: 720, h: 480 },
    component: UnitEconomicsWorkspace,
    showOnDesktop: false,
    pinned: false,
  },
  {
    id: 'treasury',
    title: { ar: 'الخزينة والمخاطر', fr: 'Trésorerie', en: 'Treasury & Risk' },
    desc: { ar: 'المراكز النقدية والضوابط والتعرض للمخاطر', fr: 'Positions de caisse et contrôles', en: 'Cash positions, controls and exposure' },
    icon: Landmark,
    tile: 'from-slate-500 to-slate-700',
    category: 'operations',
    defaultSize: { w: 1100, h: 660 },
    minSize: { w: 720, h: 480 },
    component: TreasuryWorkspace,
    showOnDesktop: true,
    pinned: false,
  },
  {
    id: 'settings',
    title: { ar: 'الإعدادات', fr: 'Réglages', en: 'Settings' },
    desc: { ar: 'المظهر وسطح المكتب والجلسة', fr: 'Apparence, bureau et session', en: 'Appearance, desktop and session' },
    icon: Settings,
    tile: 'from-zinc-500 to-zinc-700',
    category: 'system',
    defaultSize: { w: 720, h: 560 },
    minSize: { w: 520, h: 420 },
    component: SettingsApp,
    showOnDesktop: false,
    pinned: false,
  },
  {
    id: 'about',
    title: { ar: 'حول النظام', fr: 'À propos', en: 'About Finance OS' },
    desc: { ar: 'الإصدار ومعلومات البيئة', fr: "Version et environnement", en: 'Version and environment details' },
    icon: Info,
    tile: 'from-indigo-400 to-blue-500',
    category: 'system',
    defaultSize: { w: 520, h: 480 },
    minSize: { w: 420, h: 380 },
    component: AboutApp,
    showOnDesktop: false,
    pinned: false,
  },
];

export const APP_MAP: Record<string, AppDef> = Object.fromEntries(APPS.map((a) => [a.id, a]));

/** Apps shown in the taskbar dock when not running. */
export const PINNED_APPS = APPS.filter((a) => a.pinned);
/** Apps with a desktop icon. */
export const DESKTOP_APPS = APPS.filter((a) => a.showOnDesktop);

export const CATEGORY_ORDER: { id: AppDef['category']; label: { ar: string; fr: string; en: string }; icon: typeof BarChart3 }[] = [
  { id: 'insight', label: { ar: 'الرؤى', fr: 'Pilotage', en: 'Insight' }, icon: BarChart3 },
  { id: 'accounting', label: { ar: 'المحاسبة', fr: 'Comptabilité', en: 'Accounting' }, icon: BookOpen },
  { id: 'planning', label: { ar: 'التخطيط', fr: 'Planification', en: 'Planning' }, icon: Target },
  { id: 'operations', label: { ar: 'التشغيل', fr: 'Opérations', en: 'Operations' }, icon: Landmark },
  { id: 'system', label: { ar: 'النظام', fr: 'Système', en: 'System' }, icon: Settings },
];
