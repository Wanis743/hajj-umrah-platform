import { useMemo } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import type { DashboardSnapshot } from '@/types/dashboard';
import {
  Activity, AlertTriangle, ShieldAlert, Wallet, Users, CalendarClock,
  Building2, FileWarning, CheckCircle2, TrendingUp, ArrowUpRight,
} from 'lucide-react';

type AnalyticsRow = Record<string, unknown>;

interface InsightsProps {
  pilgrims?: AnalyticsRow[];
  bookings?: AnalyticsRow[];
  groups?: AnalyticsRow[];
  visas?: AnalyticsRow[];
  payments?: AnalyticsRow[];
  hotels?: AnalyticsRow[];
  flights?: AnalyticsRow[];
  buses?: AnalyticsRow[];
  camps?: AnalyticsRow[];
  incidents?: AnalyticsRow[];
  reservations?: AnalyticsRow[];
  alerts?: AnalyticsRow[];
  leads?: AnalyticsRow[];
  packages?: AnalyticsRow[];
  guides?: AnalyticsRow[];
  documents?: AnalyticsRow[];
  suppliers?: AnalyticsRow[];
  executiveSnapshot?: DashboardSnapshot | null;
}

const stringValue = (row: AnalyticsRow, key: string) => typeof row[key] === 'string' ? row[key] as string : '';
const numberValue = (row: AnalyticsRow, key: string) => typeof row[key] === 'number' ? row[key] as number : Number(row[key] ?? 0);


