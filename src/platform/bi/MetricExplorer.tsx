/**
 * Metric Explorer (V12 §22 Phase B) — evaluates certified metrics and
 * drills through to source journal entries (§19.21). Liquid glass.
 */

import React, { useEffect, useState } from 'react';
import { getMetrics } from './semanticService.ts';
import {
  assertCertified,
  drillToSourceEntries,
  evaluateNetRevenuePerPilgrim,
  type MetricDrillTarget,
  type MetricValueRow,
} from './queryService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly rows: readonly MetricValueRow[] };

type DrillState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly period: string; readonly targets: readonly MetricDrillTarget[] };

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function MetricExplorer() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [metricKey, setMetricKey] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void getMetrics().then((r) => {
      if (cancelled) return;
      if (!r.ok) { setState({ kind: 'error', message: r.error.message }); return; }
      const certified = r.value.filter((m) => m.status === 'CERTIFIED');
      // Evaluate supported certified metric
      const supported = certified.find((m) => m.key === 'net_revenue_per_pilgrim');
      if (supported === undefined) {
        setState({ kind: 'ready', rows: [] });
        return;
      }
      const guard = assertCertified(supported);
      if (!guard.ok) { setState({ kind: 'error', message: guard.error.message }); return; }
      setMetricKey(supported.key);
      void evaluateNetRevenuePerPilgrim().then((e) => {
        if (cancelled) return;
        if (!e.ok) setState({ kind: 'error', message: e.error.message });
        else setState({ kind: 'ready', rows: e.value });
      });
    });
    return () => { cancelled = true; };
  }, []);

  const openDrill = (period: string): void => {
    setDrill({ kind: 'loading' });
    void drillToSourceEntries(period).then((r) => {
      if (!r.ok) setDrill({ kind: 'error', message: r.error.message });
      else setDrill({ kind: 'ready', period, targets: r.value });
    });
  };

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Metric Explorer</h2>
        <p className="mt-1 text-sm text-white/55">
          Certified metric evaluation with drill-through to source journals
        </p>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Evaluating…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' && metricKey !== null ? (
        <>
          <h3 className="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">
            {metricKey} — by month
          </h3>
          {state.rows.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">
              No posted revenue activity yet.
            </div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue (minor)</th>
                  <th className="px-3 py-2 text-right font-medium">Pilgrims</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.period} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2 font-mono">{r.period}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(r.revenueMinor)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(r.pilgrims)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.value === null ? <span className="text-white/35">n/a</span> : fmt.format(Math.round(r.value))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button className="glass-btn rounded-lg px-2.5 py-1 text-xs text-white/75" onClick={() => openDrill(r.period)}>
                        Drill →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {drill.kind === 'loading' ? (
            <p className="mt-4 text-sm text-white/50">Loading source entries…</p>
          ) : null}
          {drill.kind === 'error' ? (
            <p className="mt-4 text-sm text-red-300">{drill.message}</p>
          ) : null}
          {drill.kind === 'ready' ? (
            <>
              <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">
                Source journal entries — {drill.period}
              </h3>
              {drill.targets.length === 0 ? (
                <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">
                  No source entries found for this period.
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {drill.targets.map((t) => (
                    <div key={t.journalEntryId} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                      <div>
                        <span className="font-mono text-sm text-white/85">{t.reference || '(no ref)'}</span>
                        <span className="ml-3 text-xs text-white/50">{t.entryDate}</span>
                        {t.sourceType !== null ? (
                          <span className="ml-3 rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-xs text-sky-300">
                            {t.sourceType}:{t.sourceId?.slice(0, 8)}
                          </span>
                        ) : null}
                      </div>
                      <span className="font-mono text-sm text-white/70">{fmt.format(t.amountMinor)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </>
      ) : null}

      {state.kind === 'ready' && metricKey === null ? (
        <div className="mt-6 glass-card rounded-xl p-5 text-sm text-white/55">
          No certified evaluable metrics registered yet. Define a metric with formula + grain,
          certify it, then it can be evaluated here.
        </div>
      ) : null}
    </div>
  );
}
