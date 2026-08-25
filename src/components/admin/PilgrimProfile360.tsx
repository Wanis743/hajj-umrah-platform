import { useState, useEffect } from 'react';
import {
  X, User, CreditCard, BadgeCheck, Phone, MapPin, Calendar,
  Globe, AlertTriangle, Wallet, Plane, History, Activity,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/admin/ui';

// Types

interface PilgrimDetail {
  id: string;
  full_name?: string | null;
  passport_number?: string | null;
  phone?: string | null;
  email?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  nationality?: string | null;
  wilaya?: string | null;
  departure_airport?: string | null;
  emergency_contact?: string | null;
  medical_notes?: string | null;
  status?: string | null;
  visa_status?: string | null;
  payment_status?: string | null;
  reference?: string | null;
  [key: string]: unknown;
}

interface PilgrimBooking {
  id: string;
  booking_reference?: string | null;
  status?: string | null;
  amount_dzd?: number | null;
  created_at?: string | null;
}

interface PilgrimPayment {
  id: string;
  amount_dzd?: number | null;
  payment_method?: string | null;
  payment_date?: string | null;
  status?: string | null;
}

interface PilgrimVisa {
  id: string;
  visa_number?: string | null;
  status?: string | null;
  application_date?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
}

interface Profile360 {
  pilgrim: PilgrimDetail;
  bookings: PilgrimBooking[];
  payments: PilgrimPayment[];
  visas: PilgrimVisa[];
  completeness: number;
  missingFields: string[];
}

// Helpers

const COMPLETENESS_FIELDS = [
  'full_name', 'passport_number', 'phone', 'email', 'birth_date',
  'gender', 'nationality', 'wilaya', 'departure_airport', 'emergency_contact',
];

function calcCompleteness(p: PilgrimDetail): { score: number; missing: string[] } {
  const missing = COMPLETENESS_FIELDS.filter(f => !p[f]);
  const score = Math.round(((COMPLETENESS_FIELDS.length - missing.length) / COMPLETENESS_FIELDS.length) * 100);
  return { score, missing };
}

const statusBadge = (status: string | null | undefined) => {
  const s = (status ?? '').toUpperCase();
  const map: Record<string, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    CONFIRMED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    ISSUED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    CANCELLED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    EXPIRED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  };
  return `inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${map[s] ?? 'bg-gray-100 text-gray-600'}`;
};

// Props

export interface PilgrimProfile360Props {
  pilgrimId: string | null;
  onClose: () => void;
}

// Main Component

