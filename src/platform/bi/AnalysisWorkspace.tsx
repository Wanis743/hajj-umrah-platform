/**
 * Analysis Workspace (V12 §17.8 — platform component; replaces bi/v10).
 *
 * §8/§23: metrics come from the certified semantic layer only. When no
 * metrics exist we show a truthful empty state — the v10 fallback of fake
 * revenue/visa numbers is a directive violation and is not reproduced.
 */

import React, { useEffect, useState } from 'react';
import {
  getDatasets,
  getMetrics,
  type BiDatasetDTO,
  type BiMetricDTO,
} from './semanticService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly datasets: readonly BiDatasetDTO[]; readonly metrics: readonly BiMetricDTO[] };

export function AnalysisWorkspace() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const datasets = await getDatasets();
      if (!datasets.ok) {
        if (!cancelled) setState({ kind: 'error', message: datasets.error.message });
        return;
      }
      const metrics = await getMetrics();
      if (!metrics.ok) {
        if (!cancelled) setState({ kind: 'error', message: metrics.error.message });
        return;
      }
      if (!cancelled) setState({ kind: 'ready', datasets: datasets.value, metrics: metrics.value });
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Analysis Workspace</h2>
        <p className="mt-1 text-sm text-white/55">Certified semantic-layer metrics</p>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading semantic layer…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <h3 className="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">
            Datasets ({state.datasets.length})
          </h3>
          {state.datasets.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">
              No datasets registered yet. Register a dataset to begin building certified metrics.
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              {state.datasets.map((d) => (
                <div key={d.id} className="glass-card rounded-xl p-4">
                  <div className="text-sm font-medium text-white/85">{d.name}</div>
                  <div className="mt-1 text-xs text-white/50">{d.description || 'No description'}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className={d.status === 'ACTIVE' ? 'text-emerald-300' : 'text-amber-300'}>{d.status}</span>
                    {d.owner !== null ? <span className="text-white/40">· {d.owner.slice(0, 8)}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">
            Metrics ({state.metrics.length})
          </h3>
          {state.metrics.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">
              No metrics defined yet. Define a metric with formula + grain, get it certified,
              then dashboards can consume it.
            </div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Grain</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.metrics.map((m) => (
                  <tr key={m.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2 font-mono">{m.key}</td>
                    <td className="px-3 py-2">{m.displayName}</td>
                    <td className="px-3 py-2 text-white/55">{m.grain}</td>
                    <td className={`px-3 py-2 ${m.status === 'CERTIFIED' ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {m.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}
