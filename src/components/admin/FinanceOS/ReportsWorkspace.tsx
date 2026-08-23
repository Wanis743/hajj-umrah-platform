import React from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { FileBarChart, Download, Lock } from 'lucide-react';

export function ReportsWorkspace() {
  const { lang } = useI18n();
  const tFunc = (en: string, ar: string, fr: string) => lang === "ar" ? ar : lang === "fr" ? fr : en;
  const reports = [
    { title: 'Profit & Loss Statement', type: 'Statutory', date: 'Aug 2026', locked: true },
    { title: 'Balance Sheet', type: 'Statutory', date: 'Aug 2026', locked: true },
    { title: 'Cash Flow Forecast', type: 'Management', date: 'Live', locked: false },
    { title: 'Package Economics Analysis', type: 'Domain', date: 'Live', locked: false }
  ];

  return (
    <div className="h-full flex flex-col space-y-4">
      <h3 className="text-xl font-semibold text-[var(--text-primary)]">
        {tFunc('O O U,O U,OO1USO1', 'Rapports Financiers', 'Financial Reports')}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        {reports.map((r, i) => (
          <div key={i} className="p-4 bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl flex items-center justify-between">
            <div>
              <p className="font-semibold text-[var(--text-primary)]">{r.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px] uppercase font-bold text-[var(--text-secondary)]">{r.type}</span>
                <span className="text-xs text-[var(--text-muted)]">{r.date}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {r.locked && <Lock className="h-4 w-4 text-[var(--text-muted)]" />}
              <button className="icon-btn"><Download className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
