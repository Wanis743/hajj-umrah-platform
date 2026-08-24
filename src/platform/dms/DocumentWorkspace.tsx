/**
 * Document Operating Environment (V12 §17.8 — platform component; replaces
 * the dms/v10 trio: DocumentLibrary, ExtractionReview, EvidenceWorkspace).
 *
 * §7/§21: real storage-backed documents with checksums and expiry tracking,
 * provisional extraction results, evidence packages — truthful states only.
 */

import React, { useEffect, useState } from 'react';
import {
  getDocuments,
  getExtractionJobs,
  getEvidencePackages,
  type DocumentDTO,
  type EvidencePackageDTO,
  type ExtractionJobDTO,
} from './dmsService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly documents: readonly DocumentDTO[];
      readonly jobs: readonly ExtractionJobDTO[];
      readonly packages: readonly EvidencePackageDTO[];
    };

const fmtSize = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB`
      : `${bytes} B`;

export function DocumentLibrary() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const docs = await getDocuments();
      if (!docs.ok) { if (!cancelled) setState({ kind: 'error', message: docs.error.message }); return; }
      const jobs = await getExtractionJobs();
      if (!jobs.ok) { if (!cancelled) setState({ kind: 'error', message: jobs.error.message }); return; }
      const pkgs = await getEvidencePackages();
      if (!pkgs.ok) { if (!cancelled) setState({ kind: 'error', message: pkgs.error.message }); return; }
      if (!cancelled) setState({ kind: 'ready', documents: docs.value, jobs: jobs.value, packages: pkgs.value });
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Document Operating Environment</h2>
        {state.kind === 'ready' ? (
          <p className="mt-1 text-sm text-white/55">
            {state.documents.length} documents · {state.jobs.length} extraction jobs ·{' '}
            {state.packages.length} evidence packages
          </p>
        ) : null}
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading documents…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <h3 className="mt-5 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Documents</h3>
          {state.documents.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">
              No documents uploaded yet. Uploads go to the storage bucket with checksum + MIME validation.
            </div>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-white/45">
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Expires</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.documents.map((d) => (
                  <tr key={d.id} className="border-t border-white/10 text-white/85 hover:bg-white/[0.04]">
                    <td className="px-3 py-2">{d.type}</td>
                    <td className="px-3 py-2 font-mono">{d.number || '—'}</td>
                    <td className="px-3 py-2 max-w-[16rem] truncate" title={`${d.fileName} · ${d.mimeType}`}>{d.fileName}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtSize(d.sizeBytes)}</td>
                    <td className={`px-3 py-2 ${d.expiryDate !== null && d.expiryDate < new Date().toISOString().slice(0, 10) ? 'text-rose-300' : 'text-white/50'}`}>
                      {d.expiryDate ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-white/60">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Extraction jobs</h3>
          {state.jobs.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No extraction jobs yet.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {state.jobs.map((j) => (
                <div key={j.id} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <span className="font-mono text-xs text-white/70">doc:{j.documentId.slice(0, 8)}</span>
                    <span className={`ml-3 text-xs ${j.status === 'REVIEWED' || j.status === 'COMPLETED' ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {j.status}
                      {j.status !== 'REVIEWED' && j.status !== 'COMPLETED' ? ' · provisional until reviewed' : ''}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-white/40">{j.id.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          )}

          <h3 className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-white/45">Evidence packages</h3>
          {state.packages.length === 0 ? (
            <div className="mt-2 glass-card rounded-xl p-4 text-sm text-white/55">No evidence packages yet.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {state.packages.map((p) => (
                <div key={p.id} className="glass-card flex items-center justify-between rounded-xl px-4 py-3">
                  <span className="text-sm text-white/85">{p.name}</span>
                  <span className="text-xs text-white/60">{p.status}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
