/**
 * Data broker — the only route between an application and business data.
 *
 * Applications never import Supabase. They ask the kernel for a *dataset*, which
 * the broker resolves against a fixed projection table: a named source, an
 * explicit column list, a bounded row count and a required capability. Arbitrary
 * SQL is not expressible across the ABI, so an app cannot widen its own reach.
 *
 * Mutation is equally narrow. Every write is a named command bound to a
 * server-side RPC that enforces its own authorization; the broker adds the
 * capability check, the elevation check, idempotency, cache invalidation and the
 * audit record. There is deliberately no generic "update this table" path.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  COMMAND_CAPABILITY,
  DATASETS,
  fail,
  succeed,
  type AbiResult,
  type Capability,
  type CommandInvocation,
  type CommandOutcome,
  type DatasetFilterValue,
  type DatasetName,
  type DatasetPage,
  type DatasetQuery,
  type DatasetRow,
  type LedgerCommandName,
  type Pid,
} from '../abi';
import type { IsoTimestamp } from '../types';
import type {
  BusSubsystem,
  DataBrokerSubsystem,
  KernelClock,
  KernelLogger,
  ProcessSubsystem,
  SecuritySubsystem,
} from '../contracts';
import { IPC_CHANNELS } from './bus';
import { EVENT_IDS } from './eventlog';
import { createSignal } from './store';

/** Cache lifetime when a query does not state its own tolerance. */
const DEFAULT_MAX_AGE_MS = 15_000;
/** Hard ceiling on rows the broker will hand to an application in one page. */
const MAX_ROWS = 500;
/** Rows the broker itself may pull when computing a derived dataset. */
const DERIVE_ROWS = 4000;
/** Cache entries retained before the oldest are evicted. */
const CACHE_LIMIT = 120;

/* ------------------------------------------------------------------ *
 * Dataset projections
 * ------------------------------------------------------------------ */

interface TableSource {
  readonly kind: 'table';
  readonly table: string;
  readonly select: string;
  readonly order: { readonly column: string; readonly ascending: boolean };
  readonly capability: Capability;
}

interface DerivedSource {
  readonly kind: 'derived';
  readonly capability: Capability;
  readonly dependsOn: readonly DatasetName[];
  readonly compute: (load: DeriveLoader) => Promise<AbiResult<readonly DatasetRow[]>>;
}

type DatasetSource = TableSource | DerivedSource;

/** Pulls a dependency for a derived dataset through the same cache path. */
type DeriveLoader = (dataset: DatasetName, query?: Omit<DatasetQuery, 'dataset'>) => Promise<AbiResult<DatasetPage>>;

