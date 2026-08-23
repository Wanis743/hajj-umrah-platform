import Select from '@/components/admin/GlassSelect';
import GlassDate from '@/components/admin/GlassDate';
import { RefreshCw } from 'lucide-react';

type ReportFilterProps = {
  t: (ar: string, fr: string, en: string) => string;
  reportType: string;
  setReportType: (v: string) => void;
  from: string | null;
  setFrom: (v: string) => void;
  to: string | null;
  setTo: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  statusOptions: string[];
  REPORT_TYPES: { id: string; ar: string; fr: string; en: string }[];
  setPage: (v: number) => void;
  setSortKey: (v: string | null) => void;
};
export function ReportFilters({
  t, reportType, setReportType, from, setFrom, to, setTo, statusFilter, setStatusFilter, statusOptions, REPORT_TYPES, setPage, setSortKey
}: ReportFilterProps) {
  const inputCls = 'input';
  return (
    <div className="card p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
            {t('نوع التقرير', 'Type', 'Report type')}
          </label>
          <Select
            value={reportType}
            onChange={e => { setReportType(e.target.value); setPage(1); setSortKey(''); setStatusFilter('ALL'); }}
            className={inputCls}
          >
            {REPORT_TYPES.map((rt: { id: string; ar: string; fr: string; en: string }) => (
              <option key={rt.id} value={rt.id}>{t(rt.ar, rt.fr, rt.en)}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
            {t('من', 'Du', 'From')}
          </label>
          <GlassDate value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
            {t('إلى', 'Au', 'To')}
          </label>
          <GlassDate value={to} onChange={e => { setTo(e.target.value); setPage(1); }} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 uppercase tracking-wider">
            {t('الحالة', 'Statut', 'Status')}
          </label>
          <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className={inputCls}>
            {statusOptions.map((s: string) => <option key={s} value={s}>{s === 'ALL' ? t('الكل', 'Tous', 'All') : s}</option>)}
          </Select>
        </div>
      </div>
      {(from || to || statusFilter !== 'ALL') && (
        <button
          onClick={() => { setFrom(''); setTo(''); setStatusFilter('ALL'); setPage(1); }}
          className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          {t('مسح التصفية', 'Effacer les filtres', 'Clear filters')}
        </button>
      )}
    </div>
  );
}