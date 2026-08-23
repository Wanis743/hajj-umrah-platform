/**
 * Kernel tests — accounting slice (slice 3).
 *
 * Covers the pure contracts of journalService + command wiring:
 * balance invariant, per-line debit/credit XOR, RPC payload building with
 * exact decimal strings, both historical result-key variants, strict reader
 * parsing, error mapping, permission rules and confirmation flow.
 * Server behavior itself is exercised by supabase/tests and stays PENDING
 * until a database is bound.
 */

import {
  buildPostArgs,
  nextReference,
  parsePostResult,
  parseRecentEntries,
  rpcError,
  sumLines,
  validateDraft,
  type JournalDraft,
  type JournalLineInput,
} from '../src/platform/accounting/journalService.ts';
import { JOURNAL_COMMANDS, registerAccountingCommands } from '../src/platform/accounting/commands.ts';
import { PlatformKernel } from '../src/platform/kernel/index.ts';
import { minorUnits } from '../src/platform/kernel/types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    process.stderr.write(`FAIL: ${label}\n`);
  }
}

function line(accountId: string, debit: string, credit: string): JournalLineInput {
  return { accountId, debit, credit, currencyCode: 'DZD', memo: `m-${accountId}` };
}

const goodDraft = (): JournalDraft => ({
  reference: 'JE-2026-1',
  description: 'Test entry',
  entryDate: '2026-08-23',
  lines: [line('acc-a', '1500.00', ''), line('acc-b', '', '1500.00')],
});

// ── sumLines ────────────────────────────────────────────────────────────────

{
  const t = sumLines([line('a', '10.55', ''), line('b', '0.45', ''), line('c', '', '11.00')]);
  assert(t.debit === minorUnits(1100n), 'debit sum in minor units');
  assert(t.credit === minorUnits(1100n), 'credit sum in minor units');
}

// ── validateDraft ───────────────────────────────────────────────────────────

{
  assert(validateDraft(goodDraft()).ok, 'balanced draft validates');

  const unbalancedDraft: JournalDraft = {
    ...goodDraft(),
    lines: [line('a', '100.00', ''), line('b', '', '90.00')],
  };
  const r1 = validateDraft(unbalancedDraft);
  assert(!r1.ok && r1.error.message.includes('Unbalanced'), 'unbalanced rejected');

  const bothSides: JournalDraft = {
    ...goodDraft(),
    lines: [line('a', '5.00', '5.00'), line('b', '', '')],
  };
  const r2 = validateDraft(bothSides);
  assert(!r2.ok && r2.error.message.includes('either a debit or a credit'), 'debit+credit XOR enforced');

  const singleLine: JournalDraft = { ...goodDraft(), lines: [line('a', '5.00', '')] };
  const r3 = validateDraft(singleLine);
  assert(!r3.ok && r3.error.message.includes('two lines'), 'single-line rejected');

  const zero: JournalDraft = { ...goodDraft(), lines: [line('a', '0.00', ''), line('b', '', '0.00')] };
  const r4 = validateDraft(zero);
  assert(!r4.ok, 'all-zero entry rejected');

  const noRef: JournalDraft = { ...goodDraft(), reference: '  ' };
  const r5 = validateDraft(noRef);
  assert(!r5.ok && r5.error.message.includes('Reference'), 'blank reference rejected');

  const badDate: JournalDraft = { ...goodDraft(), entryDate: '23/08/2026' };
  const r6 = validateDraft(badDate);
  assert(!r6.ok && r6.error.message.includes('yyyy-mm-dd'), 'date format validated');

  const neg: JournalDraft = { ...goodDraft(), lines: [line('a', '-5.00', ''), line('b', '', '-5.00')] };
  const r7 = validateDraft(neg);
  assert(!r7.ok && r7.error.message.includes('negative'), 'negative amounts rejected');
}

// ── reference generator ─────────────────────────────────────────────────────

{
  const ref = nextReference(new Date('2026-08-23T14:05:09'));
  assert(ref.startsWith('JE-20260823-140509'), `reference format (${ref})`);
}

// ── RPC payload ─────────────────────────────────────────────────────────────

{
  const args = buildPostArgs(goodDraft());
  assert(args.p_reference === 'JE-2026-1', 'payload reference');
  assert(args.p_entry_date === '2026-08-23', 'payload date');
  assert(args.p_lines.length === 2, 'payload line count');
  const first = args.p_lines[0];
  assert(
    first !== undefined &&
      first.account_id === 'acc-a' &&
      first.debit === '1500.00' &&
      first.credit === '0.00' &&
      first.currency_code === 'DZD',
    'exact decimal strings cross the boundary',
  );
}

// ── post result parsing (both key variants) ─────────────────────────────────

{
  const a = parsePostResult({ success: true, journal_entry_id: 'je-1' });
  assert(a.ok && a.value === 'je-1', 'fix_rpcs key parsed');
  const b = parsePostResult({ success: true, journal_id: 'je-2' });
  assert(b.ok && b.value === 'je-2', 'original key parsed');
  const c = parsePostResult({ success: true });
  assert(!c.ok, 'missing id rejected');
  const d = parsePostResult(null);
  assert(!d.ok, 'null result rejected');
}

// ── recent entries parsing ──────────────────────────────────────────────────

