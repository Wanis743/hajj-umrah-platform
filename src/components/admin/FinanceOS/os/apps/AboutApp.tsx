import React from 'react';
import { BookOpen, Database, Globe, User } from 'lucide-react';
import { APP_VERSION } from '../osTypes';
import { useOS } from '../OSContext';
import { isSupabaseConfigured, supabaseUrl } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { agencyConfig } from '@/config/agency';

/** System information window: real facts about this deployment. */
export function AboutApp() {
  const { tr, openApp, closeAllWindows } = useOS();
  const { session } = useAuth();

  const host = (() => {
    try { return new URL(String(supabaseUrl ?? '')).host; } catch { return String(supabaseUrl ?? ''); }
  })();

  return (
    <div className="flex h-full flex-col items-center pt-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06]">
        <BookOpen className="h-6 w-6 text-white/85" strokeWidth={1.6} />
      </span>
      <h3 className="mt-3 text-base font-semibold text-white">{agencyConfig.name}</h3>
      <p className="mt-0.5 text-xs text-white/45">
        {tr('النظام المالي', 'Système financier', 'Finance workspace')} · {tr('الإصدار', 'Version', 'Version')} {APP_VERSION}
      </p>

      <div className="mt-5 w-full space-y-2 border-t border-white/10 pt-4 text-start text-xs">
        <Spec
          icon={<User className="h-3.5 w-3.5 text-white/50" />}
          k={tr('الحساب', 'Compte', 'Account')}
          v={session?.user?.email ?? tr('ضيف', 'Invité', 'Guest')}
        />
        <Spec
          icon={<Database className="h-3.5 w-3.5 text-white/50" />}
          k={tr('قاعدة البيانات', 'Base de données', 'Database')}
          v={isSupabaseConfigured ? host : tr('غير مهيأة', 'Non configurée', 'Not configured')}
        />
        <Spec icon={<Globe className="h-3.5 w-3.5 text-white/50" />} k={tr('الواجهة', 'Interface', 'UI')} v="React 18 · Vite" />
      </div>

      <div className="mt-auto flex w-full gap-2 pb-1 pt-5">
        <button className="btn btn-sm btn-primary flex-1" onClick={() => openApp('settings')}>
          {tr('الإعدادات…', 'Réglages…', 'Open Settings…')}
        </button>
        <button className="btn btn-sm flex-1" onClick={closeAllWindows}>
          {tr('إغلاق الكل', 'Tout fermer', 'Close All')}
        </button>
      </div>
    </div>
  );
}

function Spec({ icon, k, v }: { icon: React.ReactNode; k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2">
      <span className="flex items-center gap-2 text-white/45">{icon}{k}</span>
      <span className="max-w-[55%] truncate font-medium text-white/85">{v}</span>
    </div>
  );
}
