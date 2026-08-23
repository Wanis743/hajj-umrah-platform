
import React, { useMemo, useState, useCallback } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { FileBarChart, Download, Printer, FileJson, Filter } from 'lucide-react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { ReportFilters } from './ReportFilters';
import { ReportTable } from './ReportTable';
import type { Database } from '@/types/database';

type ReportType = 'FINANCIAL' | 'PILGRIMS' | 'BOOKINGS' | 'RESERVATIONS' | 'GROUPS' | 'VISA';
type SortDir = 'asc' | 'desc';

interface ColumnDef {
  key: string;
  labelAr: string;
  labelFr: string;
  labelEn: string;
  get: (r: Record<string, unknown>) => string | number;
  numeric?: boolean;
  badge?: (val: string) => string;
}

const PAGE_SIZE = 50;

const visaBadge = (v: string) =>
  v === 'ISSUED' || v === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
  : v === 'REJECTED' || v === 'CANCELLED' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400'
  : v === 'SUBMITTED' || v === 'PROCESSING' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';

const payBadge = (v: string) =>
  v === 'PAID' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
  : v === 'PARTIAL' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
  : 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';

const bookBadge = (v: string) =>
  v === 'CONFIRMED' || v === 'PAID' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
  : v === 'CANCELLED' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400'
  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';

