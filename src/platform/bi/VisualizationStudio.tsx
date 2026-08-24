/**
 * Visualization Studio (V12 §17.8 — platform component; replaces bi/v10).
 *
 * §8/§9/§23: visualizations are data-bound objects from bi_visualizations
 * (chart_type + measures + dimensions). Charts render only from real bound
 * data — the v10 hard-coded revenue/pie demo series is a directive violation
 * and is not reproduced. Empty state is truthful.
 */

import React, { useEffect, useState } from 'react';
import {
  getVisualizations,
  type BiVisualizationDTO,
} from './semanticService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly visuals: readonly BiVisualizationDTO[] };

export function VisualizationStudio() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void getVisualizations().then((r) => {
      if (cancelled) return;
      if (!r.ok) setState({ kind: 'error', message: r.error.message });
      else setState({ kind: 'ready', visuals: r.value });
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Visualization Studio</h2>
        <p className="mt-1 text-sm text-white/55">Data-bound visualizations from the semantic layer</p>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading visualizations…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        state.visuals.length === 0 ? (
          <div className="mt-6 glass-card rounded-xl p-5 text-sm text-white/55">
            No visualizations defined yet. A visualization binds a chart type to certified
            measures and dimensions of a dataset — create one to see it here.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {state.visuals.map((v) => (
              <div key={v.id} className="glass-card rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-white/[0.07] px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-white/75">
                    {v.chartType}
                  </span>
                  {v.reportId !== null ? (
                    <span className="font-mono text-xs text-white/40">report:{v.reportId.slice(0, 8)}</span>
                  ) : null}
                </div>
                <div className="mt-3 space-y-1 text-xs">
                  <div className="text-white/55">
                    Measures: {v.measures.length > 0
                      ? v.measures.map((m) => <span key={m} className="mr-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">{m}</span>)
                      : <span className="italic text-white/35">none bound</span>}
                  </div>
                  <div className="text-white/55">
                    Dimensions: {v.dimensions.length > 0
                      ? v.dimensions.map((d) => <span key={d} className="mr-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-300">{d}</span>)
                      : <span className="italic text-white/35">none bound</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