export function PilgrimProfile360({ pilgrimId, onClose }: PilgrimProfile360Props) {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const [profile, setProfile] = useState<Profile360 | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'finance' | 'travel' | 'audit'>('profile');

  useEffect(() => {
    if (!pilgrimId) return;
    setLoading(true);
    setProfile(null);
    setActiveTab('profile');

    void (async () => {
      try {
        const [pilgrimRes, bookingsRes, paymentsRes, visasRes] = await Promise.all([
          supabase.from('pilgrims').select('*').eq('id', pilgrimId).single(),
          supabase
            .from('bookings')
            .select('id,booking_reference,status,amount_dzd,created_at')
            .eq('pilgrim_id', pilgrimId)
            .order('created_at', { ascending: false })
            .limit(10),
          supabase
            .from('payments')
            .select('id,amount_dzd,payment_method,payment_date,status')
            .eq('pilgrim_id', pilgrimId)
            .order('payment_date', { ascending: false })
            .limit(20),
          supabase
            .from('visas')
            .select('id,visa_number,status,application_date,issue_date,expiry_date')
            .eq('pilgrim_id', pilgrimId)
            .limit(5),
        ]);

        const pilgrim = (pilgrimRes.data ?? {}) as PilgrimDetail;
        const { score, missing } = calcCompleteness(pilgrim);

        setProfile({
          pilgrim,
          bookings: (bookingsRes.data ?? []) as PilgrimBooking[],
          payments: (paymentsRes.data ?? []) as PilgrimPayment[],
          visas: (visasRes.data ?? []) as PilgrimVisa[],
          completeness: score,
          missingFields: missing,
        });
      } catch {
        // silent — profile stays null
      } finally {
        setLoading(false);
      }
    })();
  }, [pilgrimId]);

  if (!pilgrimId) return null;

  const p = profile?.pilgrim;
  const totalPaid = (profile?.payments ?? [])
    .filter(pay => pay.status !== 'CANCELLED')
    .reduce((a, b) => a + (b.amount_dzd ?? 0), 0);
  const totalBooked = (profile?.bookings ?? []).reduce((a, b) => a + (b.amount_dzd ?? 0), 0);
  const balance = totalBooked - totalPaid;

  const tabs = [
    { id: 'profile' as const, ar: 'الملف', fr: 'Profil', en: 'Profile', icon: User },
    { id: 'finance' as const, ar: 'المالية', fr: 'Finance', en: 'Finance', icon: Wallet },
    { id: 'travel' as const, ar: 'السفر', fr: 'Voyage', en: 'Travel', icon: Plane },
    { id: 'audit' as const, ar: 'السجل', fr: 'Journal', en: 'Audit', icon: Activity },
  ];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-end"
      dir={isAr ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      aria-label={t('ملف الحاج 360°', 'Profil pèlerin 360°', 'Pilgrim Profile 360°')}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="relative z-10 h-full w-full max-w-2xl bg-[var(--surface)] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">

        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-[var(--border)] shrink-0">
          <div className="h-12 w-12 rounded-full bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
            <User className="h-6 w-6 text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="space-y-1.5">
                <div className="h-5 w-48 skeleton rounded" />
                <div className="h-3 w-32 skeleton rounded" />
              </div>
            ) : (
              <>
                <h2 className="font-semibold text-[var(--text-primary)] truncate">
                  {p?.full_name ?? '—'}
                </h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-[var(--text-muted)]">
                    {p?.reference ?? p?.passport_number ?? '—'}
                  </span>
                  {p?.status && (
                    <span className={statusBadge(p.status)}>{p.status}</span>
                  )}
                  {p?.visa_status && (
                    <span className={statusBadge(p.visa_status)}>
                      {t('تأشيرة', 'Visa', 'Visa')}: {p.visa_status}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="btn btn-sm p-2 shrink-0"
            aria-label={t('إغلاق', 'Fermer', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Completeness bar */}
        {!loading && profile && (
          <div className="px-5 pt-3 pb-1 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--text-muted)]">
                {t('اكتمال الملف', 'Complétude du dossier', 'Profile completeness')}
              </span>
              <span className={`text-xs font-semibold ${
                profile.completeness >= 80
                  ? 'text-emerald-600'
                  : profile.completeness >= 50
                    ? 'text-amber-600'
                    : 'text-rose-600'
              }`}>
                {profile.completeness}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  profile.completeness >= 80
                    ? 'bg-emerald-500'
                    : profile.completeness >= 50
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                }`}
                style={{ width: `${profile.completeness}%` }}
              />
            </div>
            {profile.missingFields.length > 0 && (
              <p className="text-[10px] text-[var(--text-muted)] mt-1 truncate">
                {t('ناقص', 'Manque', 'Missing')}: {profile.missingFields.join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)] px-5 shrink-0 mt-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-[var(--accent)] text-[var(--accent)] font-medium'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(tab.ar, tab.fr, tab.en)}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner />
            </div>
          ) : !profile ? (
            <div className="p-10 text-center text-[var(--text-muted)] text-sm">
              {t('لا توجد بيانات', 'Aucune donnée', 'No data available')}
            </div>
          ) : (
            <div className="p-5 space-y-5">

              {/* PROFILE TAB */}
              {activeTab === 'profile' && (
                <>
                  <section className="card p-4 space-y-4">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <User className="h-4 w-4" />
                      {t('المعلومات الشخصية', 'Informations personnelles', 'Personal Information')}
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {[
                        { icon: CreditCard, label: t('رقم الجواز', 'Passeport', 'Passport'), value: p?.passport_number },
                        { icon: Phone, label: t('الهاتف', 'Téléphone', 'Phone'), value: p?.phone },
                        { icon: Globe, label: t('الجنسية', 'Nationalité', 'Nationality'), value: p?.nationality },
                        { icon: Calendar, label: t('تاريخ الميلاد', 'Date naissance', 'DOB'), value: p?.birth_date },
                        { icon: MapPin, label: t('الولاية', 'Wilaya', 'Wilaya'), value: p?.wilaya },
                        { icon: Plane, label: t('مطار المغادرة', 'Aéroport départ', 'Airport'), value: p?.departure_airport },
                        { icon: Phone, label: t('الطوارئ', 'Contact urgence', 'Emergency'), value: p?.emergency_contact },
                      ].map(({ icon: Icon, label, value }) => (
                        <div key={label} className="flex items-start gap-2 min-w-0">
                          <Icon className="h-3.5 w-3.5 text-[var(--text-muted)] mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
                            <p className={`font-medium truncate ${!value ? 'text-rose-400 text-[10px]' : ''}`}>
                              {value ?? '—'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Visa */}
                  {profile.visas.length > 0 && (
                    <section className="card p-4">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
                        <BadgeCheck className="h-4 w-4" />
                        {t('التأشيرة', 'Visa', 'Visa')}
                      </h3>
                      <div className="space-y-2">
                        {profile.visas.map(v => (
                          <div key={v.id} className="flex items-center justify-between text-sm">
                            <div>
                              <p className="font-medium">{v.visa_number ?? '—'}</p>
                              <p className="text-xs text-[var(--text-muted)]">
                                {t('إصدار', 'Émis', 'Issued')}: {v.issue_date ?? '—'} ·{' '}
                                {t('انتهاء', 'Expire', 'Expires')}: {v.expiry_date ?? '—'}
                              </p>
                            </div>
                            <span className={statusBadge(v.status)}>{v.status}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Medical notes */}
                  {p?.medical_notes && (
                    <section className="card p-4 border-amber-300/50 dark:border-amber-700/50">
                      <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        {t('ملاحظات طبية', 'Notes médicales', 'Medical Notes')}
                      </h3>
                      <p className="text-sm text-[var(--text-primary)]">{String(p.medical_notes)}</p>
                    </section>
                  )}
                </>
              )}

              {/* FINANCE TAB */}
              {activeTab === 'finance' && (
                <>
                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: t('إجمالي الحجز', 'Total réservé', 'Total Booked'), value: `${totalBooked.toLocaleString()} دج`, color: 'text-[var(--text-primary)]' },
                      { label: t('المدفوع', 'Payé', 'Paid'), value: `${totalPaid.toLocaleString()} دج`, color: 'text-emerald-600' },
                      { label: t('المتبقي', 'Solde', 'Balance'), value: `${balance.toLocaleString()} دج`, color: balance > 0 ? 'text-rose-600' : 'text-emerald-600' },
                    ].map(item => (
                      <div key={item.label} className="rounded-[var(--radius)] bg-[var(--bg-hover)] p-3 text-center">
                        <p className="text-[10px] text-[var(--text-muted)]">{item.label}</p>
                        <p className={`font-semibold text-sm mt-1 tabular-nums ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Payments list */}
                  <section className="card p-4">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                      {t('سجل الدفعات', 'Historique paiements', 'Payment History')}
                    </h3>
                    <div className="space-y-0">
                      {profile.payments.length === 0 ? (
                        <p className="text-sm text-[var(--text-muted)]">
                          {t('لا دفعات', 'Aucun paiement', 'No payments recorded')}
                        </p>
                      ) : profile.payments.map(pay => (
                        <div key={pay.id} className="flex items-center justify-between text-sm py-2 border-b border-[var(--border)] last:border-0">
                          <div>
                            <span className="font-medium tabular-nums">{(pay.amount_dzd ?? 0).toLocaleString()} دج</span>
                            <span className="text-xs text-[var(--text-muted)] ml-2">{pay.payment_method ?? '—'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--text-muted)]">{pay.payment_date ?? '—'}</span>
                            <span className={statusBadge(pay.status)}>{pay.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {/* TRAVEL TAB */}
              {activeTab === 'travel' && (
                <section className="card p-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                    {t('الحجوزات', 'Réservations', 'Bookings')}
                  </h3>
                  <div className="space-y-0">
                    {profile.bookings.length === 0 ? (
                      <p className="text-sm text-[var(--text-muted)]">
                        {t('لا حجوزات', 'Aucune réservation', 'No bookings')}
                      </p>
                    ) : profile.bookings.map(bk => (
                      <div key={bk.id} className="flex items-center justify-between text-sm py-2.5 border-b border-[var(--border)] last:border-0">
                        <div>
                          <p className="font-medium">{bk.booking_reference ?? '—'}</p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {bk.created_at ? new Date(bk.created_at).toLocaleDateString() : '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium tabular-nums">
                            {(bk.amount_dzd ?? 0).toLocaleString()} دج
                          </span>
                          <span className={statusBadge(bk.status)}>{bk.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* AUDIT TAB */}
              {activeTab === 'audit' && (
                <section className="card p-4">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                    <History className="h-4 w-4" />
                    {t('سجل العمليات', "Journal d'audit", 'Audit Log')}
                  </h3>
                  <p className="text-sm text-[var(--text-muted)]">
                    {t(
                      'سجل التدقيق الكامل متاح من قسم سجل المراجعة مع تصفية حسب الحاج.',
                      "Le journal complet est disponible dans la section Journal d'audit.",
                      'Full audit trail is available in the Audit Log section, filtered by pilgrim.',
                    )}
                  </p>
                </section>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PilgrimProfile360;