const SOURCES: { readonly [K in DatasetName]: DatasetSource } = {
  accounts: {
    kind: 'table',
    table: 'chart_of_accounts',
    select: 'id,code,name,account_type,currency_code,parent_id,is_active,created_at',
    order: { column: 'code', ascending: true },
    capability: 'ledger.read',
  },
  journalEntries: {
    kind: 'table',
    table: 'journal_entries',
    select:
      'id,reference,entry_date,description,status,source_type,source_id,fiscal_period_id,branch_id,package_id,total_debit,total_credit,posted_at,created_at,created_by',
    order: { column: 'entry_date', ascending: false },
    capability: 'ledger.read',
  },
  journalLines: {
    kind: 'table',
    table: 'journal_lines',
    select:
      'id,journal_entry_id,account_id,debit,credit,currency_code,memo,branch_id,package_id,is_reconciled,created_at',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },
  bankAccounts: {
    kind: 'table',
    table: 'bank_accounts',
    select:
      'id,name,institution,account_reference,currency_code,opening_balance,current_balance,ledger_account_id,is_active,branch_id,created_at',
    order: { column: 'name', ascending: true },
    capability: 'ledger.read',
  },
  bankTransactions: {
    kind: 'table',
    table: 'bank_transactions',
    select:
      'id,statement_id,transaction_date,type,amount,description,reference,status,matched_ledger_line_id,matched_journal_line_id,matched_at,matched_by,created_at',
    order: { column: 'transaction_date', ascending: false },
    capability: 'ledger.read',
  },
  /**
   * The statement header.
   *
   * `bank_transactions` carries no account of its own — a line belongs to a
   * statement, and the statement belongs to the account. Reconciliation cannot
   * scope one bank's lines without this row, and `unmatch_bank_transaction`
   * refuses on a `LOCKED` statement, so the status has to be readable too.
   */
  bankStatements: {
    kind: 'table',
    table: 'bank_statements',
    select: 'id,bank_account_id,statement_date,start_balance,end_balance,status,created_at,created_by',
    order: { column: 'statement_date', ascending: false },
    capability: 'ledger.read',
  },
  fiscalPeriods: {
    kind: 'table',
    table: 'fiscal_periods',
    select: 'id,label,start_date,end_date,status,closed_at,closed_by,created_at',
    order: { column: 'start_date', ascending: false },
    capability: 'ledger.read',
  },
  budgets: {
    kind: 'table',
    table: 'fiscal_budgets',
    select: 'id,period_id,name,status,locked_at,created_at,updated_at',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },
  budgetLines: {
    kind: 'table',
    table: 'budget_lines',
    select: 'id,budget_id,account_id,amount_dzd,amount_sar,created_at',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },
  supplierBills: {
    kind: 'table',
    table: 'supplier_bills',
    select: '*',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },
  invoices: {
    kind: 'table',
    table: 'invoices',
    select: 'id,booking_id,invoice_number,total_dzd,total_sar,status,issued_at,due_date,currency,exchange_rate,created_at',
    order: { column: 'issued_at', ascending: false },
    capability: 'ledger.read',
  },
  payments: {
    kind: 'table',
    table: 'payments',
    select:
      'id,booking_id,pilgrim_id,amount_dzd,amount_sar,method,status,reference,receipt_number,received_at,currency,exchange_rate,created_at',
    order: { column: 'received_at', ascending: false },
    capability: 'ledger.read',
  },
  groups: {
    kind: 'table',
    table: 'groups',
    select: '*',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },
  exchangeRates: {
    kind: 'table',
    table: 'exchange_rates',
    select: 'id,base_currency,quote_currency,rate,rate_date,source,created_at',
    order: { column: 'rate_date', ascending: false },
    capability: 'ledger.read',
  },
  closeTasks: {
    kind: 'table',
    table: 'close_tasks',
    select: 'id,task_name,dependencies,certification_status,owner_id,created_at,updated_at',
    order: { column: 'created_at', ascending: true },
    capability: 'ledger.read',
  },
  auditTrail: {
    kind: 'table',
    table: 'audit_logs',
    select: 'id,action,resource,resource_id,user_email,details,timestamp,created_at,request_id',
    order: { column: 'created_at', ascending: false },
    capability: 'eventlog.read',
  },

  /**
   * Trial balance. There is no server-side view, so the broker aggregates the
   * posted journal lines against the chart of accounts. Every input comes through
   * the cache, so opening a second report on the same book costs no round trip.
   *
   * Posted only, and that is the whole difficulty: `journal_lines` are written when
   * an entry is *created*, and carry no status of their own — status lives on the
   * entry. Summing the lines table as it stands would put unapproved drafts and
   * voided reversals into the balance sheet. So the entries are loaded too, and a
   * line counts only when its entry is POSTED.
   *
   * All three inputs are pulled at `DERIVE_ROWS`, an order of magnitude above the
   * page an application may ask for, because an aggregate that silently saw a
   * fraction of the book is worse than no aggregate at all. A book past that
   * ceiling needs a server-side view, not a bigger constant here.
   */
  trialBalance: {
    kind: 'derived',
    capability: 'ledger.read',
    dependsOn: ['accounts', 'journalLines', 'journalEntries'],
    compute: async (load) => {
      const accounts = await load('accounts', { limit: DERIVE_ROWS });
      if (!accounts.ok) return accounts;
      const entries = await load('journalEntries', { limit: DERIVE_ROWS });
      if (!entries.ok) return entries;
      const lines = await load('journalLines', { limit: DERIVE_ROWS });
      if (!lines.ok) return lines;

      const posted = new Set<string>();
      for (const entry of entries.value.rows) {
        const id = asString(entry.id);
        if (id !== null && (asString(entry.status) ?? '').toUpperCase() === 'POSTED') posted.add(id);
      }

      const totals = new Map<string, { debit: number; credit: number; lines: number }>();
      for (const line of lines.value.rows) {
        const accountId = asString(line.account_id);
        if (accountId === null) continue;
        const entryId = asString(line.journal_entry_id);
        if (entryId === null || !posted.has(entryId)) continue;
        const bucket = totals.get(accountId) ?? { debit: 0, credit: 0, lines: 0 };
        bucket.debit += asNumber(line.debit) ?? 0;
        bucket.credit += asNumber(line.credit) ?? 0;
        bucket.lines += 1;
        totals.set(accountId, bucket);
      }

      const rows: DatasetRow[] = accounts.value.rows.map((account) => {
        const accountId = asString(account.id) ?? '';
        const bucket = totals.get(accountId) ?? { debit: 0, credit: 0, lines: 0 };
        const type = (asString(account.account_type) ?? '').toUpperCase();
        // Debit-natured accounts carry a positive balance when debits exceed
        // credits; credit-natured accounts are the mirror image.
        const debitNatured = type === 'ASSET' || type === 'EXPENSE';
        const balance = debitNatured ? bucket.debit - bucket.credit : bucket.credit - bucket.debit;
        return {
          account_id: accountId,
          code: account.code,
          name: account.name,
          account_type: account.account_type,
          currency_code: account.currency_code,
          // Projected so the filter below means something, and so a report can
          // mark a retired account that still carries a balance.
          is_active: asBoolean(account.is_active) ?? true,
          debit: round2(bucket.debit),
          credit: round2(bucket.credit),
          balance: round2(balance),
          line_count: bucket.lines,
        };
      });
      // A retired account with no posted activity is noise; one with activity has
      // to stay, or the columns stop adding up.
      return succeed(rows.filter((row) => (asNumber(row.line_count) ?? 0) > 0 || asBoolean(row.is_active) !== false));
    },
  },

  /**
   * Cost centres. The schema models these as groups (a departure is the unit of
   * profitability), so the broker projects groups into the dimension shape the
   * profitability and budgeting apps expect.
   */
  costCenters: {
    kind: 'derived',
    capability: 'ledger.read',
    dependsOn: ['groups'],
    compute: async (load) => {
      const groups = await load('groups', { limit: MAX_ROWS });
      if (!groups.ok) return groups;
      const rows: DatasetRow[] = groups.value.rows.map((group) => ({
        id: group.id,
        code: asString(group.reference) ?? asString(group.code) ?? shortCode(asString(group.id)),
        name: asString(group.name) ?? asString(group.label) ?? 'Group',
        kind: 'group',
        status: group.status ?? null,
        departure_date: group.departure_date ?? group.start_date ?? null,
        capacity: group.capacity ?? null,
      }));
      return succeed([
        { id: null, code: 'GENERAL', name: 'General / unallocated', kind: 'general', status: null, departure_date: null, capacity: null },
        ...rows,
      ]);
    },
  },
};

