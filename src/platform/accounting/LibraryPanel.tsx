/**
 * Library panel (slice 3) — left column of the Journal Workbench:
 * chart-of-accounts quick-pick and recent entries list.
 */

import React from 'react';
import type { RecentJournalEntry } from './journalService';
import { ErrorNote, Spinner, StatusChip } from './workbenchParts';
import type { AccountOption, Loadable } from './workbenchTypes';

export interface LibraryPanelProps {
  readonly accounts: Loadable<readonly AccountOption[]>;
  readonly recent: Loadable<readonly RecentJournalEntry[]>;
  readonly selectedEntryId: string | null;
  readonly onSelectAccount: (accountId: string) => void;
  readonly onSelectEntry: (entryId: string) => void;
}

export function LibraryPanel(props: LibraryPanelProps): React.JSX.Element {
  const { accounts, recent, selectedEntryId, onSelectAccount, onSelectEntry } = props;

  return (
    <aside className="col-span-3 min-h-0 overflow-auto rounded-xl border border-[var(--border)] p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Chart of accounts</h3>
      {accounts.state === 'loading' && <Spinner label="Loading accounts…" />}
      {accounts.state === 'failed' && <ErrorNote error={accounts.error} />}
      {accounts.state === 'ready' && (
        <ul className="space-y-1 text-sm">
          {accounts.value.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="w-full truncate rounded px-2 py-1 text-left hover:bg-[var(--bg-secondary)]"
                title={`${a.code} ${a.name}`}
                onClick={() => onSelectAccount(a.id)}
              >
                <span className="font-mono text-xs text-[var(--text-muted)]">{a.code}</span> {a.name}
              </button>
            </li>
          ))}
          {accounts.value.length === 0 && (
            <li className="px-2 py-1 text-xs text-[var(--text-muted)]">No accounts yet</li>
          )}
        </ul>
      )}

      <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent entries</h3>
      {recent.state === 'loading' && <Spinner label="Loading entries…" />}
      {recent.state === 'failed' && <ErrorNote error={recent.error} />}
      {recent.state === 'ready' && (
        <ul className="space-y-1 text-sm">
          {recent.value.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelectEntry(e.id)}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-[var(--bg-secondary)] ${selectedEntryId === e.id ? 'bg-[var(--bg-secondary)]' : ''}`}
              >
                <span className="truncate font-mono text-xs">{e.reference}</span>
                <StatusChip status={e.status} />
              </button>
            </li>
          ))}
          {recent.value.length === 0 && (
            <li className="px-2 py-1 text-xs text-[var(--text-muted)]">No journal entries yet</li>
          )}
        </ul>
      )}
    </aside>
  );
}