const COLS: Record<ReportType, ColumnDef[]> = {
  FINANCIAL: [
    { key: 'ref',    labelAr: 'المرجع',     labelFr: 'Réf',        labelEn: 'Reference',   get: r => String(r['reference'] || r['id'] || '—') },
    { key: 'method', labelAr: 'الطريقة',    labelFr: 'Méthode',    labelEn: 'Method',      get: r => String(r['method'] || '—') },
    { key: 'status', labelAr: 'الحالة',     labelFr: 'Statut',     labelEn: 'Status',      get: r => String(r['status'] || 'PENDING'), badge: payBadge },
    { key: 'dzd',    labelAr: 'المبلغ DZD', labelFr: 'Montant DZD',labelEn: 'Amount DZD',  get: r => Number(r['amount_dzd'] || 0), numeric: true },
    { key: 'sar',    labelAr: 'المبلغ SAR', labelFr: 'Montant SAR',labelEn: 'Amount SAR',  get: r => Number(r['amount_sar'] || 0), numeric: true },
    { key: 'date',   labelAr: 'التاريخ',    labelFr: 'Date',       labelEn: 'Date',        get: r => { const d = String(r['received_at'] || r['created_at'] || ''); return d ? new Date(d).toLocaleDateString() : '—'; } },
  ],
  PILGRIMS: [
    { key: 'name',    labelAr: 'الاسم',        labelFr: 'Nom',         labelEn: 'Name',     get: r => String(r['full_name'] || r['full_name_ar'] || '—') },
    { key: 'passport',labelAr: 'الجواز',       labelFr: 'Passeport',   labelEn: 'Passport', get: r => String(r['passport_number'] || '—') },
    { key: 'phone',   labelAr: 'الهاتف',       labelFr: 'Téléphone',   labelEn: 'Phone',    get: r => String(r['phone'] || '—') },
    { key: 'visa',    labelAr: 'التأشيرة',     labelFr: 'Visa',        labelEn: 'Visa',     get: r => String(r['visa_status'] || '—'), badge: visaBadge },
    { key: 'payment', labelAr: 'الدفع',        labelFr: 'Paiement',    labelEn: 'Payment',  get: r => String(r['payment_status'] || '—'), badge: payBadge },
    { key: 'wilaya',  labelAr: 'الولاية',      labelFr: 'Wilaya',      labelEn: 'Wilaya',   get: r => String(r['wilaya'] || '—') },
    { key: 'gender',  labelAr: 'الجنس',        labelFr: 'Sexe',        labelEn: 'Gender',   get: r => String(r['gender'] || '—') },
    { key: 'created', labelAr: 'الإنشاء',      labelFr: 'Créé le',     labelEn: 'Created',  get: r => { const d = String(r['created_at'] || ''); return d ? new Date(d).toLocaleDateString() : '—'; } },
  ],
  BOOKINGS: [
    { key: 'ref',     labelAr: 'الرقم',       labelFr: 'Réf',          labelEn: 'Reference', get: r => String(r['booking_reference'] || r['id']?.toString().slice(0,8) || '—') },
    { key: 'status',  labelAr: 'الحالة',      labelFr: 'Statut',       labelEn: 'Status',    get: r => String(r['status'] || '—'), badge: bookBadge },
    { key: 'totDzd',  labelAr: 'الإجمالي DZD',labelFr: 'Total DZD',   labelEn: 'Total DZD', get: r => Number(r['total_dzd'] || 0), numeric: true },
    { key: 'paidDzd', labelAr: 'المدفوع DZD', labelFr: 'Payé DZD',    labelEn: 'Paid DZD',  get: r => Number(r['paid_dzd'] || 0), numeric: true },
    { key: 'paidSar', labelAr: 'المدفوع SAR', labelFr: 'Payé SAR',    labelEn: 'Paid SAR',  get: r => Number(r['paid_sar'] || 0), numeric: true },
    { key: 'created', labelAr: 'التاريخ',     labelFr: 'Date',         labelEn: 'Date',      get: r => { const d = String(r['created_at'] || ''); return d ? new Date(d).toLocaleDateString() : '—'; } },
  ],
  RESERVATIONS: [
    { key: 'ref',     labelAr: 'المرجع',     labelFr: 'Réf',          labelEn: 'Reference', get: r => String(r['reference'] || r['id']?.toString().slice(0,8) || '—') },
    { key: 'name',    labelAr: 'الاسم',      labelFr: 'Nom',          labelEn: 'Name',      get: r => String(r['name'] || '—') },
    { key: 'package', labelAr: 'الباقة',     labelFr: 'Forfait',      labelEn: 'Package',   get: r => String(r['package_name'] || '—') },
    { key: 'travelers',labelAr: 'مسافرون',   labelFr: 'Voyageurs',    labelEn: 'Travelers', get: r => Number(r['travelers'] || 0), numeric: true },
    { key: 'status',  labelAr: 'الحالة',     labelFr: 'Statut',       labelEn: 'Status',    get: r => String(r['status'] || '—') },
    { key: 'phone',   labelAr: 'الهاتف',     labelFr: 'Téléphone',    labelEn: 'Phone',     get: r => String(r['phone'] || '—') },
    { key: 'created', labelAr: 'التاريخ',    labelFr: 'Date',         labelEn: 'Date',      get: r => { const d = String(r['created_at'] || ''); return d ? new Date(d).toLocaleDateString() : '—'; } },
  ],
  GROUPS: [
    { key: 'code',     labelAr: 'الرمز',      labelFr: 'Code',         labelEn: 'Code',      get: r => String(r['code'] || '—') },
    { key: 'name',     labelAr: 'الاسم',      labelFr: 'Nom',          labelEn: 'Name',      get: r => String(r['name'] || '—') },
    { key: 'status',   labelAr: 'الحالة',     labelFr: 'Statut',       labelEn: 'Status',    get: r => String(r['status'] || '—') },
    { key: 'capacity', labelAr: 'الطاقة',     labelFr: 'Capacité',     labelEn: 'Capacity',  get: r => Number(r['max_capacity'] || 0), numeric: true },
    { key: 'depart',   labelAr: 'المغادرة',   labelFr: 'Départ',       labelEn: 'Departure', get: r => String(r['departure_date'] || '—') },
    { key: 'return',   labelAr: 'العودة',      labelFr: 'Retour',       labelEn: 'Return',    get: r => String(r['return_date'] || '—') },
  ],
  VISA: [
    { key: 'pilgrim',  labelAr: 'الحاج',       labelFr: 'Pèlerin',      labelEn: 'Pilgrim',   get: r => String(r['pilgrim_name'] || r['full_name'] || '—') },
    { key: 'passport', labelAr: 'الجواز',      labelFr: 'Passeport',    labelEn: 'Passport',  get: r => String(r['passport_number'] || '—') },
    { key: 'status',   labelAr: 'حالة التأشيرة',labelFr: 'Statut visa', labelEn: 'Visa Status',get: r => String(r['visa_status'] || r['status'] || '—'), badge: visaBadge },
    { key: 'type',     labelAr: 'النوع',        labelFr: 'Type',         labelEn: 'Type',      get: r => String(r['visa_type'] || r['type'] || '—') },
    { key: 'issued',   labelAr: 'تاريخ الإصدار',labelFr: 'Date émission',labelEn: 'Issued',   get: r => String(r['issued_at'] || r['updated_at'] || '—') },
  ],
};

