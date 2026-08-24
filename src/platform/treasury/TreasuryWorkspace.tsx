/**
 * Treasury & Risk workspace (V12 §17.8 — platform component; replaces the
 * treasury/v10 trio). §12: cash position, controls with exceptions, risk
 * exposure — all server-authoritative, liquid glass, truthful states.
 */

import React, { useEffect, useState } from 'react';
import {
  getCashPositions,
  getFinancialControls,
  getRiskEvents,
  type CashPositionDTO,
  type FinancialControlDTO,
  type RiskEventDTO,
} from './treasuryService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly cash: readonly CashPositionDTO[];
      readonly controls: readonly FinancialControlDTO[];
      readonly risks: readonly RiskEventDTO[];
    };

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function TreasuryWorkspace() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cash = await getCashPositions();
      if (!cash.ok) { if (!cancelled) setState({ kind: 'error', message: cash.error.message }); return; }
      const controls = await getFinancialControls();
      if (!controls.ok) { if (!cancelled) setState({ kind: 'error', message: controls.error.message }); return; }
      const risks = await getRiskEvents();
      if (!risks.ok) { if (!cancelled) setState({ kind: 'error', message: risks.error.message }); return; }
      if (!cancelled) setState({ kind: 'ready', cash: cash.value, controls: controls.value, risks: risks.value });
    })();
    return () => { cancelled = true; };
  }, []);

  const latest = state.kind === 'ready' && state.cash.length > 0 ? state.cash[0] : null;

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Treasury &amp; Risk</h2>
        {latest !== null ? (
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div className="glass-card rounded-xl p-4">
              <div className="text-xs text-white/50">Expected inflows</div>
              <div className="mt-1 font-mono text-sm text-emerald-300">{fmt.format(latest.expectedInflows)}</div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="text-xs text-white/50">Expected outflows</div>
              <div className="mt-1 font-mono text-sm text-rose-300">{fmt.format(latest.expectedOutflows)}</div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="text-xs text-white/50">Net position ({latest.reportDate})</div>
              <div className={`mt-1 font-mono text-sm ${latest.netPosition >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {fmt.format(latest.netPosition)}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading treasury…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <h3 className="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">
            Controls ({state.controls.length})
          </h3>
          {state.controls.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No controls registered yet.</div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Tested</th>
                  <th className="px-3 py-2 text-right font-medium">Exceptions</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.controls.map((c) => (
                  <tr key={c.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2 font-mono">{c.controlCode}</td>
                    <td className="px-3 py-2 max-w-[24rem] truncate" title={c.description}>{c.description}</td>
                    <td className="px-3 py-2 text-right font-mono">{c.testPopulation}</td>
                    <td className={`px-3 py-2 text-right font-mono ${c.exceptions > 0 ? 'text-amber-300' : ''}`}>{c.exceptions}</td>
                    <td className={`px-3 py-2 ${c.status.toUpperCase() === 'EFFECTIVE' ? 'text-emerald-300' : 'text-white/60'}`}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">
            Risk events by exposure
          </h3>
          {state.risks.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No risk events yet.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {state.risks.map((r) => (
                <div key={r.id} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <div className="text-sm text-white/85">{r.eventName}</div>
                    {r.mitigations !== null ? (
                      <div className="max-w-[28rem] truncate text-xs text-white/45" title={r.mitigations}>{r.mitigations}</div>
                    ) : null}
                  </div>
                  <div className="text-right font-mono text-xs text-white/60">
                    P {r.probability.toFixed(2)} · I {r.impact.toFixed(2)}
                    <div className="text-sm text-amber-300">{fmt.format(r.expectedExposure)}</div>
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
