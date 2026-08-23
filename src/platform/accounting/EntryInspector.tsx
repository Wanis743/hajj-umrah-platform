/**
 * Entry inspector panel (slice 3) — right side of the Journal Workbench.
 * Shows a selected entry's facts and the approval action (kernel-gated).
 */

import React, { useState } from 'react';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import type { RecentJournalEntry } from './journalService';
import { Row, StatusChip } from './workbenchParts';
import { fmt } from './format';

export interface EntryInspectorProps {
  readonly entry: RecentJournalEntry | null;
  readonly busy: boolean;
  readonly canApprove: boolean;
  readonly onApprove: (entryId: string, reason: string) => void;
}

export function EntryInspector(props: EntryInspectorProps): React.JSX.Element {
  const { entry, busy, canApprove, onApprove } = props;
  const [reason, setReason] = useState('');

  if (entry === null) {
    return (
      <aside className="col-span-4 min-h-0 overflow-auto rounded-xl border border-[var(--border)] p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Inspector</h3>
        <p className="text-xs text-[var(--text-muted)]">Select an entry in the library to inspect it.</p>
      </aside>
    );
  }

  return (
    <aside className="col-span-4 min-h-0 overflow-auto rounded-xl border border-[var(--border)] p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Inspector</h3>
      <div className="space-y-2 text-sm">
        <Row k="Reference" v={entry.reference} mono />
        <Row k="Date" v={entry.entryDate} />
        <Row k="Status" v={<StatusChip status={entry.status} />} />
        <Row k="Description" v={entry.description} />
        <Row k="Total" v={fmt(entry.totalDebitMinor)} mono />
        <div className="pt-1">
          <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">Lines</p>
          <ul className="space-y-1 font-mono text-xs">
            {entry.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">
                  {l.accountCode}
                  {l.accountName !== null && <span className="text-[var(--text-muted)]"> · {l.accountName}</span>}
                </span>
                <span>{Number(l.debitMinor) > 0 ? `D ${fmt(l.debitMinor)}` : `C ${fmt(l.creditMinor)}`}</span>
              </li>
            ))}
          </ul>
        </div>

        {entry.status === 'DRAFT' && (
          <div className="mt-2 space-y-2 rounded-lg border border-[var(--border)] p-2">
            {!canApprove && (
              <p className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <Lock className="h-3 w-3" /> Requires ADMIN or CONTROLLER role
              </p>
            )}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Approval reason (audited)"
              className="w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={!canApprove || busy}
              onClick={() => onApprove(entry.id, reason.trim() !== '' ? reason.trim() : 'Approved from Journal Workbench')}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve &amp; post to ledger
            </button>
            <p className="text-[11px] text-[var(--text-muted)]">
              Posting is enforced again server-side (role + MFA + open period + balance triggers).
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