const REPORT_TYPES: Array<{ id: ReportType; ar: string; fr: string; en: string; table: keyof Database['public']['Tables']; dateField: string; statusField: string; statusValues: string[] }> = [
  { id: 'FINANCIAL',    ar: 'مالي',              fr: 'Financier',       en: 'Financial',    table: 'payments',    dateField: 'created_at', statusField: 'status', statusValues: ['PENDING', 'PAID', 'PARTIAL', 'CANCELLED'] },
  { id: 'PILGRIMS',     ar: 'الحجاج',            fr: 'Pèlerins',        en: 'Pilgrims',     table: 'pilgrims',    dateField: 'created_at', statusField: 'visa_status', statusValues: ['PENDING', 'PROCESSING', 'ISSUED', 'REJECTED'] },
  { id: 'BOOKINGS',     ar: 'تأكيدات الحجز',      fr: 'Réservations',    en: 'Bookings',     table: 'bookings',    dateField: 'created_at', statusField: 'status', statusValues: ['DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED'] },
  { id: 'RESERVATIONS', ar: 'طلبات الحجز',        fr: 'Demandes',        en: 'Reservations', table: 'reservations',dateField: 'created_at', statusField: 'status', statusValues: ['NEW', 'CONTACTED', 'CONFIRMED', 'REJECTED'] },
  { id: 'GROUPS',       ar: 'الأفواج',            fr: 'Groupes',         en: 'Groups',       table: 'groups',      dateField: 'created_at', statusField: 'status', statusValues: ['PLANNING', 'OPEN', 'FULL', 'DEPARTED', 'RETURNED'] },
  { id: 'VISA',         ar: 'التأشيرات',          fr: 'Visas',           en: 'Visas',        table: 'visas',       dateField: 'created_at', statusField: 'status', statusValues: ['ALL', 'ISSUED', 'PENDING', 'REJECTED'] },
];

