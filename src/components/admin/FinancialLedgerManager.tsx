import { useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { Wallet, TrendingUp, CreditCard, Receipt, Plus } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { GenericRow } from '@/types/database';
import { supabase } from '@/lib/supabase';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Check', 'Card', 'CCP', 'BaridiMob'];
const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'CONFIRMED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'FAILED':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default:
      return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const EMPTY_FORM = { booking_id: '', amount_dzd: '', amount_sar: '', method: 'Cash', status: 'PENDING', notes: '' };

export function FinancialLedgerManager() {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: paymentsRaw, loading, refetch } = useSupabaseData<GenericRow>({
    table: 'payments',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });
  const payments = paymentsRaw as { id: string, amount_dzd?: number, amount_sar?: number, method?: string, status?: string, booking_id?: string, received_at?: string, created_at?: string, reference?: string, notes?: string }[];

  const { data: bookingsRaw } = useSupabaseData<GenericRow>({
    table: 'bookings',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });
  const bookings = bookingsRaw as { id: string, reference?: string, total_dzd?: number, total_sar?: number }[];

  const [methodFilter, setMethodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);

  const bookingMap = new Map<string, { id: string, reference?: string, total_dzd?: number, total_sar?: number }>();
  bookings.forEach(b => bookingMap.set(b.id, b));

  const bookingRef = (id?: string) => {
    if (!id) return '—';
    return bookingMap.get(id)?.reference || id;
  };

  const visiblePayments = payments.filter(p => {
    if (methodFilter && (p.method || '') !== methodFilter) return false;
    if (statusFilter && (p.status || '') !== statusFilter) return false;
    return true;
  });
  const totalDZD = visiblePayments.reduce((acc, p) => acc + Number(p.amount_dzd || 0), 0);
  const totalSAR = visiblePayments.reduce((acc, p) => acc + Number(p.amount_sar || 0), 0);
  const confirmedDZD = visiblePayments
    .filter(p => p.status === 'CONFIRMED')
    .reduce((acc, p) => acc + Number(p.amount_dzd || 0), 0);
  const pendingDZD = visiblePayments
    .filter(p => p.status === 'PENDING')
    .reduce((acc, p) => acc + Number(p.amount_dzd || 0), 0);

  const handleRecord = async () => {
    if (!form.booking_id) return;
    const { error } = await supabase.rpc('record_payment_transaction', {
      p_booking_id: form.booking_id,
      p_amount_dzd: Number(form.amount_dzd) || 0,
      p_amount_sar: Number(form.amount_sar) || 0,
      p_method: form.method,
      p_notes: form.notes || null,
    });
    if (error) return;
    await refetch();
    setForm(EMPTY_FORM);
    setShowAddForm(false);
  };

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[var(--accent)]" />
          {t('الدفتر المالي', 'Comptabilité Générale', 'Financial Ledger')}
        </h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('تسجيل دفعة', 'Enregistrer un paiement', 'Record Payment')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5 flex items-center gap-4">
          <div className="p-3 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('إجمالي المعروض', 'Total affiché', 'Total Shown')}</p>
            <span className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white">{totalDZD.toLocaleString()} DZD</span>
            <span className="text-sm font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"> / {totalSAR.toLocaleString()} SAR</span>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-4">
          <div className="p-3 rounded-full bg-brand-500/20 text-brand-600 dark:text-brand-400">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('المؤكد', 'Confirmé', 'Confirmed')}</p>
            <span className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white">{confirmedDZD.toLocaleString()} DZD</span>
            <span className="text-sm font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"> / {visiblePayments.filter((p: GenericRow) => p.status === 'CONFIRMED').length}</span>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-4">
          <div className="p-3 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('في الانتظار', 'En attente', 'Pending')}</p>
            <span className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white">{pendingDZD.toLocaleString()} DZD</span>
            <span className="text-sm font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]"> / {visiblePayments.filter((p: GenericRow) => p.status === 'PENDING').length}</span>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <Select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="input"
          >
            <option value="">{t('كل الطرق', 'Toutes les méthodes', 'All methods')}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input"
          >
            <option value="">{t('كل الحالات', 'Tous les statuts', 'All statuses')}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>

        {showAddForm && (
          <div className="mb-4 p-4 border border-[var(--border)] dark:border-[var(--border)] rounded-xl space-y-3">
            <Select
              value={form.booking_id}
              onChange={(e) => {
                const b = bookingMap.get(e.target.value);
                setForm({
                  ...form,
                  booking_id: e.target.value,
                  amount_dzd: b?.total_dzd ? String(b.total_dzd) : form.amount_dzd,
                  amount_sar: b?.total_sar ? String(b.total_sar) : form.amount_sar,
                });
              }}
              className="w-full input"
            >
              <option value="">{t('اختر الحجز', 'Choisir une réservation', 'Select a booking')}</option>
              {bookings.map(b => (
                <option key={b.id} value={b.id}>{b.reference || b.id}</option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                value={form.amount_dzd}
                onChange={(e) => setForm({ ...form, amount_dzd: e.target.value })}
                placeholder={t('المبلغ DZD', 'Montant DZD', 'Amount DZD')}
                className="input"
              />
              <input
                type="number"
                value={form.amount_sar}
                onChange={(e) => setForm({ ...form, amount_sar: e.target.value })}
                placeholder={t('المبلغ SAR', 'Montant SAR', 'Amount SAR')}
                className="input"
              />
              <Select
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
                className="input"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="input"
              >
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t('ملاحظات', 'Notes', 'Notes')}
              className="w-full input"
            />
            <button
              onClick={handleRecord}
              className="btn btn-primary w-full"
            >
              {t('تسجيل الدفعة', 'Enregistrer le paiement', 'Record Payment')}
            </button>
          </div>
        )}

        {loading ? (
          <Spinner className="p-10" />
        ) : visiblePayments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <p>{t('لا توجد مدفوعات', 'Aucun paiement', 'No payments found')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-start text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] dark:border-[var(--border)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                  <th className="pb-3 font-medium">{t('التاريخ', 'Date', 'Date')}</th>
                  <th className="pb-3 font-medium">{t('الحجز', 'Réservation', 'Booking')}</th>
                  <th className="pb-3 font-medium">{t('الطريقة', 'Méthode', 'Method')}</th>
                  <th className="pb-3 font-medium">{t('المبلغ DZD', 'Montant DZD', 'Amount DZD')}</th>
                  <th className="pb-3 font-medium">{t('المبلغ SAR', 'Montant SAR', 'Amount SAR')}</th>
                  <th className="pb-3 font-medium">{t('الحالة', 'Statut', 'Status')}</th>
                  <th className="pb-3 font-medium">{t('ملاحظات', 'Notes', 'Notes')}</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visiblePayments.map(p => (
                  <tr key={p.id} className="border-b border-[var(--border)] dark:border-[var(--border)]/50 hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/50 transition-colors">
                    <td className="py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] whitespace-nowrap">
                      {new Date(p.received_at || p.created_at || '').toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <p className="font-semibold text-[var(--text-secondary)] dark:text-white font-mono">{bookingRef(p.booking_id)}</p>
                      {p.reference && <p className="text-[13px] text-[var(--text-muted)]">#{p.reference}</p>}
                    </td>
                    <td className="py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{p.method || '—'}</td>
                    <td className="py-3 font-semibold text-[var(--text-secondary)] dark:text-white">{(p.amount_dzd || 0).toLocaleString()}</td>
                    <td className="py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{(p.amount_sar || 0).toLocaleString()}</td>
                    <td className="py-3">
                      <Select
                        value={p.status || 'PENDING'}
                        disabled
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(p.status || '')} bg-transparent border-none cursor-pointer outline-none`}
                      >
                        {PAYMENT_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-3 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] max-w-[150px] truncate">{p.notes || '—'}</td>
                    <td className="py-3 text-xs text-[var(--text-muted)]">
                      {t('غير قابلة للتعديل؛ العكس يتم بحركة مستقلة', 'Immuable ; annulation via une écriture séparée', 'Immutable; reverse through a separate transaction')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default FinancialLedgerManager;
