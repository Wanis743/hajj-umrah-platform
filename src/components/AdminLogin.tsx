import { useState } from 'react';
import { Lock, Loader2, AlertCircle, ArrowLeft, Eye, EyeOff, Shield, Check } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { useRouter } from '@/router/RouterProvider';
import { supabase } from '@/lib/supabase';
import { toUserMessage } from '@/lib/errors';
import { agencyConfig } from '@/config/agency';

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
    setLoading(true);
    setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
        return;
      }
      navigate('admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full rounded-xl border border-sand-200 bg-sand-50/80 px-4 py-3.5 text-sand-900 placeholder:text-sand-400 transition-all focus:border-oasis-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-oasis-500/10 dark:border-sand-700 dark:bg-sand-950/60 dark:text-sand-100 dark:placeholder:text-sand-500 dark:focus:bg-sand-950';

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-sand-950">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-0 h-[500px] w-[500px] rounded-full bg-oasis-600/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-brand-400/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 flex w-full flex-col lg:flex-row">
        {/* Brand panel */}
        <div className="relative hidden flex-1 flex-col justify-between overflow-hidden p-12 lg:flex">
          <div className="absolute inset-0 bg-gradient-to-br from-oasis-900/80 via-sand-950 to-sand-950" />
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: 'linear-gradient(135deg, rgba(14, 65, 54, .95), rgba(20, 30, 25, .98))',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-sand-950 via-sand-950/60 to-transparent" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-oasis-200 backdrop-blur-sm">
              <Shield className="h-3.5 w-3.5" />
              {t.admin.securePortal}
            </div>
          </div>

          <div className="relative max-w-lg">
            <h2 className="font-serif text-4xl font-bold leading-tight text-white xl:text-5xl">
              {t.admin.loginBrand}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-sand-300/90">{t.admin.loginSubtitle}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {[t.admin.featureManage, t.admin.featureTrack, t.admin.featureSettings].map((feat) => (
                <span
                  key={feat}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-sand-200 ring-1 ring-white/10"
                >
                  <Check className="h-3 w-3 text-brand-400" />
                  {feat}
                </span>
              ))}
            </div>
          </div>

          <p className="relative text-xs text-sand-500">© {agencyConfig.name}</p>
        </div>

        {/* Form panel */}
        <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8 lg:max-w-xl lg:px-12">
          <div className="w-full max-w-md">
            <button
              onClick={() => navigate('home')}
              className="mb-8 flex items-center gap-2 text-sm text-sand-400 transition-colors hover:text-oasis-300 lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              {t.admin.backToSite}
            </button>

            <div className="rounded-xl border border-white/10 bg-white/5 p-8 shadow-md backdrop-blur-xl sm:p-10">
              <div className="mb-8">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-oasis-500 to-oasis-700 text-white shadow-lg shadow-oasis-900/40">
                  <Lock className="h-7 w-7" />
                </span>
                <h1 className="mt-5 font-serif text-2xl font-bold text-white sm:text-3xl">{t.admin.loginTitle}</h1>
                <p className="mt-2 text-sm text-sand-400">{t.admin.loginFormHint}</p>
              </div>

              <form data-testid="admin-login-form" onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="admin-email" className="mb-2 block text-sm font-medium text-sand-300">{t.admin.email}</label>
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
                <div>
                  <label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-sand-300">{t.admin.password}</label>
                  <div className="relative">
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
                      aria-label={showPassword ? (t.admin.hidePassword || "Hide password") : (t.admin.showPassword || "Show password")}
                      className="absolute top-1/2 -translate-y-1/2 text-sand-400 transition-colors hover:text-sand-200 ltr:right-3 rtl:left-3"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-oasis-600 to-oasis-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-oasis-900/30 transition-all hover:from-oasis-500 hover:to-oasis-400 hover:shadow-oasis-900/40 disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      {t.admin.signingIn}
                    </>
                  ) : (
                    t.admin.signIn
                  )}
                </button>
              </form>

              <button
                onClick={() => navigate('home')}
                className="mt-6 hidden w-full items-center justify-center gap-2 text-sm text-sand-500 transition-colors hover:text-oasis-300 lg:flex"
              >
                <ArrowLeft className="h-4 w-4" />
                {t.admin.backToSite}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