/* ------------------------------------------------------------------ *
 * Command bindings
 * ------------------------------------------------------------------ */

interface CommandBinding {
  /** Server-side function. Authorization lives there; this is not a shortcut. */
  readonly rpc: string;
  /** Translates the app's payload into RPC arguments, rejecting bad input. */
  readonly args: (payload: Readonly<Record<string, unknown>>) => AbiResult<Record<string, unknown>>;
  /** Datasets whose cached pages are no longer trustworthy after this command. */
  readonly invalidates: readonly DatasetName[];
}

const BINDINGS: { readonly [K in LedgerCommandName]: CommandBinding } = {
  'journal.create': {
    rpc: 'post_journal_entry',
    args: (payload) => {
      const lines = payload.lines;
      if (!Array.isArray(lines) || lines.length < 2) {
        return fail('INVALID_ARGUMENT', 'A journal entry needs at least two lines');
      }
      const reference = requireString(payload.reference, 'reference');
      if (!reference.ok) return reference;
      const entryDate = requireString(payload.entryDate, 'entryDate');
      if (!entryDate.ok) return entryDate;
      return succeed({
        p_reference: reference.value,
        p_description: asString(payload.description) ?? '',
        p_entry_date: entryDate.value,
        p_lines: lines,
      });
    },
    invalidates: ['journalEntries', 'journalLines', 'trialBalance', 'auditTrail'],
  },
  'journal.post': {
    rpc: 'approve_journal_entry',
    args: (payload) => {
      const id = requireString(payload.journalId, 'journalId');
      if (!id.ok) return id;
      const args: Record<string, unknown> = { p_journal_id: id.value };
      const reason = asString(payload.reason);
      if (reason !== null) args.p_reason = reason;
      return succeed(args);
    },
    invalidates: ['journalEntries', 'journalLines', 'trialBalance', 'auditTrail'],
  },
  'journal.void': {
    rpc: 'void_journal_entry',
    args: (payload) => {
      const id = requireString(payload.journalId, 'journalId');
      if (!id.ok) return id;
      const reason = requireString(payload.reason, 'reason');
      if (!reason.ok) return reason;
      return succeed({ p_journal_id: id.value, p_reason: reason.value });
    },
    invalidates: ['journalEntries', 'journalLines', 'trialBalance', 'auditTrail'],
  },
  'account.create': {
    rpc: 'upsert_chart_account',
    args: (payload) => {
      const code = requireString(payload.code, 'code');
      if (!code.ok) return code;
      const name = requireString(payload.name, 'name');
      if (!name.ok) return name;
      const type = requireString(payload.accountType, 'accountType');
      if (!type.ok) return type;
      return succeed({
        p_id: null,
        p_code: code.value,
        p_name: name.value,
        p_account_type: type.value.toUpperCase(),
        p_currency_code: asString(payload.currencyCode) ?? 'DZD',
        p_parent_id: asString(payload.parentId),
        p_is_active: asBoolean(payload.isActive) ?? true,
      });
    },
    invalidates: ['accounts', 'trialBalance', 'auditTrail'],
  },
  'account.update': {
    rpc: 'upsert_chart_account',
    args: (payload) => {
      const id = requireString(payload.accountId, 'accountId');
      if (!id.ok) return id;
      const code = requireString(payload.code, 'code');
      if (!code.ok) return code;
      const name = requireString(payload.name, 'name');
      if (!name.ok) return name;
      const type = requireString(payload.accountType, 'accountType');
      if (!type.ok) return type;
      return succeed({
        p_id: id.value,
        p_code: code.value,
        p_name: name.value,
        p_account_type: type.value.toUpperCase(),
        p_currency_code: asString(payload.currencyCode) ?? 'DZD',
        p_parent_id: asString(payload.parentId),
        p_is_active: asBoolean(payload.isActive) ?? true,
      });
    },
    invalidates: ['accounts', 'trialBalance', 'auditTrail'],
  },
  'reconcile.match': {
    rpc: 'match_bank_transaction',
    args: (payload) => {
      const transaction = requireString(payload.transactionId, 'transactionId');
      if (!transaction.ok) return transaction;
      const line = requireString(payload.journalLineId, 'journalLineId');
      if (!line.ok) return line;
      return succeed({ p_transaction_id: transaction.value, p_journal_line_id: line.value });
    },
    invalidates: ['bankTransactions', 'journalLines', 'auditTrail'],
  },
  'reconcile.unmatch': {
    rpc: 'unmatch_bank_transaction',
    args: (payload) => {
      const transaction = requireString(payload.transactionId, 'transactionId');
      if (!transaction.ok) return transaction;
      return succeed({ p_transaction_id: transaction.value });
    },
    invalidates: ['bankTransactions', 'journalLines', 'auditTrail'],
  },
  'period.close': {
    rpc: 'close_fiscal_period',
    args: (payload) => {
      const id = requireString(payload.periodId, 'periodId');
      if (!id.ok) return id;
      return succeed({ p_period_id: id.value });
    },
    invalidates: ['fiscalPeriods', 'journalEntries', 'trialBalance', 'closeTasks', 'auditTrail'],
  },
  'period.reopen': {
    rpc: 'reopen_fiscal_period',
    args: (payload) => {
      const id = requireString(payload.periodId, 'periodId');
      if (!id.ok) return id;
      const reason = requireString(payload.reason, 'reason');
      if (!reason.ok) return reason;
      return succeed({ p_period_id: id.value, p_reason: reason.value });
    },
    invalidates: ['fiscalPeriods', 'journalEntries', 'trialBalance', 'closeTasks', 'auditTrail'],
  },
  'budget.upsert': {
    rpc: 'upsert_budget_line',
    args: (payload) => {
      const budget = requireString(payload.budgetId, 'budgetId');
      if (!budget.ok) return budget;
      const account = requireString(payload.accountId, 'accountId');
      if (!account.ok) return account;
      const dzd = asNumber(payload.amountDzd);
      const sar = asNumber(payload.amountSar);
      if (dzd === null && sar === null) {
        return fail('INVALID_ARGUMENT', 'A budget line needs amountDzd or amountSar');
      }
      return succeed({
        p_budget_id: budget.value,
        p_account_id: account.value,
        p_amount_dzd: dzd ?? 0,
        p_amount_sar: sar ?? 0,
      });
    },
    invalidates: ['budgets', 'budgetLines', 'auditTrail'],
  },
  'closeTask.complete': {
    rpc: 'complete_close_task',
    args: (payload) => {
      const task = requireString(payload.taskId, 'taskId');
      if (!task.ok) return task;
      // close_tasks.certification_status is lower-case by table default.
      const status = asString(payload.status) ?? 'certified';
      return succeed({ p_task_id: task.value, p_status: status.toLowerCase() });
    },
    invalidates: ['closeTasks', 'auditTrail'],
  },
};

