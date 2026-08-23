/**
 * Journal Workbench (slice 3) — the first true platform workspace.
 *
 * Layout follows spec §10: library (accounts + recent entries) | work area
 * (draft editor) | inspector (entry detail + approval). Orchestration only:
 * data fetching, kernel command execution, and composition of the focused
 * panels in this directory. All business rules live in journalService and,
 * authoritatively, on the server.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { PlatformKernel, usePlatformKernel } from '../kernelBridge';
import { registerAccountingCommands, supabaseAccountingRpc } from './commands';
import { parseOrZero } from './format';
import { useJournalCommands } from './useJournalCommands';
import {
  parseRecentEntries,
  rpcError,
  toDraftLines,
  validateDraftLines,
  type RecentJournalEntry,
} from './journalService';
import { minorUnits, roleId, type Principal } from '../kernel/types.ts';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import toast from 'react-hot-toast';
import { DraftEditor } from './DraftEditor';
import { LibraryPanel } from './LibraryPanel';
import { EntryInspector } from './EntryInspector';
import type { AccountOption, DraftLine, Loadable } from './workbenchTypes';

function emptyLine(): DraftLine {
  return {
    accountId: '',
    debitRaw: '',
    creditRaw: '',
    currencyCode: 'DZD',
    memo: '',
    debitMinor: minorUnits(0n),
    creditMinor: minorUnits(0n),
  };
}

const APPROVER_ROLE_NAMES = ['ADMIN', 'CONTROLLER'] as const;

export function JournalWorkbench(): React.JSX.Element {
  const kernel: PlatformKernel = usePlatformKernel();
  const { session, staffProfile } = useAuth();

  const principal: Principal | null = useMemo(() => {
    if (!session?.user?.id || !staffProfile?.is_active) return null;
    const role = staffProfile.role.toUpperCase();
    return {
      userId: session.user.id,
      roles: [roleId(role)],
      scope: {
        agencyId: '*', // server derives agency from JWT; UI scope is display-only
        branchId: staffProfile.branch_id ?? null,
        enterpriseWide: false,
      },
      financialAuthorityLimit:
        role === 'ADMIN' || role === 'CONTROLLER'
          ? minorUnits(10_000_000_000_00n)
          : null,
    };
  }, [session?.user?.id, staffProfile?.role, staffProfile?.branch_id, staffProfile?.is_active]);

  const canDraft =
    principal !== null && principal.roles.some((r) => ['ADMIN', 'CONTROLLER', 'ACCOUNTANT'].includes(r));
  const canApprove =
    principal !== null && principal.roles.some((r) => (APPROVER_ROLE_NAMES as readonly string[]).includes(r));

  // ── Kernel wiring (injected RPC caller) ─────────────────────────────
  const [wired, setWired] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabaseAccountingRpc().then((rpc) => {
      if (!alive) return;
      registerAccountingCommands(kernel, rpc);
      setWired(true);
    });
    return () => {
      alive = false;
    };
  }, [kernel]);

  // ── Accounts library ────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<Loadable<readonly AccountOption[]>>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.from('chart_of_accounts').select('id, code, name').order('code');
      if (!alive) return;
      if (error !== null) {
        setAccounts({ state: 'failed', error: rpcError(error) });
        return;
      }
      const rows: AccountOption[] = [];
      for (const raw of data ?? []) {
        const rec = raw as Record<string, unknown>;
        if (typeof rec['id'] === 'string') {
          rows.push({
            id: rec['id'],
            code: typeof rec['code'] === 'string' ? rec['code'] : '',
            name: typeof rec['name'] === 'string' ? rec['name'] : '',
          });
        }
      }
      setAccounts({ state: 'ready', value: rows });
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ── Recent entries ──────────────────────────────────────────────────
  const [recent, setRecent] = useState<Loadable<readonly RecentJournalEntry[]>>({ state: 'loading' });
  const refreshRecent = useCallback(async () => {
    setRecent({ state: 'loading' });
    const { data, error } = await supabase.rpc('get_recent_journal_entries', { limit_rows: 50 });
    if (error !== null) {
      setRecent({ state: 'failed', error: rpcError(error) });
      return;
    }
    const parsed = parseRecentEntries(data);
    if (parsed.ok) setRecent({ state: 'ready', value: parsed.value });
    else setRecent({ state: 'failed', error: parsed.error });
  }, []);
  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  // ── Draft editor state ──────────────────────────────────────────────
  const [lines, setLines] = useState<readonly DraftLine[]>([emptyLine(), emptyLine()]);
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const setLine = (index: number, patch: Partial<DraftLine>): void => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const merged = { ...l, ...patch };
        // Keep parsed minor units in sync; '' → zero.
        merged.debitMinor =
          merged.debitRaw === '' ? minorUnits(0n) : minorUnits(parseOrZero(merged.debitRaw));
        merged.creditMinor =
          merged.creditRaw === '' ? minorUnits(0n) : minorUnits(parseOrZero(merged.creditRaw));
        return merged;
      }),
    );
  };

  const validation = useMemo(() => validateDraftLines(lines, description, entryDate), [lines, description, entryDate]);

  const selectedEntry =
    recent.state === 'ready' ? (recent.value.find((e) => e.id === selectedEntryId) ?? null) : null;

  function resetDraft(): void {
    setLines([emptyLine(), emptyLine()]);
    setDescription('');
  }

  const commands = useJournalCommands({
    kernel,
    wired,
    principal,
    toast: (msg, opts) => toast(msg, opts),
    toastSuccess: (msg) => toast.success(msg),
    toastError: (msg) => toast.error(msg),
    onDraftSaved: resetDraft,
    onLedgerChanged: () => refreshRecent(),
  });
  const busy = commands.busy;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="journal-workbench">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Journal Workbench</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Server-authoritative · drafts via post_journal_entry · posting via approve_journal_entry
          </p>
        </div>
        {!canApprove && (
          <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]" title="Your role cannot post entries">
            <Lock className="h-3.5 w-3.5" /> approval locked for your role
          </span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        <LibraryPanel
          accounts={accounts}
          recent={recent}
          selectedEntryId={selectedEntryId}
          onSelectAccount={(accountId) => {
            const idx = lines.findIndex((l) => l.accountId === '');
            if (idx >= 0) setLine(idx, { accountId });
          }}
          onSelectEntry={setSelectedEntryId}
        />

        {/* Work area */}
        <DraftEditor
          accounts={accounts.state === 'ready' ? accounts.value : []}
          lines={lines}
          entryDate={entryDate}
          description={description}
          busy={busy === 'draft'}
          canDraft={canDraft}
          validation={validation}
          onEntryDateChange={setEntryDate}
          onDescriptionChange={setDescription}
          onLineChange={setLine}
          onAddLine={() => setLines((prev) => [...prev, emptyLine()])}
          onRemoveLine={(i) => setLines((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))}
          onSaveDraft={() => void commands.runDraft({ description, entryDate, lines: toDraftLines(lines) })}
        />

        {/* Inspector */}
        <EntryInspector
          entry={selectedEntry}
          busy={busy === 'approve'}
          canApprove={canApprove}
          onApprove={(id, reason) => void commands.runApprove(id, reason)}
        />
      </div>
    </div>
  );
}
