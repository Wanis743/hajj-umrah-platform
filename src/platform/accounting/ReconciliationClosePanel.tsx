/**
 * Reconciliation & Close panel (V12 §17.4 — platform component).
 *
 * §5.5/§5.6: statement transactions with server-side matching engine,
 * close readiness gates derived from real state, close action gated.
 * Liquid glass; truthful states only.
 */

import React, { useEffect, useState } from 'react';
import {
  getStatement,
  runAutoReconcile,
  type StatementWithTransactions,
} from './reconciliationService.ts';
import {
  getCloseReadiness,
  type CloseReadiness,
} from './closeService.ts';

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ReconState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly data: StatementWithTransactions };

type CloseState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly readiness: CloseReadiness };

export function ReconciliationClosePanel() {
  const [statements, setStatements] = useState<readonly { id: string; date: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recon, setRecon] = useState<ReconState>({ kind: 'loading' });
  const [close, setClose] = useState<CloseState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { supabase } = await import('../../lib/supabase.ts');
      const { data, error } = await supabase
        .from('bank_statements')
        .select('id, statement_date')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error !== null) {
        setRecon({ kind: 'error', message: error.message });
        return;
      }
      const rows = (data ?? []) as unknown as { id: string; statement_date: string }[];
      setStatements(rows.map((r) => ({ id: r.id, date: r.statement_date })));
      if (rows.length > 0) setSelectedId(rows[0].id);
      else setRecon({ kind: 'ready', data: null as unknown as StatementWithTransactions });
    })();
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    setRecon({ kind: 'loading' });
    void getStatement(selectedId).then((r) => {
      if (!r.ok) setRecon({ kind: 'error', message: r.error.message });
      else setRecon({ kind: 'ready', data: r.value });
    });
  }, [selectedId]);

  useEffect(() => {
    setClose({ kind: 'loading' });
    void getCloseReadiness().then((r) => {
      if (!r.ok) setClose({ kind: 'error', message: r.error.message });
      else setClose({ kind: 'ready', readiness: r.value });
    });
  }, []);

  const doMatch = (): void => {
    if (selectedId === null) return;
    setBusy(true);
    setNotice(null);
    void runAutoReconcile(selectedId).then((r) => {
      setBusy(false);
      if (!r.ok) setNotice(`Matching failed: ${r.error.message}`);
      else {
        setNotice(`Matched ${r.value} transaction${r.value === 1 ? '' : 's'}.`);
        if (selectedId !== null) {
          void getStatement(selectedId).then((s) => {
            if (s.ok) setRecon({ kind: 'ready', data: s.value });
          });
        }
      }
    });
  };

  const doClose = (): void => {
    if (close.kind !== 'ready') return;
    setBusy(true);
    setNotice(null);
    void (async () => {
      const { supabase } = await import('../../lib/supabase.ts');
      const { data, error } = await supabase.rpc('close_fiscal_period', {
        p_period_id: close.readiness.periodId,
      });
      setBusy(false);
      if (error !== null) {
        setNotice(`Close refused: ${error.message}`);
        return;
      }
      const verdict = (data ?? {}) as { success?: boolean; message?: string };
      setNotice(verdict.success === true ? 'Period closed.' : `Close result: ${verdict.message ?? 'see gates'}`);
      void getCloseReadiness().then((r) => {
        if (r.ok) setClose({ kind: 'ready', readiness: r.value });
      });
    })();
  };

  return (
    <div className="finance-font h-full overflow-y-auto p-6 space-y-5">
      {/* ── Reconciliation ── */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white/90">Bank Reconciliation</h2>
          {statements.length > 0 ? (
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="glass-input rounded-lg bg-transparent px-3 py-1.5 text-sm text-white/85"
            >
              {statements.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900">{s.date}</option>
              ))}
            </select>
          ) : null}
        </div>

        {statements.length === 0 ? (
          <p className="mt-3 text-sm text-white/50">No bank statements imported yet.</p>
        ) : recon.kind === 'loading' ? (
          <p className="mt-3 text-sm text-white/50">Loading statement…</p>
        ) : recon.kind === 'error' ? (
          <p className="mt-3 text-sm text-red-300">Failed to load: {recon.message}</p>
        ) : (
          <>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Dir</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recon.data?.transactions.map((t) => (
                  <tr key={t.id} className="border-t border-white/10 text-white/85">
                    <td className="px-3 py-2 text-white/60">{t.transactionDate}</td>
                    <td className="px-3 py-2">{t.description || t.reference || '—'}</td>
                    <td className="px-3 py-2 text-white/55">{t.direction}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt.format(t.amount)}</td>
                    <td className={`px-3 py-2 ${t.status === 'MATCHED' ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {t.status}
                      {t.matchedJournalLineId !== null ? (
                        <span className="ml-1 font-mono text-xs text-white/40">
                          →{t.matchedJournalLineId.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {(recon.data?.transactions.length ?? 0) === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-sm text-white/45">No transactions on this statement.</td></tr>
                ) : null}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-3">
              <button
                disabled={busy || (recon.data?.unmatchedCount ?? 0) === 0}
                onClick={doMatch}
                className="glass-btn rounded-lg px-3 py-1.5 text-sm text-white/85 disabled:opacity-40"
              >
                Run auto-match{recon.data ? ` (${recon.data.unmatchedCount} unmatched)` : ''}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Close readiness ── */}
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Period Close</h2>
        {close.kind === 'loading' ? (
          <p className="mt-3 text-sm text-white/50">Evaluating close gates…</p>
        ) : close.kind === 'error' ? (
          <p className="mt-3 text-sm text-red-300">Failed to evaluate: {close.message}</p>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              {close.readiness.gates.map((g) => (
                <div key={g.id} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <div className="text-sm text-white/85">{g.label}</div>
                    <div className="text-xs text-white/50">{g.detail}</div>
                  </div>
                  <span className={`text-sm ${g.passed ? 'text-emerald-300' : 'text-red-300'}`}>
                    {g.passed ? 'PASS' : 'BLOCKED'}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                disabled={busy || !close.readiness.ready || close.readiness.status !== 'OPEN'}
                onClick={doClose}
                className="glass-btn rounded-lg px-3 py-1.5 text-sm text-white/85 disabled:opacity-40"
              >
                {close.readiness.status === 'OPEN' ? 'Close period' : `Period is ${close.readiness.status}`}
              </button>
              {!close.readiness.ready && close.readiness.status === 'OPEN' ? (
                <span className="text-xs text-amber-300/80">Blocking gates must pass before the period can lock.</span>
              ) : null}
            </div>
          </>
        )}

        {notice !== null ? (
          <p className="mt-3 text-sm text-sky-200">{notice}</p>
        ) : null}
      </div>
    </div>
  );
}
