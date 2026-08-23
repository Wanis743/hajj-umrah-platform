/**
 * Shared presentational parts for the accounting workspaces (slice 3).
 * Small, prop-driven, zero business logic.
 */

import React from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { KernelError } from '../kernel/types.ts';
import type { RecentJournalEntry } from './journalService';

export function Spinner({ label }: { readonly label: string }): React.JSX.Element {
  return (
    <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {label}
    </p>
  );
}

export function ErrorNote({ error }: { readonly error: KernelError }): React.JSX.Element {
  return <p className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-500">{error.message}</p>;
}

export function StatusChip({ status }: { readonly status: RecentJournalEntry['status'] }): React.JSX.Element {
  const cls =
    status === 'POSTED'
      ? 'bg-emerald-500/15 text-emerald-500'
      : status === 'VOID'
        ? 'bg-red-500/15 text-red-500'
        : 'bg-amber-500/15 text-amber-500';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{status}</span>;
}

export function Row({ k, v, mono }: { readonly k: string; readonly v: React.ReactNode; readonly mono?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-xs text-[var(--text-muted)]">{k}</span>
      <span className={`text-right text-sm ${mono === true ? 'font-mono' : ''}`}>{v}</span>
    </div>
  );
}

export function BalancedBadge({ balanced }: { readonly balanced: boolean }): React.JSX.Element {
  return balanced ? (
    <span className="inline-flex items-center gap-1 text-emerald-500">
      <CheckCircle2 className="h-4 w-4" /> balanced
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-amber-500">unbalanced / zero</span>
  );
}