/* ------------------------------------------------------------------ *
 * Implementation
 * ------------------------------------------------------------------ */

interface CacheEntry {
  readonly dataset: DatasetName;
  readonly page: DatasetPage;
  readonly at: number;
  readonly bytes: number;
}

class Broker implements DataBrokerSubsystem {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly idempotency = new Map<string, CommandOutcome>();
  private readonly signal = createSignal();
  private hits = 0;
  private misses = 0;
  /** Collapses concurrent identical fetches into one round trip. */
  private readonly inFlight = new Map<string, Promise<AbiResult<DatasetPage>>>();

  constructor(
    private readonly clock: KernelClock,
    private readonly log: KernelLogger,
    private readonly bus: BusSubsystem,
    private readonly processes: ProcessSubsystem,
    private readonly security: SecuritySubsystem,
    private readonly systemPid: Pid,
  ) {}

  async query(pid: Pid, query: DatasetQuery): Promise<AbiResult<DatasetPage>> {
    return this.read(pid, query, MAX_ROWS);
  }

  /**
   * One read path, two ceilings.
   *
   * Applications come through `query` and are held to `MAX_ROWS`. The broker's own
   * derived datasets come through here with `DERIVE_ROWS`, because an aggregate is
   * only true if it saw every row it claims to have summed. Cache, coalescing and
   * capability checks are the same either way.
   */
  private async read(pid: Pid, query: DatasetQuery, ceiling: number): Promise<AbiResult<DatasetPage>> {
    if (!DATASETS.includes(query.dataset)) {
      return fail('INVALID_ARGUMENT', `Unknown dataset: ${String(query.dataset)}`);
    }
    const source = SOURCES[query.dataset];
    const denied = this.checkCapability<DatasetPage>(pid, source.capability, `data.query:${query.dataset}`);
    if (denied !== null) return denied;

    const limit = clampLimit(query.limit, ceiling);
    const key = cacheKey(query, limit);
    const maxAge = query.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const cached = this.cache.get(key);
    if (cached !== undefined && this.clock.monotonic() - cached.at <= maxAge) {
      this.hits += 1;
      return succeed({ ...cached.page, fromCache: true });
    }

    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;

    this.misses += 1;
    const work = this.fetch(pid, query, source, key, limit).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, work);
    return work;
  }

  invalidate(datasets: readonly DatasetName[]): number {
    if (datasets.length === 0) return 0;
    const targets = new Set<DatasetName>(datasets);
    // A derived dataset is stale whenever any of its inputs is.
    for (const name of DATASETS) {
      const source = SOURCES[name];
      if (source.kind === 'derived' && source.dependsOn.some((dep) => targets.has(dep))) targets.add(name);
    }

    let removed = 0;
    for (const [key, entry] of [...this.cache]) {
      if (targets.has(entry.dataset)) {
        this.cache.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.bus.publish(this.systemPid, IPC_CHANNELS.dataChanged, { datasets: [...targets] });
      this.signal.bump();
    }
    return removed;
  }

  async command(pid: Pid, invocation: CommandInvocation): Promise<AbiResult<CommandOutcome>> {
    const binding = BINDINGS[invocation.command];
    if (binding === undefined) {
      return fail('INVALID_ARGUMENT', `Unknown command: ${String(invocation.command)}`);
    }
    const capability = COMMAND_CAPABILITY[invocation.command];
    const denied = this.checkCapability<CommandOutcome>(pid, capability, `data.command:${invocation.command}`);
    if (denied !== null) return denied;
    // A service process runs as SYSTEM and is elevated at spawn; an interactive
    // process needs a live consent token for the command's capability.
    const elevated = this.processes.get(pid)?.elevated === true || this.security.isElevated(capability);
    if (!elevated) {
      return fail<CommandOutcome>('ELEVATION_REQUIRED', `${invocation.command} requires elevation for ${capability}`, {
        capability,
      });
    }

    // Replaying a request id returns the original outcome rather than posting
    // twice — a double-clicked Post button must not create two entries.
    if (invocation.requestId !== undefined) {
      const previous = this.idempotency.get(invocation.requestId);
      if (previous !== undefined) return succeed(previous);
    }

    const args = binding.args(invocation.payload);
    if (!args.ok) return fail<CommandOutcome>(args.error.code, args.error.message, args.error.details);

    if (!isSupabaseConfigured) {
      return fail<CommandOutcome>('IO_ERROR', 'The finance backend is not configured');
    }

    try {
      const { data, error } = await supabase.rpc(binding.rpc, args.value);
      if (error !== null) {
        const code = error.code === 'PGRST202' ? 'NOT_SUPPORTED' : 'IO_ERROR';
        this.log.write(
          'Application',
          'error',
          EVENT_IDS.ledgerCommandFailed,
          'DataBroker',
          `${invocation.command} failed: ${error.message}`,
          { command: invocation.command, rpc: binding.rpc, code: error.code ?? '' },
          pid,
        );
        return fail<CommandOutcome>(code, humanizeRpcError(error.message, binding.rpc), {
          rpc: binding.rpc,
          dbCode: error.code ?? '',
        });
      }

      const invalidated = [...new Set(binding.invalidates)];
      this.invalidate(invalidated);
      const outcome: CommandOutcome = {
        command: invocation.command,
        at: this.clock.iso(),
        result: asRow(data),
        invalidated,
      };
      if (invocation.requestId !== undefined) this.idempotency.set(invocation.requestId, outcome);

      this.log.write(
        'Application',
        'information',
        EVENT_IDS.ledgerCommand,
        'DataBroker',
        `${invocation.command} succeeded`,
        { command: invocation.command, rpc: binding.rpc, invalidated: invalidated.join(',') },
        pid,
      );
      this.bus.publish(this.systemPid, IPC_CHANNELS.ledgerCommand, { command: invocation.command, ok: true });
      if (invocation.command === 'period.close' || invocation.command === 'period.reopen') {
        this.bus.publish(this.systemPid, IPC_CHANNELS.periodChanged, { command: invocation.command });
      }
      this.signal.bump();
      return succeed(outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.write(
        'Application',
        'error',
        EVENT_IDS.ledgerCommandFailed,
        'DataBroker',
        `${invocation.command} threw: ${message}`,
        { command: invocation.command, rpc: binding.rpc },
        pid,
      );
      return fail<CommandOutcome>('IO_ERROR', message, { rpc: binding.rpc });
    }
  }

  stats(): { readonly entries: number; readonly bytes: number; readonly hits: number; readonly misses: number } {
    let bytes = 0;
    for (const entry of this.cache.values()) bytes += entry.bytes;
    return { entries: this.cache.size, bytes, hits: this.hits, misses: this.misses };
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  /* ---------------- internals ---------------- */

  private checkCapability<T>(pid: Pid, capability: Capability, syscall: string): AbiResult<T> | null {
    const record = this.processes.get(pid);
    if (record === null) return fail<T>('INVALID_STATE', `No such process: ${pid as number}`);
    if (record.capabilities.includes(capability)) return null;
    this.log.write(
      'Security',
      'warning',
      EVENT_IDS.capabilityDenied,
      'DataBroker',
      `${record.appId as string} denied ${capability}`,
      { capability, syscall },
      pid,
    );
    return fail<T>('PERMISSION_DENIED', `${syscall} requires the ${capability} capability`, { capability });
  }

  private async fetch(
    pid: Pid,
    query: DatasetQuery,
    source: DatasetSource,
    key: string,
    limit: number,
  ): Promise<AbiResult<DatasetPage>> {
    const rows =
      source.kind === 'table'
        ? await this.fetchTable(source, query, limit)
        : await this.fetchDerived(pid, source, query, limit);
    if (!rows.ok) return fail<DatasetPage>(rows.error.code, rows.error.message, rows.error.details);

    const bytes = estimateBytes(rows.value);
    const page: DatasetPage = {
      dataset: query.dataset,
      rows: rows.value,
      fetchedAt: this.clock.iso() as IsoTimestamp,
      fromCache: false,
      complete: rows.value.length < limit,
      bytes,
    };

    this.cache.set(key, { dataset: query.dataset, page, at: this.clock.monotonic(), bytes });
    this.evict();
    this.processes.noteIo(pid, bytes);
    this.log.write(
      'Application',
      'verbose',
      EVENT_IDS.datasetQuery,
      'DataBroker',
      `Fetched ${query.dataset}`,
      { dataset: query.dataset, rows: rows.value.length, bytes },
      pid,
    );
    this.signal.bump();
    return succeed(page);
  }

  private async fetchTable(
    source: TableSource,
    query: DatasetQuery,
    limit: number,
  ): Promise<AbiResult<readonly DatasetRow[]>> {
    if (!isSupabaseConfigured) {
      return fail('IO_ERROR', 'The finance backend is not configured');
    }
    const offset = Math.max(0, Math.round(query.offset ?? 0));
    const order = query.orderBy ?? source.order;

    try {
      // `as never` narrows only the generated table-name generic; the column
      // list and every filter below come from this module, never from the app.
      let builder = supabase
        .from(source.table as never)
        .select(source.select)
        .order(order.column, { ascending: order.ascending ?? true })
        .range(offset, offset + limit - 1);

      for (const [column, value] of Object.entries(query.where ?? {})) {
        builder = applyFilter(builder, column, value);
      }

      const { data, error } = await builder;
      if (error !== null) {
        return fail('IO_ERROR', `${source.table}: ${error.message}`, { table: source.table, dbCode: error.code ?? '' });
      }
      return succeed(Array.isArray(data) ? data.map((row) => asRow(row) ?? {}) : []);
    } catch (error) {
      return fail('IO_ERROR', error instanceof Error ? error.message : String(error), { table: source.table });
    }
  }

  private async fetchDerived(
    pid: Pid,
    source: DerivedSource,
    query: DatasetQuery,
    limit: number,
  ): Promise<AbiResult<readonly DatasetRow[]>> {
    const loader: DeriveLoader = (dataset, inner) => this.read(pid, { ...inner, dataset }, DERIVE_ROWS);
    const computed = await source.compute(loader);
    if (!computed.ok) return computed;

    let rows = [...computed.value];
    for (const [column, value] of Object.entries(query.where ?? {})) {
      rows = rows.filter((row) => matchesFilter(row[column], value));
    }
    if (query.orderBy !== undefined) {
      const { column, ascending } = query.orderBy;
      const direction = ascending === false ? -1 : 1;
      rows.sort((a, b) => compareValues(a[column], b[column]) * direction);
    }
    const offset = Math.max(0, Math.round(query.offset ?? 0));
    return succeed(rows.slice(offset, offset + limit));
  }

  private evict(): void {
    if (this.cache.size <= CACHE_LIMIT) return;
    const ordered = [...this.cache].sort((a, b) => a[1].at - b[1].at);
    for (const [key] of ordered.slice(0, this.cache.size - CACHE_LIMIT)) this.cache.delete(key);
  }
}

/* ------------------------------------------------------------------ *
 * Query plumbing
 * ------------------------------------------------------------------ */

/**
 * Postgrest builder surface the broker uses. Declared structurally so the
 * filter helper stays honest about what it touches without importing the
 * generated generics.
 */
interface FilterableBuilder {
  eq(column: string, value: string | number | boolean): FilterableBuilder;
  is(column: string, value: null): FilterableBuilder;
  in(column: string, values: readonly string[]): FilterableBuilder;
}

function applyFilter<T>(builder: T, column: string, value: DatasetFilterValue): T {
  const filterable = builder as unknown as FilterableBuilder;
  if (value === null) return filterable.is(column, null) as unknown as T;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return filterable.eq(column, value) as unknown as T;
  }
  return filterable.in(column, value) as unknown as T;
}

function matchesFilter(actual: unknown, expected: DatasetFilterValue): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(expected)) return expected.some((candidate) => String(actual) === candidate);
  return String(actual) === String(expected);
}

