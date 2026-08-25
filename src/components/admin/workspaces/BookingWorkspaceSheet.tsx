import React, { useEffect, useState } from 'react';
import { SideSheet } from './SideSheet';
import { User, Package } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';

import type { BaseRow } from '@/types/database';

interface BookingRow extends BaseRow {
  pilgrim_id?: string | null;
  package_id?: string | null;
  status?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
}

interface BookingWorkspaceSheetProps {
  bookingId: string | null;
  onClose: () => void;
}

export function BookingWorkspaceSheet({ bookingId, onClose }: BookingWorkspaceSheetProps) {
  const { lang } = useI18n();
  const t = (ar: string, fr: string, en: string) => lang === 'ar' ? ar : lang === 'fr' ? fr : en;

  const [booking, setBooking] = useState<BookingRow | null>(null);
  const [loading, setLoading] = useState(false);

  

  useEffect(() => {
    if (!bookingId) return;
    setLoading(true);
    supabase.from('bookings').select('*, pilgrims(*), packages(*)').eq('id', bookingId).single().then(({ data }) => {
      setBooking(data as unknown as BookingRow);
      setLoading(false);
    });
  }, [bookingId]);

  return (
    <SideSheet isOpen={!!bookingId} onClose={onClose} title={t('تفاصيل الحجز', 'Détails de la réservation', 'Booking Details')} width="max-w-3xl">
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-[var(--text-muted)]">{t('جاري التحميل...', 'Chargement...', 'Loading...')}</p>
        </div>
      ) : booking ? (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                <User className="h-5 w-5" /> 
                {(booking as unknown as { pilgrims?: { full_name?: string } }).pilgrims?.full_name || t('حاج', 'Pèlerin', 'Pilgrim')}
              </h3>
              <p className="text-sm text-[var(--text-muted)] flex items-center gap-2 mt-1">
                <Package className="h-4 w-4" /> 
                {(booking as unknown as { packages?: { name?: string } }).packages?.name || t('باقة غير معروفة', 'Forfait inconnu', 'Unknown Package')}
              </p>
            </div>
            <span className="px-3 py-1 bg-[var(--brand-500)]/10 text-[var(--brand-500)] font-semibold rounded-full text-sm">
              {booking.status || 'CONFIRMED'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] mb-1">{t('حالة الدفع', 'État du paiement', 'Payment Status')}</p>
              <p className="text-lg font-bold">{booking.payment_status || 'PAID'}</p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-hover)] border border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] mb-1">{t('تاريخ الحجز', 'Date de réservation', 'Booking Date')}</p>
              <p className="text-lg font-bold">{booking.created_at ? new Date(booking.created_at).toLocaleDateString() : ''}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-[var(--text-primary)] border-b border-[var(--border)] pb-2">{t('إجراءات سريعة', 'Actions Rapides', 'Quick Actions')}</h4>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-primary flex-1">{t('تأكيد الحجز', 'Confirmer', 'Confirm Booking')}</button>
              <button className="btn btn-sm border border-[var(--border)] flex-1">{t('تعديل الباقة', 'Modifier forfait', 'Change Package')}</button>
              <button className="btn btn-sm bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 flex-1">{t('إلغاء', 'Annuler', 'Cancel')}</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-40">
          <p className="text-[var(--text-muted)]">{t('لم يتم العثور على الحجز', 'Réservation non trouvée', 'Booking not found')}</p>
        </div>
      )}
    </SideSheet>
  );
}