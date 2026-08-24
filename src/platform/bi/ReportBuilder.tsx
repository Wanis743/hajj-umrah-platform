/**
 * Report Builder (V12 §17.8 — platform component; replaces bi/v10).
 *
 * §8: reports are pages of data-bound visuals with versions and export.
 * The v10 fake "Executive Summary" page when no reports exist is a §23
 * violation; the platform version shows a truthful empty state.
 */

import React, { useEffect, useState } from 'react';
import { getReports, type BiReportDTO } from './semanticService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly reports: readonly BiReportDTO[] };

export function ReportBuilder() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void getReports().then((r) => {
      if (cancelled) return;
      if (!r.ok) setState({ kind: 'error', message: r.error.message });
      else setState({ kind: 'ready', reports: r.value });
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Report Builder</h2>
        <p className="mt-1 text-sm text-white/55">Pages of data-bound visualizations with export provenance</p>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading reports…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        state.reports.length === 0 ? (
          <div className="mt-6 glass-card rounded-xl p-5 text-sm text-white/55">
            No reports yet. A report is a saved layout of data-bound visualizations —
            build one from the Visualization Studio to see it listed here.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {state.reports.map((r) => (
              <div key={r.id} className="glass-card rounded-xl p-4">
                <div className="text-sm font-medium text-white/85">{r.title}</div>
                <div className="mt-1 text-xs text-white/50">{r.description || 'No description'}</div>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