{
  const payload = [
    {
      id: 'je-1',
      created_at: '2026-08-23T10:00:00Z',
      reference: 'JE-1',
      entry_date: '2026-08-23',
      description: 'x',
      status: 'POSTED',
      total_debit: 1500,
      total_credit: 1500,
      lines: [{ account_code: '4010', account_name: 'Cash', debit: 1500, credit: 0, memo: null }],
    },
  ];
  const okParsed = parseRecentEntries(payload);
  assert(okParsed.ok, 'recent entries parse');
  if (okParsed.ok) {
    const firstEntry = okParsed.value[0];
    assert(firstEntry !== undefined && firstEntry.status === 'POSTED', 'status parsed');
    assert(
      firstEntry !== undefined && firstEntry.totalDebitMinor === minorUnits(150000n),
      'numeric totals converted to minor units',
    );
    const firstLine = firstEntry?.lines[0];
    assert(firstLine !== undefined && firstLine.accountCode === '4010', 'line fields mapped');
  }

  const badLines = parseRecentEntries([{ id: 'je-9', lines: 'nope' }]);
  assert(!badLines.ok, 'non-array lines rejected');

  const badLineShape = parseRecentEntries([{ id: 'je-9', lines: ['nope'] }]);
  assert(!badLineShape.ok, 'malformed line record rejected');

  const badEntry = parseRecentEntries([{ nope: true }]);
  assert(!badEntry.ok, 'entry without id rejected');

  const notArray = parseRecentEntries({});
  assert(!notArray.ok, 'non-array rejected');
}

// ── rpcError mapping ────────────────────────────────────────────────────────

{
  const denied = rpcError({ code: '42501', message: 'Unauthorized' });
  assert(denied.code === 'PERMISSION_DENIED', '42501 maps to PERMISSION_DENIED');
  const generic = rpcError(new Error('Debit and Credit must be equal'));
  assert(generic.code === 'VALIDATION_FAILED' && generic.message.includes('equal'), 'generic error wrapped');
}

// ── kernel wiring + confirmation flow ───────────────────────────────────────

{
  const kernel = new PlatformKernel();
  const rpcCalls: string[] = [];
  const fakeRpc = {
    postJournalEntry: async () => {
      rpcCalls.push('post');
      return { success: true, journal_entry_id: 'je-new' };
    },
    approveJournalEntry: async () => {
      rpcCalls.push('approve');
      return { success: true, journal_entry_id: 'je-1', status: 'POSTED' };
    },
  };
  registerAccountingCommands(kernel, fakeRpc);

  const draftDef = kernel.commands.get(JOURNAL_COMMANDS.CreateDraft);
  const approveDef = kernel.commands.get(JOURNAL_COMMANDS.ApproveEntry);
  assert(draftDef.ok && approveDef.ok, 'both commands registered');

  const rule = kernel.permissions.getCommandRule(JOURNAL_COMMANDS.ApproveEntry);
  assert(rule.ok, 'approve rule registered');

  // Viewer role denied outright.
  const viewer = {
    userId: 'u-viewer',
    roles: ['VIEWER'],
    scope: { agencyId: 'a', branchId: null, enterpriseWide: false },
    financialAuthorityLimit: null,
  };
  const deniedViewer = kernel.permissions.authorizeCommand(JOURNAL_COMMANDS.ApproveEntry, viewer);
  assert(!deniedViewer.ok && deniedViewer.error.code === 'PERMISSION_DENIED', 'viewer cannot approve');

  // Controller within limit → material impact demands a confirmation pass.
  const approver = {
    userId: 'u-controller',
    roles: ['CONTROLLER'],
    scope: { agencyId: 'a', branchId: null, enterpriseWide: false },
    financialAuthorityLimit: minorUnits(1_000_00n),
  };
  const overLimit = kernel.permissions.authorizeCommand(
    JOURNAL_COMMANDS.ApproveEntry,
    approver,
    minorUnits(5_000_00n),
  );
  assert(!overLimit.ok, 'amount above authority blocked pre-RPC');

  void (async () => {
    const firstPass = await kernel.executeCommand({
      commandId: JOURNAL_COMMANDS.ApproveEntry,
      principal: approver,
      target: { objectTypeId: 'journal', id: 'je-1' },
      amount: minorUnits(500_00n),
    });
    assert(firstPass.ok && firstPass.value.status === 'needs_confirmation', 'approval asks for confirmation first');

    const secondPass = await kernel.executeCommand({
      commandId: JOURNAL_COMMANDS.ApproveEntry,
      principal: approver,
      target: { objectTypeId: 'journal', id: 'je-1' },
      amount: minorUnits(500_00n),
      payload: { confirmed: true, reason: 'Verified against source documents' },
    });
    assert(secondPass.ok && secondPass.value.status === 'executed', 'approval executes after confirmation');
    assert(rpcCalls.includes('approve'), 'approve RPC invoked exactly through the seam');

    // Viewer execution attempt → denial audited.
    const deniedOutcome = await kernel.executeCommand({
      commandId: JOURNAL_COMMANDS.ApproveEntry,
      principal: viewer,
      target: { objectTypeId: 'journal', id: 'je-x' },
    });
    assert(!deniedOutcome.ok, 'executeCommand denies viewer');
    const trail = kernel.auditTrail();
    const denials = trail.filter((e) => e.eventType.endsWith(':DENIED'));
    assert(denials.length >= 1 && denials[denials.length - 1]?.objectId === 'je-x', 'denial audited');

    process.stdout.write(`\naccounting slice tests: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
  })();
}
