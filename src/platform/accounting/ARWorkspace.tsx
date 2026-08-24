/**
 * A/R Workspace (V12 §17.4 — platform component; replaces v10/ARWorkspace).
 *
 * §5.3: invoices with outstanding balances derived from authoritative state,
 * aging summary. Liquid-glass design language; truthful empty states.
 */

import React, { useEffect, useState } from 'react';
import { getArSnapshot, type ArSnapshot } from './arService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly snapshot: ArSnapshot };

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusChip = (status: string): string =>
  status === 'PAID'
    ? 'text-emerald-300'
    : status === 'PARTIAL'
      ? 'text-sky-300'
      : 'text-amber-300';

export function ARWorkspace() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void getArSnapshot().then((result) => {
      if (cancelled) return;
      if (!result.ok) setState({ kind: 'error', message: result.error.message });
      else setState({ kind: 'ready', snapshot: result.value });
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Accounts Receivable</h2>
        {state.kind === 'ready' ? (
          <p className="mt-1 text-sm text-white/55">
            Total outstanding{' '}
            <span className="font-mono text-white/85">{fmt.format(state.snapshot.totalOutstanding)}</span>
          </p>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading receivables…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load A/R: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <div className="mt-4 grid grid-cols-4 gap-3">
            {(
              [
                ['Current', state.snapshot.aging.current],
                ['31–60 days', state.snapshot.aging.days30],
                ['61–90 days', state.snapshot.aging.days60],
                ['90+ days', state.snapshot.aging.days90Plus],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="glass-card rounded-xl p-4">
                <div className="text-xs text-white/50">{label}</div>
                <div className="mt-1 font-mono text-sm text-white/85">{fmt.format(value)}</div>
              </div>
            ))}
          </div>

          {state.snapshot.invoices.length === 0 ? (
            <div className="mt-6 text-sm text-white/50">No issued invoices yet.</div>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Issued</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.snapshot.invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2 font-mono">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2 text-white/55">{inv.issuedAt.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(inv.total)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(inv.paid)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(inv.outstanding)}</td>
                    <td className={`px-3 py-2 ${statusChip(inv.status)}`}>{inv.status}</td>
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
