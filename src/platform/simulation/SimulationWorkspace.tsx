/**
 * Simulation & Optimization workspace (V12 §17.8 — platform component;
 * replaces simulation/v10 pair). §11: jobs run against snapshots, results
 * are server-authoritative, shown with truthful status.
 */

import React, { useEffect, useState } from 'react';
import {
  getOptimizationJobs,
  getSimulationJobs,
  type OptimizationJobDTO,
  type SimulationJobDTO,
} from './simulationService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly sims: readonly SimulationJobDTO[];
      readonly opts: readonly OptimizationJobDTO[];
    };

const statusColor = (s: string): string => {
  const up = s.toUpperCase();
  if (up === 'COMPLETED' || up === 'DONE') return 'text-emerald-300';
  if (up === 'FAILED' || up === 'ERROR') return 'text-rose-300';
  if (up === 'RUNNING') return 'text-sky-300';
  return 'text-amber-300';
};

export function SimulationWorkspace() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sims = await getSimulationJobs();
      if (!sims.ok) { if (!cancelled) setState({ kind: 'error', message: sims.error.message }); return; }
      const opts = await getOptimizationJobs();
      if (!opts.ok) { if (!cancelled) setState({ kind: 'error', message: opts.error.message }); return; }
      if (!cancelled) setState({ kind: 'ready', sims: sims.value, opts: opts.value });
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Simulation Sandbox</h2>
        {state.kind === 'ready' ? (
          <p className="mt-1 text-sm text-white/55">
            {state.sims.length} simulations · {state.opts.length} optimization runs
          </p>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading job history…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <h3 className="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Simulations</h3>
          {state.sims.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No simulation runs yet.</div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {state.sims.map((j) => (
                  <tr key={j.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2">{j.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-white/60">{j.type}</td>
                    <td className={`px-3 py-2 ${statusColor(j.status)}`}>{j.status}</td>
                    <td className="px-3 py-2 text-white/50">{j.completedAt?.slice(0, 19).replace('T', ' ') ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Optimization</h3>
          {state.opts.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No optimization runs yet.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {state.opts.map((o) => (
                <div key={o.id} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <div className="text-sm text-white/85">{o.name}</div>
                    <div className="font-mono text-xs text-white/50">{o.objectiveFunction}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs ${statusColor(o.status)}`}>{o.status}</div>
                    <div className="font-mono text-[10px] text-white/35">{o.feasibleSolutions} feasible solutions</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
