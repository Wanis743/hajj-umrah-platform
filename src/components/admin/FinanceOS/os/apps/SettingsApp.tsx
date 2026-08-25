import React from 'react';
import { BookOpen, Check, RotateCcw, XSquare, MonitorCog, Wifi, WifiOff } from 'lucide-react';
import { ACCENTS, WALLPAPERS } from '../theme';
import { APP_VERSION } from '../osTypes';
import { useOS } from '../OSContext';
import { useAuth } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * System settings: wallpaper, accent colour, desktop widgets and session
 * management, plus a truthful About block. Every switch is live — no
 * decorative controls.
 */
export function SettingsApp() {
  const { prefs, setPrefs, resetSession, closeAllWindows, windows, tr } = useOS();
  const { session } = useAuth();

  return (
    <div className="space-y-5">
      {/* Appearance */}
      <Section title={tr('خلفية سطح المكتب', 'Fond d’écran', 'Desktop wallpaper')}>
        <div className="grid grid-cols-4 gap-2">
          {WALLPAPERS.map((w) => {
            const active = prefs.wallpaper === w.id;
            return (
              <button
                key={w.id}
                onClick={() => setPrefs({ wallpaper: w.id })}
                className={`group rounded-xl border p-1.5 text-start transition-colors ${
                  active ? 'border-white/40 bg-white/10' : 'border-white/10 hover:bg-white/5'
                }`}
              >
                <span
                  className="block h-12 w-full rounded-lg shadow-inner"
                  style={{ background: w.swatch }}
                />
                <span className="mt-1.5 flex items-center justify-between px-0.5">
                  <span className="text-[11px] font-medium text-white/80">{tr(w.label.ar, w.label.fr, w.label.en)}</span>
                  {active && <Check className="h-3 w-3 text-emerald-400" />}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={tr('لون التمييز', 'Couleur d’accent', 'Accent color')}>
        <div className="flex gap-2.5">
          {ACCENTS.map((a) => {
            const active = prefs.accent === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setPrefs({ accent: a.id })}
                title={tr(a.label.ar, a.label.fr, a.label.en)}
                className="relative h-9 w-9 rounded-full transition-transform hover:scale-110"
                style={{ background: a.hex, boxShadow: active ? `0 0 0 2px #0a0c12, 0 0 0 4px ${a.hex}` : undefined }}
              >
                {active && <Check className="absolute inset-0 m-auto h-4 w-4 text-white" />}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Desktop */}
      <Section title={tr('سطح المكتب', 'Bureau', 'Desktop')}>
        <button
          onClick={() => setPrefs({ widgets: !prefs.widgets })}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.07]"
        >
          <span className="flex items-center gap-2.5">
            <MonitorCog className="h-4 w-4 text-sky-400" />
            <span className="text-start">
              <span className="block text-sm font-medium text-white/85">
                {tr('ودجات سطح المكتب', 'Widgets du bureau', 'Desktop widgets')}
              </span>
              <span className="block text-xs text-white/40">
                {tr('الساعة ونبض الدفاتر أعلى سطح المكتب', 'Horloge et pouls du grand livre', 'Clock and ledger pulse on the desktop')}
              </span>
            </span>
          </span>
          <span
            className={`relative h-6 w-11 flex-none rounded-full transition-colors ${prefs.widgets ? '' : 'bg-white/15'}`}
            style={prefs.widgets ? { background: 'var(--brand-500)' } : undefined}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${prefs.widgets ? 'start-[22px]' : 'start-0.5'}`}
            />
          </span>
        </button>
      </Section>

      {/* Session */}
      <Section title={tr('الجلسة', 'Session', 'Session')}>
        <div className="space-y-2">
          <ActionRow
            icon={<XSquare className="h-4 w-4 text-amber-400" />}
            title={tr('إغلاق كل النوافذ', 'Fermer toutes les fenêtres', 'Close all windows')}
            body={tr(`${windows.length} نافذة مفتوحة حالياً`, `${windows.length} fenêtre(s) ouverte(s)`, `${windows.length} window${windows.length === 1 ? '' : 's'} currently open`)}
            onClick={closeAllWindows}
            disabled={windows.length === 0}
          />
          <ActionRow
            icon={<RotateCcw className="h-4 w-4 text-rose-400" />}
            title={tr('إعادة تعيين التخطيط', 'Réinitialiser la disposition', 'Reset saved layout')}
            body={tr('يغلق النوافذ وينسى المواضع المحفوظة', 'Ferme les fenêtres et oublie les positions', 'Closes windows and forgets saved positions')}
            onClick={resetSession}
          />
        </div>
      </Section>

      {/* About */}
      <Section title={tr('حول النظام', 'À propos', 'About this system')}>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06]">
              <BookOpen className="h-5 w-5 text-white/85" strokeWidth={1.6} />
            </span>
            <div>
              <div className="text-sm font-semibold text-white">{tr('النظام المالي', 'Système financier', 'Finance workspace')}</div>
              <div className="text-xs text-white/45">
                {tr('الإصدار', 'Version', 'Version')} {APP_VERSION}
              </div>
            </div>
          </div>
          <dl className="mt-4 space-y-2 border-t border-white/10 pt-3 text-xs">
            <Row k={tr('الحساب', 'Compte', 'Account')} v={session?.user?.email ?? tr('ضيف', 'Invité', 'Guest')} />
            <Row
              k={tr('الاتصال بالخادم', 'Connexion serveur', 'Backend')}
              v={isSupabaseConfigured
                ? tr('متصل', 'Connecté', 'Connected')
                : tr('غير مهيأ (وضع غير متصل)', 'Non configuré (hors ligne)', 'Not configured (offline)')}
              vIcon={isSupabaseConfigured
                ? <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                : <WifiOff className="h-3.5 w-3.5 text-amber-400" />}
            />
          </dl>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">{title}</h4>
      {children}
    </section>
  );
}

function ActionRow({ icon, title, body, onClick, disabled }: {
  icon: React.ReactNode; title: string; body: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-start transition-colors hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      <span>
        <span className="block text-sm font-medium text-white/85">{title}</span>
        <span className="block text-xs text-white/40">{body}</span>
      </span>
    </button>
  );
}

function Row({ k, v, vIcon }: { k: string; v: string; vIcon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/40">{k}</dt>
      <dd className="flex items-center gap-1.5 truncate font-medium text-white/80">{vIcon}{v}</dd>
    </div>
  );
}