export default function DataInsights(props: InsightsProps) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const {
    groups = [], hotels = [], buses = [], incidents = [],
    reservations = [], alerts = [], leads = [], packages = [],
    executiveSnapshot = null,
  } = props;

  const insights = useMemo(() => {
    type Insight = { severity: 'info' | 'good' | 'warn' | 'bad'; title: string; detail: string };

    const list: Insight[] = [];

    // Revenue & collection
    const collectedDZD = executiveSnapshot?.executive.collected_dzd ?? 0;
    const totalDZD = executiveSnapshot?.executive.revenue_dzd ?? 0;
    const rate = totalDZD > 0 ? (collectedDZD / totalDZD) * 100 : 0;
    list.push({
      severity: rate >= 80 ? 'good' : rate >= 50 ? 'info' : 'warn',
      title: t('معدل التحصيل المالي', 'Taux de recouvrement', 'Collection rate'),
      detail: t(
        `${collectedDZD.toLocaleString()} دج محصلة من أصل ${totalDZD.toLocaleString()} دج (${rate.toFixed(0)}%)`,
        `${collectedDZD.toLocaleString()} DZD collectés sur ${totalDZD.toLocaleString()} DZD (${rate.toFixed(0)}%)`,
        `${collectedDZD.toLocaleString()} DZD collected of ${totalDZD.toLocaleString()} DZD (${rate.toFixed(0)}%)`,
      ),
    });

    // Group readiness
    const weakGroups = executiveSnapshot?.groups_at_risk?.filter((g) => Number(g.readiness_score || 0) < 70) ?? [];
    if (weakGroups.length > 0) {
      list.push({
        severity: 'warn',
        title: t('مجموعات تحتاج متابعة', 'Groupes à surveiller', 'Groups needing attention'),
        detail: t(
          `${weakGroups.length} مجموعة في طور التشكيل بنسبة جاهزية أقل من 70%`,
          `${weakGroups.length} groupes en formation avec une préparation < 70%`,
          `${weakGroups.length} forming group(s) below 70% readiness`,
        ),
      });
    }

    // Visa pipeline
    const approved = executiveSnapshot?.operations?.visa_cleared ?? 0;
    const totalVisas = executiveSnapshot?.operations?.visa_total ?? 0;
    if (totalVisas > 0) {
      list.push({
        severity: approved / totalVisas >= 0.8 ? 'good' : 'info',
        title: t('تقدم ملفات التأشيرات', 'Avancement des visas', 'Visa pipeline'),
        detail: t(
          `${approved} تأشيرة صادرة أو مقبولة من أصل ${totalVisas}`,
          `${approved} visas émis ou approuvés sur ${totalVisas}`,
          `${approved} of ${totalVisas} visas approved or issued`,
        ),
      });
    }

    // Pending reservations
    const pending = reservations.filter((r) => stringValue(r, 'status') !== 'confirmed').length;
    if (pending > 0) {
      list.push({
        severity: 'info',
        title: t('طلبات حجز بانتظار التأكيد', 'Demandes en attente', 'Pending reservation requests'),
        detail: t(
          `${pending} طلب حجز جديد يحتاج معالجة`,
          `${pending} nouvelles demandes à traiter`,
          `${pending} reservation request(s) awaiting action`,
        ),
      });
    }

    // Hotel occupancy
    const occupied = hotels.reduce((sum: number, h) => sum + (numberValue(h, 'total_rooms') - numberValue(h, 'available_rooms')), 0);
    const rooms = hotels.reduce((sum: number, h) => sum + numberValue(h, 'total_rooms'), 0);
    if (rooms > 0) {
      const occRate = (occupied / rooms) * 100;
      list.push({
        severity: occRate >= 85 ? 'warn' : occRate >= 50 ? 'info' : 'good',
        title: t('إشغال الفنادق', 'Occupation hôtelière', 'Hotel occupancy'),
        detail: t(
          `${occupied} غرفة مشغولة من أصل ${rooms} (${occRate.toFixed(0)}%)`,
          `${occupied} chambres occupées sur ${rooms} (${occRate.toFixed(0)}%)`,
          `${occupied} of ${rooms} rooms occupied (${occRate.toFixed(0)}%)`,
        ),
      });
    }

    // Transport maintenance
    const inMaintenance = buses.filter((b) => stringValue(b, 'status') === 'MAINTENANCE').length;
    if (inMaintenance > 0) {
      list.push({
        severity: 'warn',
        title: t('حافلات في الصيانة', 'Bus en maintenance', 'Buses in maintenance'),
        detail: t(
          `${inMaintenance} حافلة خارج الخدمة — راجع جدول الصيانة`,
          `${inMaintenance} bus hors service — vérifiez le planning`,
          `${inMaintenance} bus(es) out of service — check maintenance schedule`,
        ),
      });
    }

    // Open incidents
    const openIncidents = incidents.filter((i) => !['RESOLVED', 'CLOSED'].includes(stringValue(i, 'status'))).length;
    if (openIncidents > 0) {
      list.push({
        severity: openIncidents >= 3 ? 'bad' : 'warn',
        title: t('حوادث مفتوحة', 'Incidents ouverts', 'Open incidents'),
        detail: t(
          `${openIncidents} حادث قيد المعالجة`,
          `${openIncidents} incidents en cours`,
          `${openIncidents} incident(s) in progress`,
        ),
      });
    }

    // Top package by actual booking count from the scoped accounting snapshot
    const packagePerformance = executiveSnapshot?.package_profitability ?? [];
    if (packagePerformance.length > 0) {
      const top = [...packagePerformance].sort((a, b) => Number(b.bookings || 0) - Number(a.bookings || 0))[0];
      list.push({
        severity: 'good',
        title: t('الباقة الأكثر طلباً', 'Forfait le plus demandé', 'Top package by bookings'),
        detail: t(`${top.name} — ${Number(top.bookings || 0)} حجوزات`, `${top.name} — ${Number(top.bookings || 0)} réservations`, `${top.name} — ${Number(top.bookings || 0)} bookings`),
      });
    }

    // Lead conversion from the scoped executive snapshot
    if ((executiveSnapshot?.sales?.leads_total ?? 0) > 0) {
      const converted = executiveSnapshot?.sales?.leads_converted ?? 0;
      const convRate = executiveSnapshot?.sales?.conversion_rate ?? 0;
      list.push({
        severity: convRate >= 30 ? 'good' : 'info',
        title: t('تحويل العملاء المحتملين', 'Conversion des leads', 'Lead conversion'),
        detail: t(
          `${converted} من أصل ${executiveSnapshot?.sales?.leads_total ?? 0} عميل محتمل تم تحويلهم (${convRate.toFixed(0)}%)`,
          `${converted} de ${executiveSnapshot?.sales?.leads_total ?? 0} leads convertis (${convRate.toFixed(0)}%)`,
          `${converted} of ${executiveSnapshot?.sales?.leads_total ?? 0} leads converted (${convRate.toFixed(0)}%)`,
        ),
      });
    }

    // Alerts from system
    (executiveSnapshot?.alerts ?? alerts).slice(0, 3).forEach((a) => {
      list.push({
        severity: String(a.severity ?? '').toUpperCase() === 'CRITICAL' ? 'bad' : String(a.severity ?? '').toUpperCase() === 'WARNING' ? 'warn' : 'info',
        title: t('تنبيه النظام', 'Alerte système', 'System alert'),
        detail: String(a.message ?? ''),
      });
    });

    return list;
  }, [t, groups, hotels, buses, incidents, reservations, alerts, leads, packages, executiveSnapshot]);

  const summary = useMemo(() => {
    return [
      { icon: Wallet, label: t('إيرادات محصلة', 'Collecté', 'Collected'), value: `${Number(executiveSnapshot?.executive.collected_dzd ?? 0).toLocaleString()} دج`, color: 'text-brand-500 bg-brand-500/10' },
      { icon: Users, label: t('إجمالي الحجاج', 'Pèlerins', 'Pilgrims'), value: String(executiveSnapshot?.executive.pilgrims ?? 0), color: 'text-[var(--accent)] bg-[var(--accent-soft)]' },
      { icon: ShieldAlert, label: t('تأشيرات صادرة', 'Visas émis', 'Visas issued'), value: String(executiveSnapshot?.operations?.visa_cleared ?? 0), color: 'text-blue-500 bg-blue-500/10' },
      { icon: CalendarClock, label: t('مواعيد دفع قادمة', 'Échéances à venir', 'Upcoming due'), value: String(executiveSnapshot?.upcoming?.payment_deadlines ?? 0), color: 'text-amber-500 bg-amber-500/10' },
      { icon: AlertTriangle, label: t('حوادث مفتوحة', 'Incidents', 'Open incidents'), value: String(executiveSnapshot?.operations?.incidents_active ?? 0), color: 'text-rose-500 bg-rose-500/10' },
      { icon: TrendingUp, label: t('عملاء محتملون', 'Leads', 'Leads'), value: String(executiveSnapshot?.sales?.leads_total ?? 0), color: 'text-purple-500 bg-purple-500/10' },
    ];
  }, [t, executiveSnapshot]);

  const severityStyle = (s: string) =>
    s === 'good' ? 'border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]' :
    s === 'warn' ? 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400' :
    s === 'bad' ? 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400' :
    'border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]';

  const sevIcon = (s: string) =>
    s === 'good' ? <CheckCircle2 className="h-4 w-4" /> :
    s === 'warn' ? <AlertTriangle className="h-4 w-4" /> :
    s === 'bad' ? <FileWarning className="h-4 w-4" /> :
    <Activity className="h-4 w-4" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-md bg-brand-500/10 flex items-center justify-center">
          <Activity className="h-5 w-5 text-brand-500" />
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-[var(--text-secondary)] dark:text-white">
            {t('الرؤى الذكية', 'Insights', 'Insights')}
          </h2>
          <p className="text-[13px] text-[var(--text-muted)]">
            {t('مؤشرات محسوبة مباشرة من بياناتك المباشرة', 'Indicateurs calculés depuis vos données réelles', 'Metrics computed live from your real data')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {summary.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card p-4">
              <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${s.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="mt-2.5 text-lg font-semibold text-[var(--text-secondary)] dark:text-white truncate">{s.value}</p>
              <p className="text-[11px] font-medium text-[var(--text-secondary)] dark:text-[var(--text-secondary)] truncate">{s.label}</p>
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] dark:text-white">
            {t('أهم الملاحظات', 'Observations clés', 'Key observations')}
          </h3>
        </div>
        {insights.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
              {t('لا توجد بيانات كافية بعد لاستخلاص رؤى', 'Pas assez de données pour générer des insights', 'Not enough data to generate insights yet')}
            </p>
          </div>
        ) : (
          insights.map((ins, i) => (
            <div key={i} className={`rounded-lg border p-4 flex items-start gap-3 ${severityStyle(ins.severity)}`}>
              <span className="mt-0.5 shrink-0">{sevIcon(ins.severity)}</span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold">{ins.title}</p>
                <p className="text-xs mt-0.5 opacity-90 break-words">{ins.detail}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card p-4 flex items-start gap-3">
        <Building2 className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" />
        <p className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] leading-relaxed">
          {t('هذه الرؤى مشتقة من جداول نظامك المباشرة (المدفوعات، الحجوزات، المجموعات، التأشيرات، الفنادق، الحافلات، الحوادث...). يتم تحديثها تلقائياً عند تغيّر أي بيانات.', 'Ces insights sont dérivés de vos tables réelles (paiements, réservations, groupes, visas, hôtels, bus, incidents...). Ils se mettent à jour automatiquement.', 'These insights are derived from your live tables (payments, bookings, groups, visas, hotels, buses, incidents...). They refresh automatically.')}
        </p>
      </div>
    </div>
  );
}
