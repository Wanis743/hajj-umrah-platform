import { useState } from 'react';
import {
  LockKeyhole,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Shield,
  ShieldCheck,
  Check,
  Mail,
  Lock,
} from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { toUserMessage } from '@/lib/errors';
import { agencyConfig } from '@/config/agency';

/** Line-art Kaaba emblem — gold strokes over translucent faces. */
function KaabaMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 108" fill="none" aria-hidden="true" className={className}>
      <path
        d="M14 38 50 18 86 38 50 58Z"
        fill="rgba(224,182,90,0.10)"
        stroke="#c99a3e"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 38 50 58 50 97 14 77Z"
        fill="rgba(224,182,90,0.06)"
        stroke="#c99a3e"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M86 38 50 58 50 97 86 77Z"
        fill="rgba(224,182,90,0.03)"
        stroke="#c99a3e"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Kiswa band */}
      <path d="M14 47 50 67 86 47" stroke="#e0b65a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Repeating eight-point-star lattice used as a faint background texture. */
const STAR_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='76' height='76' viewBox='0 0 76 76'%3E%3Cg fill='none' stroke='%23e0b65a' stroke-opacity='0.5'%3E%3Crect x='27.5' y='27.5' width='21' height='21'/%3E%3Crect x='27.5' y='27.5' width='21' height='21' transform='rotate(45 38 38)'/%3E%3C/g%3E%3C/svg%3E\")";

export default function AdminLogin() {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isSupabaseConfigured) {
      setError(t.admin.backendNotConfigured);
      return;
    }
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(toUserMessage(authError));
        return;
      }
      navigate('admin');
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const features = [t.admin.featureManage, t.admin.featureTrack, t.admin.featureSettings];

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-white/[0.045] py-3 ps-11 pe-4 text-[15px] text-sand-50 placeholder:text-sand-400/50 transition-all duration-200 focus:border-gold-400/60 focus:bg-white/[0.08] focus:outline-none focus:ring-4 focus:ring-gold-400/10';

  return (
    <div
      className="relative flex min-h-screen overflow-hidden"
      style={{
        background:
          'radial-gradient(1100px 560px at 82% -10%, rgba(201,154,62,0.14), transparent 60%), radial-gradient(950px 520px at -8% 112%, rgba(63,138,91,0.20), transparent 55%), linear-gradient(165deg, #0d2417 0%, #08170f 55%, #1a130c 130%)',
      }}
    >
      {/* Geometric star lattice + vignette */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.055]"
        style={{ backgroundImage: STAR_PATTERN, backgroundSize: '76px 76px' }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 50% 40%, transparent 55%, rgba(4,12,8,0.75) 100%)' }}
      />

      <div className="relative z-10 flex w-full flex-col lg:flex-row">
        {/* Brand panel (desktop) */}
        <div className="relative hidden flex-1 flex-col justify-between p-14 xl:p-20 lg:flex">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-b from-white/[0.08] to-white/[0.02] ring-1 ring-gold-400/30">
                <KaabaMark className="h-7 w-7" />
              </span>
              <span className="text-sm font-semibold tracking-widest text-gold-400/90">
                {agencyConfig.name}
              </span>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-sand-100/80 backdrop-blur-sm">
              <Shield className="h-3.5 w-3.5 text-gold-400" />
              {t.admin.securePortal}
            </span>
          </div>

          <div className="max-w-xl">
            <div className="mb-7 flex items-center gap-3">
              <span className="h-px w-14 bg-gradient-to-r from-gold-500 to-transparent" />
              <span className="h-1.5 w-1.5 rotate-45 bg-gold-400" />
            </div>
            <h2 className="font-serif text-5xl font-bold leading-[1.15] text-white xl:text-6xl">
              {t.admin.loginBrand}
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-sand-100/65">
              {t.admin.loginSubtitle}
            </p>

            <ul className="mt-10 space-y-4">
              {features.map((feat) => (
                <li key={feat} className="flex items-center gap-3.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-400/15 ring-1 ring-gold-400/25">
                    <Check className="h-3.5 w-3.5 text-gold-400" />
                  </span>
                  <span className="text-[15px] font-medium text-sand-100/80">{feat}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs tracking-wide text-sand-200/40">© {agencyConfig.name}</p>
        </div>

        {/* Form panel */}
        <div className="flex flex-1 items-center justify-center px-4 py-14 sm:px-8 lg:max-w-[560px] lg:px-12">
          <div className="w-full max-w-md animate-slide-up">
            {/* Mobile brand row */}
            <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b from-white/[0.08] to-white/[0.02] ring-1 ring-gold-400/30">
                <KaabaMark className="h-9 w-9" />
              </span>
              <span className="text-sm font-semibold tracking-widest text-gold-400/90">
                {agencyConfig.name}
              </span>
            </div>

            {/* Gradient hairline frame around the glass card */}
            <div className="rounded-2xl bg-gradient-to-b from-gold-400/40 via-white/10 to-oasis-400/20 p-px shadow-2xl shadow-black/50">
              <div className="rounded-[calc(1rem-1px)] bg-[#0c2015]/90 px-7 py-9 backdrop-blur-xl sm:px-10 sm:py-11">
                <div className="mb-8">
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-b from-gold-400/20 to-gold-600/5 ring-1 ring-gold-400/30">
                    <LockKeyhole className="h-6 w-6 text-gold-400" />
                  </span>
                  <h1 className="mt-5 font-serif text-3xl font-bold text-white">{t.admin.loginTitle}</h1>
                  <p className="mt-2 text-sm leading-relaxed text-sand-200/55">{t.admin.loginFormHint}</p>
                </div>

                <form data-testid="admin-login-form" onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label htmlFor="admin-email" className="mb-2 block text-[13px] font-medium text-sand-100/80">
                      {t.admin.email}
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-sand-400/60" />
                      <input
                        id="admin-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@example.com"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="admin-password" className="mb-2 block text-[13px] font-medium text-sand-100/80">
                      {t.admin.password}
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-sand-400/60" />
                      <input
                        id="admin-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${inputCls} pe-12`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? t.admin.hidePassword : t.admin.showPassword}
                        className="absolute end-3.5 top-1/2 -translate-y-1/2 text-sand-400/70 transition-colors hover:text-gold-300"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[13px] leading-relaxed text-red-200 animate-fade-in">
                      <AlertCircle className="mt-px h-4 w-4 shrink-0 text-red-300" />
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="group relative mt-1 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-gold-600 via-gold-500 to-gold-400 py-3.5 text-[15px] font-bold text-oasis-950 shadow-lg shadow-gold-600/20 transition-all duration-200 hover:-translate-y-px hover:shadow-xl hover:shadow-gold-500/25 hover:brightness-105 active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-400/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                  >
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 to-transparent opacity-30" />
                    {loading ? (
                      <>
                        <Loader2 className="h-[18px] w-[18px] animate-spin" />
                        {t.admin.signingIn}
                      </>
                    ) : (
                      t.admin.signIn
                    )}
                  </button>
                </form>

                <div className="mt-8 flex flex-col items-center gap-4">
                  <button
                    onClick={() => navigate('home')}
                    className="flex items-center gap-2 text-[13px] font-medium text-sand-300/60 transition-colors hover:text-gold-300"
                  >
                    <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                    {t.admin.backToSite}
                  </button>
                  <div className="flex items-center gap-1.5 text-[11px] text-sand-300/35">
                    <ShieldCheck className="h-3.5 w-3.5 text-gold-500/60" />
                    {t.admin.securePortal}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
