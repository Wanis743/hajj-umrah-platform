/**
 * FP&A workspace (V12 §17.8 — platform component; replaces the fpa/v10 trio).
 *
 * §10: models, scenario inheritance, planning cycles — from real server
 * objects only. The v10 fake "Revenue per Pilgrim" fallback is a §23
 * violation and is not reproduced.
 */

import React, { useEffect, useState } from 'react';
import {
  getFpaModels,
  getFpaScenarios,
  getPlanningCycles,
  type FpaCycleDTO,
  type FpaModelDTO,
  type FpaScenarioDTO,
} from './fpaService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly models: readonly FpaModelDTO[];
      readonly scenarios: readonly FpaScenarioDTO[];
      readonly cycles: readonly FpaCycleDTO[];
    };

export function ModelWorkspace() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const models = await getFpaModels();
      if (!models.ok) { if (!cancelled) setState({ kind: 'error', message: models.error.message }); return; }
      const scenarios = await getFpaScenarios();
      if (!scenarios.ok) { if (!cancelled) setState({ kind: 'error', message: scenarios.error.message }); return; }
      const cycles = await getPlanningCycles();
      if (!cycles.ok) { if (!cancelled) setState({ kind: 'error', message: cycles.error.message }); return; }
      if (!cancelled) setState({ kind: 'ready', models: models.value, scenarios: scenarios.value, cycles: cycles.value });
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">FP&A — Models &amp; Planning</h2>
        {state.kind === 'ready' ? (
          <p className="mt-1 text-sm text-white/55">
            {state.models.length} models · {state.scenarios.length} scenarios ·{' '}
            {state.cycles.length} planning cycles
          </p>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading FP&amp;A objects…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <h3 className="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Models</h3>
          {state.models.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No models defined yet.</div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Data type</th>
                </tr>
              </thead>
              <tbody>
                {state.models.map((m) => (
                  <tr key={m.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2">{m.name}</td>
                    <td className="px-3 py-2 text-white/60">{m.modelType}</td>
                    <td className="px-3 py-2 text-white/50">{m.dataType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Scenarios</h3>
          {state.scenarios.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No scenarios yet.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {state.scenarios.map((s) => (
                <div key={s.id} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <div className="text-sm text-white/85">{s.name}</div>
                    <div className="text-xs text-white/50">{s.description || 'No description'}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs ${s.status === 'PUBLISHED' || s.status === 'ACTIVE' ? 'text-emerald-300' : 'text-amber-300'}`}>{s.status}</div>
                    {s.baseVersionId !== null ? (
                      <div className="font-mono text-[10px] text-white/35">base:{s.baseVersionId.slice(0, 8)}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Planning cycles</h3>
          {state.cycles.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No planning cycles yet.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {state.cycles.map((c) => (
                <div key={c.id} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                  <span className="text-sm text-white/85">{c.name}</span>
                  <span className="text-xs text-white/55">
                    {c.startDate ?? '?'} → {c.endDate ?? '?'} · {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
