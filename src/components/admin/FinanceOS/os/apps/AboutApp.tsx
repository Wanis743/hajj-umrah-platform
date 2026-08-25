import React from 'react';
import { Zap, Cpu, Database, Globe } from 'lucide-react';
import { OS_CODENAME, OS_VERSION } from '../osTypes';
import { useOS } from '../OSContext';
import { isSupabaseConfigured } from '@/lib/supabase';

/** "About This Mac"-style window for Finance OS. */
export function AboutApp() {
  const { tr, openApp, closeAllWindows } = useOS();

  return (
    <div className="flex h-full flex-col items-center pt-4 text-center">
      <span className="fos-boot-logo flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-700 shadow-[0_10px_40px_rgba(99,102,241,0.45)]">
        <Zap className="h-8 w-8 text-white" />
      </span>
      <h3 className="mt-4 text-xl font-bold tracking-[0.25em] text-white">
        FINANCE <span className="font-light text-white/60">OS</span>
      </h3>
      <p className="mt-1 text-xs text-white/45">
        {OS_CODENAME} · {tr('الإصدار', 'Version', 'Version')} {OS_VERSION}
      </p>

      <p className="mt-4 max-w-[300px] text-xs leading-relaxed text-white/55">
        {tr(
          'بيئة سطح مكتب مالية متكاملة للحج والعمرة: يومية، تسوية، ميزانية وتقارير — كلها تعمل فوق دفاتر حقيقية.',
          'Un environnement de bureau financier complet pour le Hajj et la Omra — journal, rapprochement, budgets et états, adossés au grand livre.',
          'A complete finance desktop for Hajj & Umrah operations — journal, reconciliation, budgets and statements, all on top of the real ledger.',
        )}
      </p>

      <div className="mt-5 w-full space-y-2 border-t border-white/10 pt-4 text-start text-xs">
        <Spec icon={<Cpu className="h-3.5 w-3.5 text-indigo-400" />} k={tr('النواة', 'Noyau', 'Kernel')} v={`financed ${OS_VERSION}`} />
        <Spec
          icon={<Database className="h-3.5 w-3.5 text-emerald-400" />}
          k={tr('مصدر البيانات', 'Source de données', 'Data source')}
          v={isSupabaseConfigured ? 'Supabase · live' : tr('غير مهيأ', 'Non configuré', 'Not configured')}
        />
        <Spec icon={<Globe className="h-3.5 w-3.5 text-sky-400" />} k={tr('الواجهة', 'Interface', 'UI')} v="React 18 · Vite" />
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
      <span className="font-medium text-white/85">{v}</span>
    </div>
  );
}
