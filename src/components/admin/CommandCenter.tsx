import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Database, FileWarning, Plane, ShieldAlert, Users, Stethoscope } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import type { DashboardFilters, DashboardRealtimeStatus, DashboardSnapshot } from '@/types/dashboard';
import { DrilldownSheet } from './workspaces/DrilldownSheet';
import { GroupWorkspaceSheet } from './workspaces/GroupWorkspaceSheet';
import { InvoiceWorkspaceSheet } from './workspaces/InvoiceWorkspaceSheet';
import { BookingWorkspaceSheet } from './workspaces/BookingWorkspaceSheet';
import { PilgrimProfile360 } from './PilgrimProfile360';
interface CommandCenterProps {
  snapshot: DashboardSnapshot | null;
  filters: DashboardFilters;
  onFiltersChange: (filters: DashboardFilters) => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
  realtimeStatus: DashboardRealtimeStatus;
}
const money = (value: number, currency: string) => {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  const formatted = abs >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)}B` : abs >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : abs >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : Math.round(n).toLocaleString();
  return `${formatted} ${currency}`;
};
export default function CommandCenter({ snapshot, onNavigate }: CommandCenterProps) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const executive = snapshot?.executive;
  const operations = snapshot?.operations;
  const health = snapshot?.data_health;
  const updated = snapshot?.generated_at ? new Date(snapshot.generated_at) : null;
  const liveAge = updated ? Math.max(0, Math.floor((Date.now() - updated.getTime()) / 1000)) : null;
  const [drilldown, setDrilldown] = useState<{ title: string; metric: string; rows: Record<string, string | number | boolean | null | undefined>[] } | null>(null);

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [activePilgrimId, setActivePilgrimId] = useState<string | null>(null);

  const handleRowClick = (row: Record<string, unknown>) => {
    if (!drilldown) return;
    const { metric } = drilldown;
    if (metric === 'GROUP_READINESS') setActiveGroupId(String(row.id));
    else if (metric === 'AT_RISK_RECEIVABLES') setActiveInvoiceId(String(row.id));
    else if (metric === 'ACTIVE_PILGRIMS') setActivePilgrimId(String(row.id));
    // You can add more metric routing here
  };
  const closeDrilldown = () => setDrilldown(null);
  const attention = useMemo(() => {
    if (!snapshot) return [] as Array<{ severity: 'critical'|'warning'|'info'; title: string; desc: string; action: string; count: number }>;
    const items: Array<{ severity: 'critical'|'warning'|'info'; title: string; desc: string; action: string; count: number }> = [];
    if (operations?.incidents_critical) items.push({ severity: 'critical', title: t('حوادث حرجة', 'Incidents critiques', 'Critical incidents'), desc: `${operations.incidents_critical}`, action: 'incidents', count: operations.incidents_critical });
    if (snapshot.upcoming.overdue_payments) items.push({ severity: 'critical', title: t('فواتير متأخرة', 'Factures en retard', 'Overdue invoices'), desc: `${snapshot.upcoming.overdue_payments}`, action: 'financials', count: snapshot.upcoming.overdue_payments });
    if (operations?.alerts_pending) items.push({ severity: 'warning', title: t('تنبيهات غير معالجة', 'Alertes non traitées', 'Unacknowledged alerts'), desc: `${operations.alerts_pending}`, action: 'alerts', count: operations.alerts_pending });
    if ((executive?.visa_clearance_rate ?? 100) < 80 && (operations?.visa_total ?? 0) > 0) items.push({ severity: 'warning', title: t('التأشيرات دون الهدف', 'Visas sous cible', 'Visa clearance below target'), desc: `${executive?.visa_clearance_rate ?? 0}%`, action: 'visas', count: Math.round(executive?.visa_clearance_rate ?? 0) });
    if (operations?.flights_delayed) items.push({ severity: 'warning', title: t('رحلات متأخرة', 'Vols retardés', 'Delayed flights'), desc: `${operations.flights_delayed}`, action: 'flights', count: operations.flights_delayed });
    if (snapshot.groups_at_risk.length) items.push({ severity: 'warning', title: t('مجموعات معرضة للخطر', 'Groupes à risque', 'Groups at risk'), desc: `${snapshot.groups_at_risk.length}`, action: 'groups', count: snapshot.groups_at_risk.length });
    return items.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return 1;
      return b.count - a.count;
    });
  }, [snapshot, operations, executive, t]);
    return <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
    
    
    <section><div className="flex items-center justify-between mb-3"><h2 className="section-head mb-0">{t('يتطلب تدخلك الآن', 'Attention requise', 'Attention Required')}</h2><button onClick={() => onNavigate('alerts')} className="text-xs text-[var(--text-muted)]">{t('عرض الكل', 'Voir tout', 'View all')}</button></div>{attention.length === 0 ? <div className="card p-5 text-sm text-[var(--text-muted)] flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{t('لا توجد عناصر حرجة حالياً', 'Aucun élément critique', 'No critical items')}</div> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{attention.map(item => <button key={`${item.action}-${item.title}`} onClick={() => onNavigate(item.action)} className={`card p-4 text-start border ${item.severity === 'critical' ? 'border-rose-500/30' : item.severity === 'warning' ? 'border-amber-500/30' : 'border-[var(--border)]'}`}><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center">{item.severity === 'critical' ? <AlertTriangle className="h-4 w-4 text-rose-500" /> : <ShieldAlert className="h-4 w-4 text-amber-500" />}</div><div className="min-w-0 flex-1"><p className="font-medium text-sm text-[var(--text-primary)]">{item.title}</p><p className="text-xs text-[var(--text-muted)]">{item.desc}</p></div><ChevronRight className="h-4 w-4 text-[var(--text-muted)]" /></div></button>)}</div>}</section>
    
    
    
    {snapshot?.health_scores && snapshot.health_scores.length > 0 && (
      <section className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Stethoscope className="h-4 w-4 text-[var(--text-muted)]" />
          <h2 className="section-head mb-0">{t('صحة الوكالة', 'Santé agence', 'Agency Health')}</h2>
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
            LIVE
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {snapshot.health_scores.map(hs => {
            const score = hs.score ?? 0;
            const label = isAr ? hs.nameAr : isFr ? hs.nameFr : hs.nameEn;
            const levelColor = hs.level === 'EXCELLENT' ? 'bg-emerald-500' : hs.level === 'GOOD' ? 'bg-blue-500' : hs.level === 'WARNING' ? 'bg-amber-500' : 'bg-rose-500';
            const textColor = hs.level === 'EXCELLENT' ? 'text-emerald-600 dark:text-emerald-400' : hs.level === 'GOOD' ? 'text-blue-600 dark:text-blue-400' : hs.level === 'WARNING' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
            return (
              <div key={hs.id} className="rounded-lg bg-[var(--bg-hover)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-[var(--text-primary)] truncate">{label}</p>
                  <span className={`text-sm font-bold tabular-nums ${textColor}`}>{score}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${levelColor}`} style={{ width: `${score}%` }} />
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">{hs.level}</p>
              </div>
            );
          })}
        </div>
      </section>
    )}
    
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <section className="card p-5"><div className="flex items-center gap-2 mb-4"><ShieldAlert className="h-4 w-4" /><h2 className="section-head mb-0">{t('أضعف المجموعات', 'Groupes les plus faibles', 'Lowest Readiness Groups')}</h2></div><div className="space-y-2">{(snapshot?.groups_at_risk || []).slice(0,6).map(g => <button key={g.code} onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('open-workspace', { detail: { type: 'group', id: (g as { id?: string }).id || g.code } })); }} className="w-full flex items-center justify-between p-2 rounded-lg bg-[var(--bg-hover)] text-start"><span><span className="font-medium text-sm">{g.code}</span><span className="text-xs text-[var(--text-muted)] ml-2">{g.current_capacity}/{g.max_capacity}</span></span><span className={Number(g.readiness_score) < 60 ? 'text-rose-500 font-semibold' : 'text-amber-500 font-semibold'}>{Math.round(Number(g.readiness_score))}%</span></button>)}</div></section>
      <section className="card p-5"><div className="flex items-center gap-2 mb-4"><Plane className="h-4 w-4" /><h2 className="section-head mb-0">{t('الأيام السبعة القادمة', '7 prochains jours', 'Next 7 Days')}</h2></div><div className="grid grid-cols-3 gap-3 text-center text-sm"><div><Plane className="h-4 w-4 mx-auto mb-1"/><b>{snapshot?.upcoming.flights ?? 0}</b><p className="text-xs text-[var(--text-muted)]">Flights</p></div><div><Users className="h-4 w-4 mx-auto mb-1"/><b>{snapshot?.upcoming.groups ?? 0}</b><p className="text-xs text-[var(--text-muted)]">Groups</p></div><div><FileWarning className="h-4 w-4 mx-auto mb-1"/><b>{snapshot?.upcoming.payment_deadlines ?? 0}</b><p className="text-xs text-[var(--text-muted)]">Due</p></div></div></section>
      <section className="card p-5"><div className="flex items-center gap-2 mb-4"><Database className="h-4 w-4" /><h2 className="section-head mb-0">{t('ثقة البيانات', 'Confiance des données', 'Data Trust')}</h2></div><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-[var(--text-muted)]">Health Score</p><p className="text-lg font-semibold">{Number(health?.score ?? 0).toFixed(1)}%</p></div><div><p className="text-xs text-[var(--text-muted)]">Accounting unattributed</p><p className="font-semibold">{money((snapshot?.accounting_trust.unattributed_revenue_dzd ?? 0)+(snapshot?.accounting_trust.unattributed_expenses_dzd ?? 0),'DZD')}</p></div><div><p className="text-xs text-[var(--text-muted)]">Overdue</p><p className="font-semibold">{money(executive?.at_risk_receivables_dzd ?? 0,'DZD')}</p></div><div><p className="text-xs text-[var(--text-muted)]">Snapshot</p><p className="font-semibold">{liveAge == null ? '—' : `${liveAge}s`}</p></div></div></section>
    </div>
    
    <DrilldownSheet 
      isOpen={!!drilldown} 
      onClose={closeDrilldown} 
      data={drilldown}
      onRowClick={handleRowClick}
    />

    <GroupWorkspaceSheet groupId={activeGroupId} onClose={() => setActiveGroupId(null)} />
    <InvoiceWorkspaceSheet invoiceId={activeInvoiceId} onClose={() => setActiveInvoiceId(null)} />
    <BookingWorkspaceSheet bookingId={activeBookingId} onClose={() => setActiveBookingId(null)} />
    <PilgrimProfile360 pilgrimId={activePilgrimId} onClose={() => setActivePilgrimId(null)} />
  </div>;
}