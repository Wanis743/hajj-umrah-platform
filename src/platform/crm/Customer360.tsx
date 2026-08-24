/**
 * CRM workspace (V12 §17.8 — platform component; replaces crm/v10 trio).
 *
 * §6: lead list, opportunity pipeline with open value, quotes — all from
 * the real server objects via crmService. Liquid glass; truthful states.
 */

import React, { useEffect, useState } from 'react';
import { getCrmSnapshot, type CrmPipelineSnapshot } from './crmService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly snapshot: CrmPipelineSnapshot };

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function Customer360() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void getCrmSnapshot().then((r) => {
      if (cancelled) return;
      if (!r.ok) setState({ kind: 'error', message: r.error.message });
      else setState({ kind: 'ready', snapshot: r.value });
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Customer 360</h2>
        {state.kind === 'ready' ? (
          <p className="mt-1 text-sm text-white/55">
            Open pipeline{' '}
            <span className="font-mono text-white/85">{fmt.format(state.snapshot.openPipelineValue)}</span>
            {' '}· {state.snapshot.leads.length} leads · {state.snapshot.opportunities.length} opportunities
          </p>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading CRM…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <h3 className="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Opportunities</h3>
          {state.snapshot.opportunities.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No opportunities yet.</div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Expected close</th>
                </tr>
              </thead>
              <tbody>
                {state.snapshot.opportunities.map((o) => (
                  <tr key={o.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2">{o.name}</td>
                    <td className="px-3 py-2 text-white/60">{o.stage}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(o.amount)}</td>
                    <td className="px-3 py-2 text-white/50">{o.expectedCloseDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Quotes</h3>
          {state.snapshot.quotes.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No quotes yet.</div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Quote #</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Valid until</th>
                </tr>
              </thead>
              <tbody>
                {state.snapshot.quotes.map((q) => (
                  <tr key={q.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2 font-mono">{q.quoteNumber}</td>
                    <td className={`px-3 py-2 ${q.status === 'ACCEPTED' ? 'text-emerald-300' : 'text-white/60'}`}>{q.status}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(q.totalAmount)}</td>
                    <td className="px-3 py-2 text-white/50">{q.validUntil ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Leads</h3>
          {state.snapshot.leads.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No leads yet.</div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {state.snapshot.leads.map((l) => (
                  <tr key={l.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2">{l.firstName} {l.lastName}</td>
                    <td className="px-3 py-2 text-white/55">{l.email || l.phone || '—'}</td>
                    <td className="px-3 py-2 text-white/60">{l.status}</td>
                    <td className="px-3 py-2 text-white/50">{l.source || '—'}</td>
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
