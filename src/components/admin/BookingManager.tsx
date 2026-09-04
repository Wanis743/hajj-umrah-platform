import { reportError } from '@/lib/logger';
import Select from '@/components/admin/GlassSelect';
import { useConfirmDialog } from '@/components/ConfirmDialog';
import React, { useState, useMemo } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Search, AlertCircle, ShoppingCart, CheckCircle, Clock, XCircle, CreditCard, Trash2, BadgeCheck } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { reservationCommands } from '@/services/domainCommands';
import type { BookingRow, PilgrimRow, GroupRow, GenericRow } from '@/types/database';

export const BookingManager = () => {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: reservations, loading: resLoading } = useSupabaseData<GenericRow>({ table: 'reservations', orderBy: { column: 'created_at', ascending: false }, fallbackData: [] });
  const { data: bookings, loading: bkLoading } = useSupabaseData<BookingRow>({ table: 'bookings', orderBy: { column: 'created_at', ascending: false }, fallbackData: [] });
  const { data: pilgrims } = useSupabaseData<PilgrimRow>({ table: 'pilgrims' });
  const { data: packages } = useSupabaseData<GenericRow>({ table: 'packages', orderBy: { column: 'price_dzd', ascending: true } });
  const { data: groups } = useSupabaseData<GroupRow>({ table: 'groups', orderBy: { column: 'created_at', ascending: true } });

  const [filter, setFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Modal State
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedRes, setSelectedRes] = useState<GenericRow | null>(null);

  // Confirmation Form State — management-specific details
  const [payMethod, setPayMethod] = useState('Bank Transfer');
  const [payAmountDZD, setPayAmountDZD] = useState('');
  const [payAmountSAR, setPayAmountSAR] = useState('');
  const [selPackageId, setSelPackageId] = useState('');
  const [selGroupId, setSelGroupId] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loading = resLoading || bkLoading;

  const pilgrimById = useMemo(() => {
    const m = new Map<string, PilgrimRow>();
    pilgrims.forEach((p) => m.set(p.id, p));
    return m;
  }, [pilgrims]);

  const packageById = useMemo(() => {
    const m = new Map<string, GenericRow>();
    packages.forEach((p) => m.set(p.id, p));
    return m;
  }, [packages]);

  const groupById = useMemo(() => {
    const m = new Map<string, GroupRow>();
    groups.forEach((g) => m.set(g.id, g));
    return m;
  }, [groups]);

  const pendingReservations = useMemo(() => reservations.filter((r) => r.status === 'pending'), [reservations]);

  const stats = useMemo(() => {
    const confirmed = bookings.filter((b) => b.status === 'CONFIRMED' || b.status === 'PAID');
    const collected = confirmed.reduce((s: number, b) => s + Number(b.paid_dzd || 0), 0);
    return {
      total: bookings.length + pendingReservations.length,
      confirmed: confirmed.length,
      pending: pendingReservations.length,
      cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
      collected,
    };
  }, [bookings, pendingReservations]);

  const displayList = useMemo(() => {
    let list: BookingRow[] = [];
    if (filter === 'PENDING_RESERVATIONS') list = pendingReservations;
    else if (filter === 'ALL') list = [...bookings, ...pendingReservations];
    else list = bookings.filter((b) => b.status === filter);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((item) =>
        (String(item.reference || item.id || '')).toLowerCase().includes(q) ||
        (String(item.name || (item.pilgrims as unknown as Record<string, string>)?.full_name || '')).toLowerCase().includes(q) ||
        (String(item.phone || '')).toLowerCase().includes(q)
      );
    }
    return list;
  }, [bookings, pendingReservations, filter, search]);

  const getStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'PENDING': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
      case 'CONFIRMED': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'PAID': return 'bg-brand-500/20 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400';
      case 'CANCELLED': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
      case 'COMPLETED': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
    }
  };

  const handleConfirmClick = (res: BookingRow) => {
    const pkg = packageById.get(res.package_id || '') || packages.find((p: BookingRow) => p.code === res.package_id);
    const priceDZD = Number(pkg?.price_dzd || 0);
    const priceSAR = Number(pkg?.price_sar || 0);
    setSelectedRes(res);
    setPayAmountDZD(String(priceDZD * (res.travelers || 1)));
    setPayAmountSAR(String(priceSAR * (res.travelers || 1)));
    setSelPackageId(pkg ? pkg.id : '');
    setSelGroupId('');
    setPassportNumber('');
    setPayNotes('');
    setSubmitError(null);
    setConfirmModalOpen(true);
  };

  const onPackageChange = (pkgId: string) => {
    setSelPackageId(pkgId);
    const pkg = packageById.get(pkgId);
    if (!selectedRes || !pkg) return;
    setPayAmountDZD(String(Number(pkg.price_dzd ?? 0) * Number(selectedRes['travelers'] ?? 1)));
    setPayAmountSAR(String(Number(pkg.price_sar ?? 0) * Number(selectedRes['travelers'] ?? 1)));
  };

  const submitConfirmation = async () => {
    if (!selectedRes) return;
    if (!selPackageId) { setSubmitError(t('اختر الباقة', 'Choisissez un forfait', 'Select a package')); return; }
    if (!passportNumber.trim()) { setSubmitError(t('أدخل رقم جواز السفر', 'Entrez le N° de passeport', 'Enter passport number')); return; }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await reservationCommands.confirm(
        selectedRes.id,
        selPackageId,
        selGroupId || null,
        passportNumber.trim(),
        parseFloat(payAmountDZD || '0'),
        parseFloat(payAmountSAR || '0'),
        payMethod,
        payNotes || null,
      );

      if (!result.success) {
        throw new Error(result.error?.user_safe_message ?? result.error?.message ?? 'Booking confirmation failed');
      }
      if (!result.data?.booking_reference) {
        throw new Error('Booking confirmation returned no reference');
      }
      setConfirmModalOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error confirming reservation';
      reportError('booking.confirm', e);
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDialog = useConfirmDialog();

  const cancelBooking = async (id: string) => {
    if (!(await confirmDialog({ title: t('تأكيد الإلغاء', 'Confirmer l\'annulation', 'Confirm cancellation'), message: t('إلغاء هذا الحجز؟', 'Annuler ce booking ?', 'Cancel this booking?'), danger: true }))) return;
    const result = await reservationCommands.cancelBooking(id);
    if (!result.success) reportError('booking.cancel', new Error(result.error?.message ?? 'Cancel failed'));
  };

  const deleteReservation = async (id: string) => {
    if (!(await confirmDialog({ title: t('تأكيد الإلغاء', 'Confirmer l\'annulation', 'Confirm cancellation'), message: t('حذف هذا الطلب؟', 'Supprimer cette demande ?', 'Delete this reservation?'), danger: true }))) return;
    setDeletingId(id);
    const result = await reservationCommands.cancelReservation(id);
    if (!result.success) reportError('booking.delete', new Error(result.error?.message ?? 'Delete failed'));
    setDeletingId(null);
  };

  const travelerName = (item: BookingRow) => {
    if (item.name) return item.name;
    const p = item.pilgrim_id ? pilgrimById.get(item.pilgrim_id) : null;
    return p?.full_name || '-';
  };

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { icon: ShoppingCart, label: t('الإجمالي', 'Total', 'Total'), value: stats.total, color: 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]' },
          { icon: CheckCircle, label: t('مؤكد', 'Confirmé', 'Confirmed'), value: stats.confirmed, color: 'text-emerald-500' },
          { icon: Clock, label: t('حجوزات معلقة', 'En attente', 'Pending'), value: stats.pending, color: 'text-amber-500' },
          { icon: XCircle, label: t('ملغى', 'Annulé', 'Cancelled'), value: stats.cancelled, color: 'text-rose-500' },
        ].map((stat, idx) => (
          <div key={idx} className="card p-5 flex items-center gap-4">
            <div className={`p-3 rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] ${stat.color}`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[13px] text-[var(--text-muted)]">{stat.label}</p>
              <p className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="card p-5">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex gap-2 overflow-x-auto">
            {['ALL', 'PENDING_RESERVATIONS', 'CONFIRMED', 'PAID', 'CANCELLED'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                  filter === f
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]'
                }`}
              >
                {f === 'ALL' ? t('الكل', 'Tous', 'All') : f === 'PENDING_RESERVATIONS' ? t('طلبات معلقة', 'Demandes en attente', 'Pending Requests') : f}
                {f === 'PENDING_RESERVATIONS' && pendingReservations.length > 0 && (
                  <span className="ltr:ms-2 rtl:me-2 inline-flex items-center justify-center bg-rose-500 text-white text-[10px] h-4 w-4 rounded-full">
                    {pendingReservations.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative shrink-0">
            <Search className="absolute top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)] ltr:left-3 rtl:right-3" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('بحث...', 'Rechercher...', 'Search...')}
              className="w-full md:w-56 rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] py-2 ps-9 pe-4 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden min-h-[400px]">
        {loading ? (
          <Spinner className="p-10" />
        ) : displayList.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
            <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data found')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-start min-w-[760px]">
              <thead className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] border-b border-[var(--border)] dark:border-[var(--border)]">
                <tr>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('رقم مرجعي', 'Réf', 'Ref')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('العميل', 'Client', 'Client')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الباقة', 'Forfait', 'Package')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الحالة', 'Statut', 'Status')}</th>
                  {filter === 'PENDING_RESERVATIONS' ? (
                    <th className={`px-4 py-3 font-semibold text-center`}>{t('إجراء', 'Action', 'Action')}</th>
                  ) : (
                    <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('المدفوع', 'Payé', 'Paid')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {displayList.map((item: BookingRow) => {
                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="border-b border-[var(--border)] dark:border-[var(--border)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-4 text-[var(--text-secondary)] dark:text-white font-medium">{item.reference || item.id?.slice(0, 8).toUpperCase()}</td>
                        <td className="px-4 py-4 text-[var(--text-secondary)] dark:text-white">
                          {String(travelerName(item))}
                          <div className="text-[10px] text-[var(--text-secondary)]">{String(item.phone || '-')}</div>
                        </td>
                        <td className="px-4 py-4 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                          {String(item.package_name || (item.package_id ? (packageById.get(item.package_id)?.name || item.package_id.slice(0, 8)) : '-'))}
                          <div className="text-[10px] text-[var(--text-secondary)]">{item.travelers} {t('أشخاص', 'personnes', 'persons')}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getStatusBadge(item.status || '')}`}>
                            {item.status?.toUpperCase() || 'UNKNOWN'}
                          </span>
                          {item.group_id && (
                            <div className="text-[10px] text-brand-600 dark:text-brand-400 mt-1">{groupById.get(item.group_id)?.code || ''}</div>
                          )}
                        </td>
                        {filter === 'PENDING_RESERVATIONS' ? (
                          <td className="px-4 py-4 text-center whitespace-nowrap">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleConfirmClick(item); }}
                              className="btn btn-primary btn-sm"
                            >
                              <BadgeCheck className="w-3.5 h-3.5" />
                              {t('تأكيد وإنشاء', 'Confirmer', 'Confirm')}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteReservation(item.id); }}
                              disabled={deletingId === item.id}
                              className="ms-1 p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        ) : (
                          <td className="px-4 py-4 text-[var(--text-secondary)] dark:text-white font-medium">
                            {(item.paid_dzd || 0).toLocaleString()} DZD
                            <div className="text-[10px] text-[var(--text-secondary)]">
                              {String(item.payment_method || '-')}
                              {item.status !== 'CANCELLED' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); cancelBooking(item.id); }}
                                  className="ms-2 text-rose-500 hover:underline"
                                >
                                  {t('إلغاء', 'Annuler', 'Cancel')}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                      {expandedId === item.id && (
                        <tr className="bg-[var(--bg-hover)]/70 dark:bg-[var(--bg-hover)]/40">
                          <td colSpan={5} className="px-6 py-4 text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] space-y-1">
                            <p>
                              <strong>{t('تاريخ الطلب', 'Date', 'Created')}:</strong> {new Date(item.created_at || '').toLocaleString()}
                            </p>
                            {Boolean(item.notes) && <p><strong>{t('ملاحظات', 'Notes', 'Notes')}:</strong> {String(item.notes)}</p>}
                            {item.pilgrim_id && (
                              <p>
                                <strong>{t('الحاج', 'Pèlerin', 'Pilgrim')}:</strong>{' '}
                                {pilgrimById.get(item.pilgrim_id)?.full_name || item.pilgrim_id.slice(0, 8)}
                              </p>
                            )}
                            <p><strong>{t('الإجمالي', 'Total', 'Total')}:</strong> {(item.total_dzd || 0).toLocaleString()} DZD / {(item.total_sar || 0).toLocaleString()} SAR</p>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmModalOpen && selectedRes && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-[var(--bg-hover)] w-full max-w-lg rounded-xl shadow-md overflow-hidden border border-[var(--border)] dark:border-[var(--border)] flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 sm:px-6 sm:py-4 border-b border-[var(--border)] dark:border-[var(--border)] flex justify-between items-center bg-[var(--bg-hover)]/50 dark:bg-[var(--bg-hover)]/50 shrink-0">
              <h3 className="font-semibold text-lg text-[var(--text-secondary)] dark:text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-brand-500" />
                {t('تأكيد الحجز والدفع', 'Confirmer la réservation', 'Confirm Booking & Payment')}
              </h3>
              <button onClick={() => setConfirmModalOpen(false)} className="text-[var(--text-secondary)] hover:text-rose-500">
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
              <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 p-4 rounded-xl text-sm">
                <strong>{String(selectedRes['name'] ?? selectedRes['full_name'] ?? '—')}</strong>
                {' • '}{String(selectedRes['travelers'] ?? 1)} {t('أشخاص', 'personnes', 'persons')} <br />
                {String(selectedRes['package_name'] ?? '')}
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1.5">
                  {t('الباقة المعتمدة', 'Forfait attribué', 'Assigned Package')} *
                </label>
                <Select
                  value={selPackageId}
                  onChange={e => onPackageChange(e.target.value)}
                  className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-4 py-2.5 text-sm"
                >
                  <option value="">{t('اختر الباقة...', 'Choisir...', 'Select package...')}</option>
                  {packages.map((p: BookingRow) => (
                    <option key={p.id} value={p.id}>
                      {String(p.name)} — {Number(p.price_dzd || 0).toLocaleString()} DZD
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1.5">
                  {t('المجموعة المخصصة', 'Groupe assigné', 'Assigned Group')}
                </label>
                <Select
                  value={selGroupId}
                  onChange={e => setSelGroupId(e.target.value)}
                  className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-4 py-2.5 text-sm"
                >
                  <option value="">{t('بدون مجموعة', 'Aucun groupe', 'No group')}</option>
                  {groups.map((g: BookingRow) => (
                    <option key={g.id} value={g.id}>
                      {String(g.code)} — {String(g.name)} ({String(g.current_capacity)}/{String(g.max_capacity)})
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1.5">
                  {t('رقم جواز السفر (تحقق)', 'N° passeport (vérification)', 'Passport Number (verification)')} *
                </label>
                <input
                  type="text"
                  value={passportNumber}
                  onChange={e => setPassportNumber(e.target.value)}
                  placeholder="219xxxxxxxx"
                  className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-4 py-2.5 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1.5">{t('طريقة الدفع', 'Méthode de paiement', 'Payment Method')}</label>
                <Select
                  value={payMethod}
                  onChange={e => setPayMethod(e.target.value)}
                  className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-4 py-2.5 text-sm"
                >
                  <option value="Cash">Cash / إسباس</option>
                  <option value="Bank Transfer">Bank Transfer / تحويل بنكي</option>
                  <option value="Check">Check / صك</option>
                  <option value="Card">Card / بطاقة بنكية</option>
                  <option value="CCP">CCP</option>
                  <option value="BaridiMob">BaridiMob</option>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1.5">{t('المبلغ المدفوع (DZD)', 'Montant (DZD)', 'Amount (DZD)')}</label>
                  <input
                    type="number" value={payAmountDZD} onChange={e => setPayAmountDZD(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-4 py-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1.5">{t('المبلغ (SAR)', 'Montant (SAR)', 'Amount (SAR)')}</label>
                  <input
                    type="number" value={payAmountSAR} onChange={e => setPayAmountSAR(e.target.value)}
                    className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-4 py-2.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mb-1.5">{t('ملاحظات', 'Notes', 'Notes')}</label>
                <textarea
                  value={payNotes} onChange={e => setPayNotes(e.target.value)} rows={2}
                  className="w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] rounded-xl px-4 py-2.5 text-sm resize-none"
                />
              </div>

              {submitError && (
                <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{submitError}</p>
              )}
            </div>

            <div className="px-5 py-4 sm:px-6 sm:py-4 border-t border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)]/50 dark:bg-[var(--bg-hover)]/50 flex justify-end gap-3 shrink-0">
              <button
                onClick={() => setConfirmModalOpen(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)] dark:hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {t('إلغاء', 'Annuler', 'Cancel')}
              </button>
              <button
                onClick={submitConfirmation} disabled={isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {t('تأكيد الحجز', 'Confirmer', 'Confirm Booking')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