export default function ReportBuilder() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const colLabel = (c: ColumnDef) => isAr ? c.labelAr : isFr ? c.labelFr : c.labelEn;

  const [reportType, setReportType] = useState<ReportType>('FINANCIAL');
  const [from, setFrom]   = useState('');
  const [to, setTo]       = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortKey, setSortKey]   = useState('');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');
  const [page, setPage]         = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const currentDef = REPORT_TYPES.find(r => r.id === reportType)!;

  const { data: rawSource, loading, totalCount } = useSupabaseData<Record<string, unknown>>({ 
    table: currentDef.table,
    orderBy: { column: sortKey || 'created_at', ascending: sortDir === 'asc' },
    filter: statusFilter !== 'ALL' ? { column: currentDef.statusField, value: statusFilter } : undefined,
    dateRange: from || to ? { column: currentDef.dateField, from, to } : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    fallbackData: [] 
  });

  const statusOptions = ['ALL', ...currentDef.statusValues];

  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / PAGE_SIZE));

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  };

  const measures = useMemo(() => {
    const count = rawSource.length;
    const sumDzd = rawSource.reduce((s, r) => s + Number(r['amount_dzd'] || r['paid_dzd'] || r['total_dzd'] || 0), 0);
    const sumSar = rawSource.reduce((s, r) => s + Number(r['amount_sar'] || r['paid_sar'] || 0), 0);
    const travelers = rawSource.reduce((s, r) => s + Number(r['travelers'] || 0), 0);
    const capacity  = rawSource.reduce((s, r) => s + Number(r['max_capacity'] || 0), 0);
    const paidCount = rawSource.filter(r => String(r['status'] || r['payment_status'] || r['visa_status'] || '') === 'PAID' || String(r['visa_status'] || '') === 'ISSUED').length;
    return { count, sumDzd, sumSar, travelers, capacity, paidCount, rate: count > 0 ? Math.round((paidCount / count) * 100) : 0 };
  }, [rawSource]);

  const kpis = useMemo(() => {
    if (reportType === 'FINANCIAL') return [
      { label: t('السجلات', 'Enregistrements', 'Records'), value: (totalCount || 0).toLocaleString() },
      { label: t('إجمالي DZD', 'Total DZD', 'Total DZD'), value: measures.sumDzd.toLocaleString() },
      { label: t('إجمالي SAR', 'Total SAR', 'Total SAR'), value: measures.sumSar.toLocaleString() },
      { label: t('نسبة المدفوع', 'Taux payé', 'Paid Rate'), value: measures.rate + '%' },
    ];
    if (reportType === 'PILGRIMS') return [
      { label: t('إجمالي الحجاج', 'Total pèlerins', 'Total Pilgrims'), value: (totalCount || 0).toLocaleString() },
      { label: t('تأشيرة صادرة', 'Visas émis', 'Issued Visas'), value: measures.paidCount.toLocaleString() },
      { label: t('نسبة التأشيرة', 'Taux visa', 'Visa Rate'), value: measures.rate + '%' },
    ];
    if (reportType === 'BOOKINGS') return [
      { label: t('الحجوزات', 'Réservations', 'Bookings'), value: (totalCount || 0).toLocaleString() },
      { label: t('إجمالي DZD', 'Total DZD', 'Total DZD'), value: measures.sumDzd.toLocaleString() },
      { label: t('المدفوع DZD', 'Payé DZD', 'Paid DZD'), value: measures.sumDzd.toLocaleString() },
    ];
    if (reportType === 'RESERVATIONS') return [
      { label: t('الطلبات', 'Demandes', 'Requests'), value: (totalCount || 0).toLocaleString() },
      { label: t('المسافرون', 'Voyageurs', 'Travelers'), value: measures.travelers.toLocaleString() },
    ];
    if (reportType === 'GROUPS') return [
      { label: t('الأفواج', 'Groupes', 'Groups'), value: (totalCount || 0).toLocaleString() },
      { label: t('الطاقة الكلية', 'Capacité totale', 'Total Capacity'), value: measures.capacity.toLocaleString() },
    ];
    return [{ label: t('السجلات', 'Enregistrements', 'Records'), value: (totalCount || 0).toLocaleString() }];
  }, [reportType, measures, t, totalCount]);

  const cols = COLS[reportType];

  return (
    <div className={`space-y-5 ${isAr ? 'rtl' : 'ltr'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center">
            <FileBarChart className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--text-primary)]">
              {t('منشئ التقارير', 'Générateur de rapports', 'Report Builder')}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                LIVE
              </span>
              <span className="text-xs text-[var(--text-muted)]">{(totalCount || 0).toLocaleString()} {t('سجل', 'enregistrements', 'records')}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowFilters(f => !f)} className="btn btn-sm inline-flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            {t('تصفية', 'Filtrer', 'Filter')}
          </button>
        </div>
      </div>

      <ReportFilters 
        t={t} reportType={reportType} setReportType={(v) => setReportType(v as ReportType)} 
        from={from} setFrom={(v) => setFrom(v || '')} to={to} setTo={(v) => setTo(v || '')} 
        statusFilter={statusFilter} setStatusFilter={setStatusFilter} 
        statusOptions={statusOptions} REPORT_TYPES={REPORT_TYPES} 
        setPage={setPage} setSortKey={(v) => setSortKey(v || '')} 
      />

      <div className={`grid gap-3 grid-cols-${Math.min(kpis.length, 4)}`}>
        {kpis.map(kpi => (
          <div key={kpi.label} className="card p-4 text-center">
            <p className="text-xl font-bold text-[var(--text-primary)]">{kpi.value}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      <ReportTable 
        t={t} colLabel={(c) => colLabel(c as unknown as ColumnDef)} loading={loading} rows={rawSource} cols={cols as unknown as { id: string; label: string; numeric?: boolean; badge?: unknown }[]} 
        pageRows={rawSource as Record<string, unknown>[]} handleSort={handleSort} sortKey={sortKey} 
        sortDir={sortDir} measures={measures as unknown as { id: string; label: string }[]} page={page} setPage={setPage} 
        totalPages={totalPages} 
      />
    </div>
  );
}