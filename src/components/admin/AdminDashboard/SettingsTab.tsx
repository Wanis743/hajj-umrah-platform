import React from 'react';
import { Settings2, Briefcase, Settings, CheckCircle2, Gauge, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import GlassDate from '@/components/admin/GlassDate';

interface SettingsTabProps {
  agencyConfig: Record<string, string>;
  departureDate: string;
  setDepartureDate: (v: string) => void;
  saveDepartureDate: () => void;
  savingDate: boolean;
  dateSaved: boolean;
  dashboardRealtimeStatus: string;
  session: { user: { email?: string; last_sign_in_at?: string } } | null;
  handleLogout: () => void;
}

export function SettingsTab({
  agencyConfig,
  departureDate,
  setDepartureDate,
  saveDepartureDate,
  savingDate,
  dateSaved,
  dashboardRealtimeStatus,
  session,
  handleLogout
}: SettingsTabProps) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  
                  return (
                    <div className="max-w-3xl space-y-6">
                      <h2 className="text-xl font-semibold text-[var(--text-primary)] flex items-center gap-2">
                        <Settings2 className="h-5 w-5 text-brand-500" />
                        {t('الإعدادات', 'Paramètres', 'Settings')}
                      </h2>

                      {/* 1. Agency Identity */}
                      <div className="card p-5 space-y-4">
                        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-brand-500" />
                          {t('هوية الوكالة', "Identité de l'agence", 'Agency Identity')}
                        </h3>
                        <p className="text-[12px] text-[var(--text-muted)]">
                          {t('تُقرأ من متغيرات البيئة (VITE_AGENCY_*). لتغييرها، عدّل ملف .env وأعد النشر.', 'Lues depuis les variables d\'environnement VITE_AGENCY_*. Pour les modifier, éditez .env et redéployez.', 'Read from VITE_AGENCY_* env vars. To change them, edit .env and redeploy.')}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[
                            { label: t('اسم الوكالة', 'Nom agence', 'Agency Name'), val: agencyConfig.name },
                            { label: t('الاسم القانوني', 'Nom légal', 'Legal Name'), val: agencyConfig.legalName || '—' },
                            { label: t('الهاتف', 'Téléphone', 'Phone'), val: agencyConfig.phone || '—' },
                            { label: t('البريد الإلكتروني', 'Email', 'Email'), val: agencyConfig.email || '—' },
                            { label: t('الولاية', 'Wilaya', 'Wilaya'), val: agencyConfig.wilaya || '—' },
                            { label: t('رقم التسجيل', "N° d'enregistrement", 'Registration No.'), val: agencyConfig.registrationNumber || '—' },
                          ].map(({ label, val }) => (
                            <div key={label} className="flex flex-col gap-1">
                              <span className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wide">{label}</span>
                              <span className="text-sm font-medium text-[var(--text-primary)] truncate">{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 2. Operational Settings */}
                      <div className="card p-5 space-y-5">
                        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                          <Settings className="h-4 w-4 text-brand-500" />
                          {t('الإعدادات التشغيلية', 'Paramètres opérationnels', 'Operational Settings')}
                        </h3>
                        {/* Departure date */}
                        <div>
                          <label className="text-[12px] text-[var(--text-muted)] font-medium block mb-2">
                            {t('تاريخ المغادرة القادمة', 'Prochaine date de départ', 'Next Departure Date')}
                          </label>
                          <div className="flex items-center gap-3 flex-wrap">
                            <GlassDate value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} className="input h-9 w-48" />
                            <button onClick={saveDepartureDate} disabled={savingDate} className="btn btn-primary text-sm">
                              {savingDate ? t('جاري الحفظ...', 'Enregistrement...', 'Saving...') : t('حفظ', 'Enregistrer', 'Save')}
                            </button>
                            {dateSaved && (
                              <span className="flex items-center gap-1.5 text-xs text-[var(--success)]">
                                <CheckCircle2 className="h-3.5 w-3.5" />{t('تم الحفظ!', 'Enregistré!', 'Saved!')}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Rows per page */}
                        <div>
                          <label className="text-[12px] text-[var(--text-muted)] font-medium block mb-2">
                            {t('عدد الصفوف في الصفحة', 'Lignes par page', 'Rows per page')}
                          </label>
                          <div className="flex items-center gap-2">
                            {[25, 50, 100].map(n => {
                              const cur = parseInt(typeof window !== 'undefined' ? (localStorage.getItem('admin-rows-per-page') ?? '50') : '50', 10);
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${cur === n ? 'bg-brand-500 text-white border-brand-500' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-brand-400'}`}
                                  onClick={() => { localStorage.setItem('admin-rows-per-page', String(n)); window.dispatchEvent(new Event('storage')); }}
                                >
                                  {n}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* 3. System Status */}
                      <div className="card p-5 space-y-4">
                        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                          <Gauge className="h-4 w-4 text-brand-500" />
                          {t('حالة النظام', 'État du système', 'System Status')}
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wide">
                              {t('اتصال Supabase', 'Connexion Supabase', 'Supabase Connection')}
                            </span>
                            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${
                              dashboardRealtimeStatus === 'LIVE' ? 'text-emerald-600' :
                              dashboardRealtimeStatus === 'CONNECTING' ? 'text-amber-500' : 'text-[var(--text-muted)]'
                            }`}>
                              <span className={`h-2 w-2 rounded-full ${dashboardRealtimeStatus === 'LIVE' ? 'bg-emerald-500 animate-pulse' : dashboardRealtimeStatus === 'CONNECTING' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                              {dashboardRealtimeStatus}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wide">
                              {t('إصدار البناء', 'Version de build', 'Build Version')}
                            </span>
                            <span className="text-sm font-medium text-[var(--text-primary)]">1.1.0</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wide">
                              {t('المنطقة الزمنية', 'Fuseau horaire', 'Timezone')}
                            </span>
                            <span className="text-sm font-medium text-[var(--text-primary)]">{agencyConfig.timezone}</span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wide">
                              {t('اللغة الافتراضية', 'Langue par défaut', 'Default Language')}
                            </span>
                            <span className="text-sm font-medium text-[var(--text-primary)]">{lang.toUpperCase()}</span>
                          </div>
                        </div>
                      </div>

                      {/* 4. Auth & Security */}
                      <div className="card p-5 space-y-4">
                        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-brand-500" />
                          {t('الجلسة والأمان', 'Session & Sécurité', 'Session & Security')}
                        </h3>
                        {session ? (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium text-[var(--text-primary)]">{session.user.email}</div>
                              <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
                                {t('آخر دخول:', 'Dernière connexion:', 'Last sign in:')} {session.user.last_sign_in_at ? new Date(session.user.last_sign_in_at).toLocaleString() : '—'}
                              </div>
                            </div>
                            <button
                              onClick={handleLogout}
                              className="btn border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-900/20 text-sm"
                            >
                              {t('تسجيل الخروج', 'Déconnexion', 'Sign out')}
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm text-[var(--text-muted)]">{t('لا توجد جلسة نشطة.', 'Aucune session active.', 'No active session.')}</p>
                        )}
                      </div>
                    </div>
                  );
                
}