function compareValues(a: unknown, b: unknown): number {
  const left = asNumber(a);
  const right = asNumber(b);
  if (left !== null && right !== null) return left - right;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * The effective limit is part of the key, because two readers asking for the same
 * rows at different ceilings are not asking the same question: a derive pulling
 * four thousand journal lines must not be served the application's page of five
 * hundred.
 */
function cacheKey(query: DatasetQuery, limit: number): string {
  const where = Object.entries(query.where ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([column, value]) => `${column}=${Array.isArray(value) ? value.join('+') : String(value)}`)
    .join('&');
  const order = query.orderBy === undefined ? '' : `${query.orderBy.column}:${query.orderBy.ascending === false ? 'desc' : 'asc'}`;
  return `${query.dataset}|${where}|${order}|${limit}|${Math.max(0, Math.round(query.offset ?? 0))}`;
}

/**
 * A page size, resolved once per read.
 *
 * `ceiling` is `MAX_ROWS` for anything an application asked for and `DERIVE_ROWS`
 * for the broker's own aggregate inputs — a trial balance that summed only the
 * newest five hundred lines would be a wrong number, not a small one.
 */
function clampLimit(limit: number | undefined, ceiling: number = MAX_ROWS): number {
  if (limit === undefined) return Math.min(100, ceiling);
  return Math.min(ceiling, Math.max(1, Math.round(limit)));
}

function estimateBytes(rows: readonly DatasetRow[]): number {
  try {
    return JSON.stringify(rows).length;
  } catch {
    return rows.length * 256;
  }
}

/** Turns a Postgrest error string into something a finance user can act on. */
function humanizeRpcError(message: string, rpc: string): string {
  if (/could not find the function/i.test(message)) {
    return `The server does not expose ${rpc}. Apply the pending database migrations.`;
  }
  if (/unauthorized|42501/i.test(message)) return 'Your account is not authorised for this operation.';
  if (/debit and credit must be equal/i.test(message)) return message;
  if (/aal2|assurance/i.test(message)) return 'This operation requires re-authentication with two factors.';
  return message;
}

/* ---------------- value narrowing ---------------- */

function asRow(value: unknown): DatasetRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as DatasetRow;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function requireString(value: unknown, field: string): AbiResult<string> {
  const parsed = asString(value);
  return parsed === null ? fail('INVALID_ARGUMENT', `${field} is required`) : succeed(parsed);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function shortCode(id: string | null): string {
  return id === null ? 'CC' : id.slice(0, 8).toUpperCase();
}

export function createBroker(
  clock: KernelClock,
  log: KernelLogger,
  bus: BusSubsystem,
  processes: ProcessSubsystem,
  security: SecuritySubsystem,
  systemPid: Pid,
): DataBrokerSubsystem {
  return new Broker(clock, log, bus, processes, security, systemPid);
}

/** Exposed for Settings' diagnostics page and the boot self-check. */
export const DATASET_TABLES: Readonly<Record<string, string>> = Object.fromEntries(
  DATASETS.map((name) => {
    const source = SOURCES[name];
    return [name, source.kind === 'table' ? source.table : `derived(${source.dependsOn.join(', ')})`];
  }),
);
