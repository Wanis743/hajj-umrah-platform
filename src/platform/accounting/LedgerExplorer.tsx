/**
 * Ledger Explorer (V12 §17.4 — platform component; replaces v10/LedgerExplorer).
 *
 * §5.2: account list with authoritative balances; drill balance -> journal
 * entries -> source transaction id. Liquid-glass design language. Truthful
 * empty/loading/error states — no mock data.
 */

import React, { useEffect, useState } from 'react';
import {
  getAccountBalances,
  getAccountLedger,
  type AccountBalanceDTO,
  type LedgerDrillResult,
} from './ledgerService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'accounts'; readonly accounts: readonly AccountBalanceDTO[] }
  | { readonly kind: 'drill'; readonly drill: LedgerDrillResult };

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function LedgerExplorer() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void getAccountBalances().then((result) => {
      if (cancelled) return;
      if (!result.ok) setState({ kind: 'error', message: result.error.message });
      else setState({ kind: 'accounts', accounts: result.value });
    });
    return () => { cancelled = true; };
  }, []);

  const openDrill = (accountId: string): void => {
    setState({ kind: 'loading' });
    void getAccountLedger(accountId).then((result) => {
      if (!result.ok) setState({ kind: 'error', message: result.error.message });
      else setState({ kind: 'drill', drill: result.value });
    });
  };

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white/90">
            {state.kind === 'drill' ? `Ledger — ${state.drill.account.code} ${state.drill.account.name}` : 'Chart of Accounts'}
          </h2>
          {state.kind === 'drill' ? (
            <button
              className="glass-btn rounded-lg px-3 py-1.5 text-sm text-white/80 hover:text-white"
              onClick={() => {
                setState({ kind: 'loading' });
                void getAccountBalances().then((r) => {
                  if (r.ok) setState({ kind: 'accounts', accounts: r.value });
                });
              }}
            >
              ← Back to accounts
            </button>
          ) : null}
        </div>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading ledger…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load ledger: {state.message}
        </div>
      ) : null}

      {state.kind === 'accounts' ? (
        state.accounts.length === 0 ? (
          <div className="mt-6 text-sm text-white/50">No accounts exist yet.</div>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-white/45">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {state.accounts.map((a) => (
                <tr key={a.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                  <td className="px-3 py-2 font-mono">{a.code}</td>
                  <td className="px-3 py-2">{a.name}</td>
                  <td className="px-3 py-2 text-white/55">{a.type}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt.format(a.balance)}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="glass-btn rounded-lg px-2.5 py-1 text-xs text-white/75" onClick={() => openDrill(a.id)}>
                      Drill →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {state.kind === 'drill' ? (
        state.drill.entries.length === 0 ? (
          <div className="mt-6 text-sm text-white/50">No journal activity for this account yet.</div>
        ) : (
          <div className="mt-4 space-y-3">
            {state.drill.entries.map((e) => (
              <div key={e.id} className="glass-card rounded-xl p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-white/90">{e.reference || '(no reference)'}</span>
                  <span className={e.status === 'POSTED' ? 'text-emerald-300' : 'text-amber-300'}>{e.status}</span>
                </div>
                <div className="mt-1 text-xs text-white/50">
                  {e.entryDate} · {e.description}
                  {e.sourceId !== null ? (
                    <>
                      {' '}· source{' '}
                      <span className="font-mono text-white/70">{e.sourceType}:{e.sourceId.slice(0, 8)}</span>
                    </>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1">
                  {e.lines.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-xs text-white/70">
                      <span>{l.memo || l.currencyCode}</span>
                      <span className="font-mono">
                        D {fmt.format(l.debit)} · C {fmt.format(l.credit)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
