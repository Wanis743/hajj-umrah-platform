/**
 * Report Builder (V12 §22 Phase B — platform component).
 *
 * §8: reports are saved layouts of data-bound visualizations. Create a
 * report, then persist the current visualization ordering as its layout.
 * Layouts are saved through RLS-scoped updates; scope is stamped
 * server-side. Truthful empty states throughout.
 */

import React, { useEffect, useState } from 'react';
import {
  createReport,
  getReports,
  getVisualizations,
  saveReportLayout,
  type BiReportDTO,
} from './semanticService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly reports: readonly BiReportDTO[] };

export function ReportBuilder() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = (): void => {
    setState({ kind: 'loading' });
    void getReports().then((r) => {
      if (!r.ok) setState({ kind: 'error', message: r.error.message });
      else setState({ kind: 'ready', reports: r.value });
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doCreate = (): void => {
    if (newTitle.trim() === '') return;
    setBusy(true);
    setNotice(null);
    void (async () => {
      const visuals = await getVisualizations();
      const layout = visuals.ok
        ? visuals.value.map((v, i) => ({ visualizationId: v.id, position: i }))
        : [];
      const r = await createReport(newTitle.trim(), '', layout);
      setBusy(false);
      if (!r.ok) {
        setNotice(`Create failed: ${r.error.message}`);
        return;
      }
      setNewTitle('');
      setNotice(`Report created with ${layout.length} bound visual(s).`);
      reload();
    })();
  };

  const doSaveLayout = (reportId: string): void => {
    setBusy(true);
    setNotice(null);
    void (async () => {
      const visuals = await getVisualizations();
      const layout = visuals.ok
        ? visuals.value.map((v, i) => ({ visualizationId: v.id, position: i }))
        : [];
      const r = await saveReportLayout(reportId, layout);
      setBusy(false);
      setNotice(r.ok ? `Layout saved (${layout.length} visual(s)).` : `Save failed: ${r.error.message}`);
    })();
  };

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Report Builder</h2>
        <p className="mt-1 text-sm text-white/55">Saved layouts of data-bound visualizations</p>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading reports…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <div className="glass-card mt-4 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="New report title…"
                className="glass-input flex-1 rounded-lg bg-transparent px-3 py-2 text-sm text-white/85 outline-none placeholder-white/35"
              />
              <button
                disabled={busy || newTitle.trim() === ''}
                onClick={doCreate}
                className="glass-btn rounded-lg px-3 py-2 text-sm text-white/85 disabled:opacity-40"
              >
                Create report
              </button>
            </div>
            {notice !== null ? <p className="mt-2 text-xs text-sky-200">{notice}</p> : null}
          </div>

          {state.reports.length === 0 ? (
            <div className="glass-card mt-6 rounded-xl p-5 text-sm text-white/55">
              No reports yet. A report is a saved layout of data-bound visualizations —
              create one above after defining visualizations in the Studio.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {state.reports.map((r) => (
                <div key={r.id} className="glass-card rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-white/85">{r.title}</div>
                    <button
                      disabled={busy}
                      onClick={() => doSaveLayout(r.id)}
                      className="glass-btn rounded-lg px-2 py-1 text-xs text-white/75 disabled:opacity-40"
                    >
                      Save layout
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-white/50">{r.description || 'No description'}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
