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
 *
 * A dataset resolves one of three ways. A `table` source is a column projection.
 * A `derived` source is an aggregate the broker computes from other datasets. An
 * `rpc` source calls a named SECURITY DEFINER function with a fixed argument
 * list -- which is how the modelling documents arrive, since a model is a nested
 * document assembled by the database and not a row in any one table. The third
 * kind widens nothing: the function name is written here, the argument names are
 * written here, and a `where` key the source does not declare is dropped rather
 * than forwarded.
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
  type DataCommandName,
  type DatasetFilterValue,
  type DatasetName,
  type DatasetPage,
  type DatasetQuery,
  type DatasetRow,
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

/**
 * A dataset that is a function call.
 *
 * Some reads are documents, not projections: `get_modeling_spec` returns one model
 * with its periods, rows, assumptions, scenarios and every override nested inside
 * it, assembled and scope-checked in SQL. There is no column list to write and no
 * table to name, so the source declares the function and how a query becomes its
 * arguments instead.
 *
 * `args` is the whole security boundary and it is the same shape a command binding
 * uses: a function from the app's query to the exact named arguments, free to
 * refuse. An app can therefore pass a model id and a row limit, and nothing else --
 * not a column, not a predicate, not a second function.
 *
 * `rows` exists because a function may answer with a list or with a single object.
 * A document becomes a one-row page rather than a special case in `DatasetPage`,
 * so `useDataset` needs no new shape to read one: `rows[0]` is the model.
 */
interface RpcSource {
  readonly kind: 'rpc';
  readonly rpc: string;
  readonly capability: Capability;
  readonly args: (query: DatasetQuery, limit: number) => AbiResult<Record<string, unknown>>;
  readonly rows: (value: unknown) => readonly DatasetRow[];
}

type DatasetSource = TableSource | DerivedSource | RpcSource;

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

  /**
   * Every model this caller may see, one row each, with the counts and the newest
   * certificate's grade already folded in by SQL. The list screen therefore costs
   * one round trip and cannot disagree with the document screen about how many
   * scenarios a model has.
   */
  modelingModels: {
    kind: 'rpc',
    rpc: 'get_modeling_overview',
    capability: 'ledger.read',
    args: () => succeed({}),
    rows: asRows,
  },

  /**
   * One model, whole: periods, rows, assumptions, scenarios and overrides in a
   * single nested document, which is what the engine needs to compile anything at
   * all. A partial model is not a smaller model, it is a wrong one -- omit an
   * override and every scenario number moves -- so this is deliberately not
   * paginated and deliberately not assembled from parts on this side.
   */
  modelingSpec: {
    kind: 'rpc',
    rpc: 'get_modeling_spec',
    capability: 'ledger.read',
    args: (query) => {
      const id = requireWhereString(query, 'modelId');
      if (!id.ok) return id;
      return succeed({ p_model_id: id.value });
    },
    rows: asDocumentRows,
  },

  /**
   * The certificate history of one model, newest first. Read separately from the
   * spec because a certificate is evidence *about* a version rather than part of
   * it: editing a draft must not appear to revoke what was measured yesterday.
   */
  modelingCertificates: {
    kind: 'rpc',
    rpc: 'get_modeling_certificates',
    capability: 'ledger.read',
    args: (query, limit) => {
      const id = requireWhereString(query, 'modelId');
      if (!id.ok) return id;
      return succeed({ p_model_id: id.value, p_limit: limit });
    },
    rows: asRows,
  },

  /**
   * Every live handoff in scope, oldest first, each carrying a `mine` flag the
   * function computed: addressed to me by name, or to my role and unclaimed, or
   * to nobody in particular.
   *
   * One list with a flag rather than two datasets, because "waiting on me" and
   * "waiting on someone" are read together or not at all -- an Inbox that showed
   * only mine would let a person clear their queue while the thing they asked
   * for on Tuesday sat unassigned and invisible. The flag decides emphasis; it
   * does not decide visibility.
   */
  spineInbox: {
    kind: 'rpc',
    rpc: 'get_spine_inbox',
    capability: 'ledger.read',
    args: (_query, limit) => succeed({ p_limit: limit }),
    rows: asRows,
  },

  /**
   * One chain, whole: every handoff in `seq` order with its event ledger nested
   * underneath. The ordering is the document -- a chain read out of order is a
   * different story about who was waiting on whom -- so it is decided beside the
   * column that defines it and arrives here already sorted.
   */
  spineChain: {
    kind: 'rpc',
    rpc: 'get_spine_chain',
    capability: 'ledger.read',
    args: (query) => {
      const id = requireWhereString(query, 'chainId');
      if (!id.ok) return id;
      return succeed({ p_chain_id: id.value });
    },
    rows: asDocumentRows,
  },

  /**
   * The board: counts of live handoffs by destination stage, counts by status,
   * the age of the oldest thing still waiting, and the open chains themselves.
   * This is the read that answers "where does work pile up" rather than "what is
   * waiting on me", which is the only question a cross-application spine exists
   * to answer.
   *
   * `asDocumentRows`, not `asRows`: the function answers with one object, and
   * `asRows` on an object returns an empty page rather than an error -- a
   * dashboard of zeroes that looks like a quiet week.
   */
  spineOverview: {
    kind: 'rpc',
    rpc: 'get_spine_overview',
    capability: 'ledger.read',
    args: (_query, limit) => succeed({ p_limit: limit }),
    rows: asDocumentRows,
  },

  /**
   * The controls register. A plain table read, ordered by code, because a register
   * is a list somebody reads top to bottom and looks a control up in.
   *
   * `last_result` and `last_tested_at` are selected alongside the definition on
   * purpose: the question the register is opened to answer is not "what do we
   * check" but "what have we not checked lately", and a UI that had to join a
   * second dataset to answer it would show the definition first and the silence
   * second.
   */
  financialControls: {
    kind: 'table',
    table: 'financial_controls',
    select:
      'id,agency_id,control_code,description,owner_role,frequency,status,last_tested_at,last_result,test_population,exceptions,created_at,updated_at',
    order: { column: 'control_code', ascending: true },
    capability: 'ledger.read',
  },

  /**
   * A control's test history, newest first. The generic `where` reaches
   * `control_id`, which is the only filter the detail pane needs.
   *
   * `tested_by_email` is a column and not a join: PostgREST cannot reach
   * `auth.users`, so the address is denormalised when the test is written. It is
   * the identity of whoever signed the assurance, and a history that could only
   * show a uuid would be evidence nobody could read.
   */
  controlTests: {
    kind: 'table',
    table: 'financial_control_tests',
    select:
      'id,agency_id,control_id,tested_at,tested_by,tested_by_email,result,population,exceptions,note,created_at',
    order: { column: 'tested_at', ascending: false },
    capability: 'ledger.read',
  },

  /* ---------------------------------------------------------------- *
   * The commercial pipeline
   * ---------------------------------------------------------------- */

  /**
   * Leads, newest first.
   *
   * The column list is `CrmLeadRow` in `@/types/crm`, which the migration's own
   * header says it mirrors. Writing it out rather than selecting `*` is the same
   * discipline as everywhere above: a projection is a contract, and a column
   * added to the table later should reach an app because someone decided it
   * should, not because a wildcard swept it up.
   *
   * `created_at` descending is the order the legacy workspace used, and it is the
   * right one for a queue nobody has triaged yet: the newest enquiry is the one
   * whose answer is still worth something.
   */
  crmLeads: {
    kind: 'table',
    table: 'crm_leads',
    select:
      'id,agency_id,branch_id,first_name,last_name,phone,email,source,status,priority,notes,score,next_action_at,assigned_to,customer_id,campaign_id,lost_reason,qualified_at,converted_at,created_at,updated_at',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },

  /**
   * Customers, most recently active first.
   *
   * `last_activity_at` rather than `created_at`, because a customer list is a
   * worklist: the account somebody spoke to this morning is the one they are
   * about to speak to again, and the account created first is only interesting
   * to a report.
   */
  crmCustomers: {
    kind: 'table',
    table: 'crm_customers',
    select:
      'id,agency_id,branch_id,code,pilgrim_id,lead_id,campaign_id,full_name,full_name_ar,customer_type,status,phone,email,wilaya,address,source,owner_id,tags,notes,first_won_at,last_activity_at,created_at,updated_at',
    order: { column: 'last_activity_at', ascending: false },
    capability: 'ledger.read',
  },

  /**
   * Opportunities, largest expected value first.
   *
   * Not by date. A pipeline is read to decide where the next hour goes, and the
   * answer to that is the biggest open deal, not the most recent one. The generic
   * `where` reaches `stage` and `customer_id`, which is how the board renders one
   * column and how Customer 360 finds a customer's deals.
   */
  crmOpportunities: {
    kind: 'table',
    table: 'crm_opportunities',
    select:
      'id,agency_id,branch_id,reference,customer_id,lead_id,package_id,campaign_id,booking_id,title,stage,probability,travelers,expected_value_dzd,expected_close_date,owner_id,won_at,lost_at,lost_reason,notes,created_at,updated_at',
    order: { column: 'expected_value_dzd', ascending: false },
    capability: 'ledger.read',
  },

  /**
   * Quotes, newest first. `where` reaches `opportunity_id`, `customer_id` and
   * `status`, which covers the three ways a quote is looked for: from the deal it
   * belongs to, from the customer it was sent to, and from the queue of ones
   * awaiting a reply.
   */
  crmQuotes: {
    kind: 'table',
    table: 'crm_quotes',
    select:
      'id,agency_id,branch_id,quote_number,opportunity_id,customer_id,package_id,booking_id,status,currency_code,subtotal,discount_amount,total_amount,travelers,valid_until,terms,notes,sent_at,accepted_at,declined_at,declined_reason,created_at,updated_at',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },

  /**
   * A quote's lines in the order the quote presents them, filtered by `quote_id`.
   *
   * `line_total` is GENERATED ALWAYS in the database and is projected read-only
   * here for exactly that reason: the app renders the total the database computed
   * instead of multiplying quantity by price itself and disagreeing with the
   * quote the customer received.
   */
  crmQuoteLines: {
    kind: 'table',
    table: 'crm_quote_lines',
    select:
      'id,agency_id,branch_id,quote_id,package_id,description,quantity,unit_price,line_total,sort_order,created_at,updated_at',
    order: { column: 'sort_order', ascending: true },
    capability: 'ledger.read',
  },

  /**
   * The communication log, newest first. `where` reaches `activity_type`,
   * `customer_id`, `lead_id`, `opportunity_id` and `quote_id`, so the same
   * dataset serves the global timeline and the four per-entity ones without a
   * second projection.
   *
   * Ordered by `occurred_at`, not `created_at`: a call logged on Monday for a
   * conversation that happened on Friday belongs on Friday.
   */
  crmActivities: {
    kind: 'table',
    table: 'crm_activities',
    select:
      'id,agency_id,branch_id,customer_id,lead_id,opportunity_id,quote_id,activity_type,direction,subject,body,outcome,duration_minutes,occurred_at,created_by,created_at,updated_at',
    order: { column: 'occurred_at', ascending: false },
    capability: 'ledger.read',
  },

  /**
   * Follow-ups, soonest due first -- ascending, unlike everything else here,
   * because this is the only CRM dataset that is a diary rather than a history.
   * The overdue task is the first row, which is where an overdue task belongs.
   */
  crmFollowups: {
    kind: 'table',
    table: 'crm_followups',
    select:
      'id,agency_id,branch_id,lead_id,customer_id,opportunity_id,title,due_at,priority,status,assigned_to,completed_at,notes,created_at,updated_at',
    order: { column: 'due_at', ascending: true },
    capability: 'ledger.read',
  },

  /** Campaigns, newest first. Budget and spend are projected so ROI can be read
   *  against the leads the campaign is stamped on. */
  crmCampaigns: {
    kind: 'table',
    table: 'crm_campaigns',
    select:
      'id,agency_id,branch_id,code,name,channel,status,start_date,end_date,budget_dzd,spend_dzd,target_segment,notes,created_at,updated_at',
    order: { column: 'created_at', ascending: false },
    capability: 'ledger.read',
  },

  /**
   * Every stage an opportunity has been through, newest first, filtered by
   * `opportunity_id`.
   *
   * This is the audit trail of the pipeline, and it is a separate dataset rather
   * than a nested field on the opportunity because it is read on demand: a board
   * showing two hundred deals would otherwise fetch two hundred histories nobody
   * has opened.
   */
  crmStageHistory: {
    kind: 'table',
    table: 'crm_stage_history',
    select:
      'id,agency_id,branch_id,opportunity_id,from_stage,to_stage,probability,note,changed_by,changed_at,created_at',
    order: { column: 'changed_at', ascending: false },
    capability: 'ledger.read',
  },

  /**
   * The package catalogue, by code.
   *
   * Named for the entity and not for the app that reads it, the way `groups`
   * already is. CRM reads it to price a quote and to name what a deal is for;
   * operations owns the table. The next app that needs a package list must find
   * this entry rather than add `crmPackages` beside it.
   *
   * Both prices are projected because a quote carries `currency_code` and may be
   * written in either, and `seats_available` because a quote for a package with
   * no seats left is a promise the agency cannot keep.
   */
  packages: {
    kind: 'table',
    table: 'packages',
    select: 'id,code,name,name_ar,price_dzd,price_sar,seats_available,status',
    order: { column: 'code', ascending: true },
    capability: 'ledger.read',
  },

  /**
   * The funnel: one row per stage with its count, its value and its weighted
   * value.
   *
   * Derived rather than fetched, for the reason `trialBalance` is. A funnel is a
   * *fold* of the opportunities the caller may already read, so computing it here
   * means the board and the list beside it cannot disagree -- a second server
   * function would be a second answer to "what is in the pipeline", and the two
   * would drift the first time one of them learned about a filter.
   *
   * All six stages are emitted even when empty. A column that vanishes when it
   * empties reads as "this stage does not exist" rather than "nothing is here",
   * and an empty NEGOTIATION column is the most informative thing on the board.
   *
   * The order is the migration's `sort_order` and the transitions in
   * `@/types/crm` depend on the same sequence; it is written out rather than
   * imported because the kernel does not read the app layer's types, and a stage
   * list is six words.
   */
  crmPipeline: {
    kind: 'derived',
    capability: 'ledger.read',
    dependsOn: ['crmOpportunities'],
    compute: async (load) => {
      const opportunities = await load('crmOpportunities', { limit: DERIVE_ROWS });
      if (!opportunities.ok) return opportunities;

      const stages = ['NEW', 'QUALIFYING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
      const buckets = new Map<string, { count: number; value: number; weighted: number; travelers: number }>();
      for (const stage of stages) buckets.set(stage, { count: 0, value: 0, weighted: 0, travelers: 0 });

      for (const row of opportunities.value.rows) {
        const stage = (asString(row.stage) ?? '').toUpperCase();
        // An unknown stage is dropped rather than given a column of its own: the
        // CHECK constraint makes it impossible, and inventing a seventh column
        // from a value that cannot exist would hide the fact that it does.
        const bucket = buckets.get(stage);
        if (bucket === undefined) continue;
        const value = asNumber(row.expected_value_dzd) ?? 0;
        const probability = asNumber(row.probability) ?? 0;
        bucket.count += 1;
        bucket.value += value;
        bucket.weighted += (value * probability) / 100;
        bucket.travelers += asNumber(row.travelers) ?? 0;
      }

      return succeed(
        stages.map((stage, index) => {
          const bucket = buckets.get(stage) ?? { count: 0, value: 0, weighted: 0, travelers: 0 };
          return {
            stage,
            sort_order: index + 1,
            opportunity_count: bucket.count,
            value_dzd: round2(bucket.value),
            weighted_dzd: round2(bucket.weighted),
            travelers: bucket.travelers,
          };
        }),
      );
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

/**
 * The three bindings a CRM record type shares.
 *
 * Seven of the commercial pipeline's entities are plain records the migration
 * exposes the same way -- `create_x_command(p_payload)`,
 * `update_x_command(p_id, p_payload)`, `delete_x_command(p_id)` -- which is
 * twenty-one bindings differing only in a function name. Written out longhand
 * that is two hundred lines whose twentieth copy has a typo nobody notices, so
 * the validation is written once here and the names are passed in.
 *
 * The names are passed in *whole*, not assembled from a stem. `create_crm_lead_command`
 * appears in this file as those characters in that order, because the way anyone
 * ever checks that the kernel calls a function the migration actually defines is
 * to grep for the name -- and a name built by interpolation is a name a grep
 * cannot find. That is the same reason every other binding below spells its `rpc`
 * out.
 *
 * The factory decides nothing at call time: each of the twenty-one still names
 * exactly one server function and declares its own invalidation set.
 */
function crmCrud(
  createRpc: string,
  updateRpc: string,
  deleteRpc: string,
  invalidates: readonly DatasetName[],
): { readonly create: CommandBinding; readonly update: CommandBinding; readonly remove: CommandBinding } {
  return {
    create: {
      rpc: createRpc,
      args: (payload) => {
        const values = requireObject(payload.values, 'values');
        return values.ok ? succeed({ p_payload: values.value }) : values;
      },
      invalidates,
    },
    update: {
      rpc: updateRpc,
      args: (payload) => {
        const id = requireString(payload.id, 'id');
        if (!id.ok) return id;
        const values = requireObject(payload.values, 'values');
        if (!values.ok) return values;
        return succeed({ p_id: id.value, p_payload: values.value });
      },
      invalidates,
    },
    remove: {
      rpc: deleteRpc,
      args: (payload) => {
        const id = requireString(payload.id, 'id');
        return id.ok ? succeed({ p_id: id.value }) : id;
      },
      invalidates,
    },
  };
}

/* The seven, each with the pages its writes make stale. Over-invalidating is
 * safe and under-invalidating shows a user a number that is no longer true, so
 * where a write plausibly touches a neighbour the neighbour is listed: a quote
 * carries its lines, an opportunity carries its stage history and the funnel
 * folded from it, and an activity stamps the customer's `last_activity_at`,
 * which is the column the customer list is ordered by. */
const CRM_LEAD = crmCrud(
  'create_crm_lead_command', 'update_crm_lead_command', 'delete_crm_lead_command',
  ['crmLeads'],
);
const CRM_CUSTOMER = crmCrud(
  'create_crm_customer_command', 'update_crm_customer_command', 'delete_crm_customer_command',
  ['crmCustomers'],
);
const CRM_OPPORTUNITY = crmCrud(
  'create_crm_opportunity_command', 'update_crm_opportunity_command', 'delete_crm_opportunity_command',
  ['crmOpportunities', 'crmPipeline', 'crmStageHistory'],
);
const CRM_QUOTE = crmCrud(
  'create_crm_quote_command', 'update_crm_quote_command', 'delete_crm_quote_command',
  ['crmQuotes', 'crmQuoteLines'],
);
const CRM_QUOTE_LINE = crmCrud(
  'create_crm_quote_line_command', 'update_crm_quote_line_command', 'delete_crm_quote_line_command',
  ['crmQuoteLines', 'crmQuotes'],
);
// `update` is deliberately unexposed: the ABI lets an activity be logged and
// removed but not edited, because a communication log whose entries can be
// rewritten is not a log. The name is still passed so the seven read alike and
// so a future `crm.activity.update` has one place to bind.
const CRM_ACTIVITY = crmCrud(
  'create_crm_activity_command', 'update_crm_activity_command', 'delete_crm_activity_command',
  ['crmActivities', 'crmCustomers'],
);
const CRM_FOLLOWUP = crmCrud(
  'create_crm_followup_command', 'update_crm_followup_command', 'delete_crm_followup_command',
  ['crmFollowups'],
);
const CRM_CAMPAIGN = crmCrud(
  'create_crm_campaign_command', 'update_crm_campaign_command', 'delete_crm_campaign_command',
  ['crmCampaigns'],
);

/**
 * Every command the ABI carries, bound to the function that performs it.
 *
 * The mapped type is over `DataCommandName`, so every family the ABI declares --
 * the ledger's, the modelling ones, the spine's, the controls' and the commercial
 * pipeline's thirty -- is bound in one table, and none of them can be declared in
 * `abi.ts` without being bound here. Argument names are the one thing in this file
 * the compiler cannot check: PostgREST matches by name, so a typo becomes
 * `PGRST202` in front of a user rather than a red squiggle. They were transcribed
 * from the migration's signatures and are worth re-reading against it, not from
 * memory, whenever a command is added.
 */
const BINDINGS: { readonly [K in DataCommandName]: CommandBinding } = {
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

  /* ---------------- modelling ---------------- */

  'model.create': {
    rpc: 'create_modeling_model_command',
    args: (payload) => {
      const key = requireString(payload.key, 'key');
      if (!key.ok) return key;
      const name = requireString(payload.name, 'name');
      if (!name.ok) return name;
      const periods = stringList(payload.periods, 'periods');
      if (!periods.ok) return periods;
      if (periods.value.length === 0) {
        return fail('INVALID_ARGUMENT', 'A model needs at least one period');
      }
      return succeed({
        p_key: key.value,
        p_name: name.value,
        p_periods: periods.value,
        p_name_ar: asString(payload.nameAr),
        p_description: asString(payload.description),
      });
    },
    invalidates: ['modelingModels', 'auditTrail'],
  },
  'model.update': {
    rpc: 'update_modeling_model_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const name = requireString(payload.name, 'name');
      if (!name.ok) return name;
      const periods = stringList(payload.periods, 'periods');
      if (!periods.ok) return periods;
      if (periods.value.length === 0) {
        return fail('INVALID_ARGUMENT', 'A model needs at least one period');
      }
      return succeed({
        p_model_id: model.value,
        p_name: name.value,
        p_periods: periods.value,
        p_name_ar: asString(payload.nameAr),
        p_description: asString(payload.description),
      });
    },
    // Periods live in the header, so changing them changes every row's length.
    invalidates: ['modelingModels', 'modelingSpec', 'auditTrail'],
  },
  'model.publish': {
    rpc: 'publish_modeling_model_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      // The client's measurement of what it is publishing. The database stores it
      // and `certifies()` is what can later refute it; the broker does not compute
      // hashes, because a kernel that recomputed one would be asserting agreement
      // with an engine it does not contain.
      const hash = requireString(payload.fullHash, 'fullHash');
      if (!hash.ok) return hash;
      return succeed({ p_model_id: model.value, p_full_hash: hash.value });
    },
    // A new published hash moves `describesCurrent` on every stored certificate.
    invalidates: ['modelingModels', 'modelingSpec', 'modelingCertificates', 'auditTrail'],
  },
  'model.revise': {
    rpc: 'revise_modeling_model_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      return succeed({ p_model_id: model.value });
    },
    invalidates: ['modelingModels', 'modelingSpec', 'modelingCertificates', 'auditTrail'],
  },
  'model.archive': {
    rpc: 'archive_modeling_model_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      // Absent means archive; `archived: false` is how a model comes back. One
      // command rather than two because the inverse is not a different act.
      return succeed({ p_model_id: model.value, p_archived: asBoolean(payload.archived) ?? true });
    },
    invalidates: ['modelingModels', 'modelingSpec', 'auditTrail'],
  },
  'model.assumption.upsert': {
    rpc: 'upsert_modeling_assumption_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const key = requireString(payload.key, 'key');
      if (!key.ok) return key;
      const label = requireString(payload.label, 'label');
      if (!label.ok) return label;
      const unit = requireString(payload.unit, 'unit');
      if (!unit.ok) return unit;
      const value = requireNumber(payload.value, 'value');
      if (!value.ok) return value;
      return succeed({
        p_model_id: model.value,
        p_key: key.value,
        p_label: label.value,
        // Upper-cased here and validated by the table's CHECK, exactly as
        // `account.create` treats an account type: the closed set of units belongs
        // to the engine and the database, not to a translation layer.
        p_unit: unit.value.toUpperCase(),
        p_value: value.value,
        // Null is meaningful: it says this assumption has no declared range, which
        // is what `RANGES_DECLARED` measures. Coercing it to 0 would have invented
        // a range of zero and quietly improved a grade.
        p_low: asNumber(payload.low),
        p_high: asNumber(payload.high),
        p_label_ar: asString(payload.labelAr),
        p_note: asString(payload.note) ?? '',
        p_sort: asNumber(payload.sortOrder) ?? 0,
      });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  'model.assumption.delete': {
    rpc: 'delete_modeling_assumption_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const key = requireString(payload.key, 'key');
      if (!key.ok) return key;
      return succeed({ p_model_id: model.value, p_key: key.value });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  'model.row.upsert': {
    rpc: 'upsert_modeling_row_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const key = requireString(payload.key, 'key');
      if (!key.ok) return key;
      const label = requireString(payload.label, 'label');
      if (!label.ok) return label;
      const unit = requireString(payload.unit, 'unit');
      if (!unit.ok) return unit;
      const formula = asString(payload.formula);
      let given: readonly number[] = [];
      if (Array.isArray(payload.given)) {
        const parsed = numberList(payload.given, 'given');
        if (!parsed.ok) return parsed;
        given = parsed.value;
      }
      // The table refuses a row holding both and the command raises on a row
      // holding neither. Refusing both cases here means the caller reads the
      // sentence in the vocabulary it sent, rather than a 23514 about a constraint
      // name it has never heard of.
      if ((formula !== null) === (given.length > 0)) {
        return fail('INVALID_ARGUMENT', 'A row needs either a formula or a list of given values, not both');
      }
      return succeed({
        p_model_id: model.value,
        p_key: key.value,
        p_label: label.value,
        p_unit: unit.value.toUpperCase(),
        p_formula: formula,
        p_given: given.length > 0 ? given : null,
        p_label_ar: asString(payload.labelAr),
        p_note: asString(payload.note) ?? '',
        p_sort: asNumber(payload.sortOrder) ?? 0,
      });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  'model.row.delete': {
    rpc: 'delete_modeling_row_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const key = requireString(payload.key, 'key');
      if (!key.ok) return key;
      return succeed({ p_model_id: model.value, p_key: key.value });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  'model.scenario.upsert': {
    rpc: 'upsert_modeling_scenario_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const key = requireString(payload.key, 'key');
      if (!key.ok) return key;
      const name = requireString(payload.name, 'name');
      if (!name.ok) return name;
      return succeed({
        p_model_id: model.value,
        p_key: key.value,
        p_name: name.value,
        // Absent means a root scenario. Inheritance cycles are the database's to
        // refuse -- it can see the whole chain, and this can see one link.
        p_base_key: asString(payload.baseKey),
        p_name_ar: asString(payload.nameAr),
        p_note: asString(payload.note) ?? '',
        p_sort: asNumber(payload.sortOrder) ?? 0,
      });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  'model.scenario.delete': {
    rpc: 'delete_modeling_scenario_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const key = requireString(payload.key, 'key');
      if (!key.ok) return key;
      return succeed({ p_model_id: model.value, p_key: key.value });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  'model.override.set': {
    rpc: 'set_modeling_override_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const scenario = requireString(payload.scenarioKey, 'scenarioKey');
      if (!scenario.ok) return scenario;
      const assumption = requireString(payload.assumptionKey, 'assumptionKey');
      if (!assumption.ok) return assumption;
      const value = requireNumber(payload.value, 'value');
      if (!value.ok) return value;
      return succeed({
        p_model_id: model.value,
        p_scenario_key: scenario.value,
        p_assumption_key: assumption.value,
        p_value: value.value,
        p_note: asString(payload.note) ?? '',
      });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  'model.override.clear': {
    rpc: 'clear_modeling_override_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const scenario = requireString(payload.scenarioKey, 'scenarioKey');
      if (!scenario.ok) return scenario;
      const assumption = requireString(payload.assumptionKey, 'assumptionKey');
      if (!assumption.ok) return assumption;
      return succeed({
        p_model_id: model.value,
        p_scenario_key: scenario.value,
        p_assumption_key: assumption.value,
      });
    },
    invalidates: ['modelingSpec', 'modelingModels', 'auditTrail'],
  },
  /**
   * Store a measurement the engine took.
   *
   * Every one of these numbers was computed in the browser, which sounds like the
   * wrong place for evidence to come from until you ask the alternative: a grade
   * derived server-side would be a second implementation of `certify`, and two
   * implementations of a certification are one more than a reader can trust. So the
   * client says what it measured and against which hash, and the database answers
   * whether that hash is still the published one. Neither side can award a grade
   * the other did not see: this cannot forge `describesCurrent`, and the database
   * cannot improve `grade`.
   */
  'model.certificate.record': {
    rpc: 'record_modeling_certificate_command',
    args: (payload) => {
      const model = requireString(payload.modelId, 'modelId');
      if (!model.ok) return model;
      const scenario = requireString(payload.scenarioKey, 'scenarioKey');
      if (!scenario.ok) return scenario;
      const targetKey = requireString(payload.targetKey, 'targetKey');
      if (!targetKey.ok) return targetKey;
      const targetKind = requireString(payload.targetKind, 'targetKind');
      if (!targetKind.ok) return targetKind;
      const grade = requireString(payload.grade, 'grade');
      if (!grade.ok) return grade;
      const resultsHash = requireString(payload.resultsHash, 'resultsHash');
      if (!resultsHash.ok) return resultsHash;
      const fullHash = requireString(payload.fullHash, 'fullHash');
      if (!fullHash.ok) return fullHash;
      const period = requireNumber(payload.targetPeriod, 'targetPeriod');
      if (!period.ok) return period;
      // A certificate with no checks is not a lenient certificate, it is an empty
      // claim wearing the word. The engine emits nine; one is enough to prove the
      // caller ran something.
      if (!Array.isArray(payload.checks) || payload.checks.length === 0) {
        return fail('INVALID_ARGUMENT', 'checks must be the list of checks the engine ran');
      }
      const limitations = stringList(payload.limitations, 'limitations');
      if (!limitations.ok) return limitations;
      return succeed({
        p_model_id: model.value,
        p_scenario_key: scenario.value,
        p_target_key: targetKey.value,
        p_target_kind: targetKind.value.toUpperCase(),
        p_target_period: Math.max(0, Math.round(period.value)),
        p_grade: grade.value.toUpperCase(),
        p_results_hash: resultsHash.value,
        p_full_hash: fullHash.value,
        // Tallies, not judgements: the database recomputes nothing from them and
        // the checks travel alongside, so a disagreement is visible rather than
        // authoritative.
        p_passed: Math.max(0, Math.round(asNumber(payload.passed) ?? 0)),
        p_warned: Math.max(0, Math.round(asNumber(payload.warned) ?? 0)),
        p_failed: Math.max(0, Math.round(asNumber(payload.failed) ?? 0)),
        p_unmeasured: Math.max(0, Math.round(asNumber(payload.unmeasured) ?? 0)),
        p_checks: payload.checks,
        p_limitations: limitations.value,
      });
    },
    // No `auditTrail`: `modeling_certificates` carries no audit trigger, because a
    // certificate is already an append-only record of who measured what, when.
    invalidates: ['modelingCertificates', 'modelingModels'],
  },

  /* ---- The spine. -------------------------------------------------- *
   *
   * Six commands, six wrappers, and `spine.handoff` on every one rather than
   * `ledger.post`. Asking operations for a rooming list is not an accounting
   * act, and these are called from the Inbox -- an app whose whole job is
   * showing you other people's requests should not need the right to write to
   * the book in order to answer one.
   *
   * Argument names are transcribed from section J of the migration rather than
   * recalled, per this table's own warning: PostgREST matches by name, so a
   * wrong one is a PGRST202 in front of a user.
   *
   * Stages, intents, priorities and roles are upper-cased here; subject types
   * are not. That is not an inconsistency -- the CHECK constraints spell the
   * first four in capitals and the twenty-five subject names in lower snake
   * case, and neither the wrappers nor the bodies fold case. A lower-case
   * 'high' passed through untouched arrives as a constraint violation, which
   * reads like a broken database rather than a bad argument.
   * ------------------------------------------------------------------ */

  'spine.chain.open': {
    rpc: 'open_spine_chain_command',
    args: (payload) => {
      const title = requireString(payload.title, 'title');
      if (!title.ok) return title;
      const subjectType = requireString(payload.subjectType, 'subjectType');
      if (!subjectType.ok) return subjectType;
      const subjectId = requireString(payload.subjectId, 'subjectId');
      if (!subjectId.ok) return subjectId;
      const originStage = requireString(payload.originStage, 'originStage');
      if (!originStage.ok) return originStage;
      const args: Record<string, unknown> = {
        p_title: title.value,
        p_subject_type: subjectType.value,
        p_subject_id: subjectId.value,
        p_origin_stage: originStage.value.toUpperCase(),
      };
      const titleAr = asString(payload.titleAr);
      if (titleAr !== null) args.p_title_ar = titleAr;
      const priority = asString(payload.priority);
      if (priority !== null) args.p_priority = priority.toUpperCase();
      return succeed(args);
    },
    // Not `spineInbox`: a chain with no handoff on it is in nobody's queue.
    // Not `spineChain`: nothing was cached for an id that did not exist.
    invalidates: ['spineOverview', 'auditTrail'],
  },

  /**
   * Hand work to another stage.
   *
   * Fourteen arguments, five of them required, and the nine optional ones are
   * where the honesty lives: `assignedRole` narrows a request to a role without
   * naming a person, `assignedTo` names one, `dueOn` says when it stops being
   * patient, `parentId` says which answer this one is waiting on. Omitting all
   * nine is a valid handoff -- "operations, please review this" -- and the
   * database will take it.
   *
   * `payload` is refused rather than coerced when it is an array or a scalar. A
   * jsonb column that sometimes holds `[1,2]` and sometimes holds an object is a
   * column every reader has to guard, and the guard always gets written once.
   */
  'spine.handoff.open': {
    rpc: 'open_spine_handoff_command',
    args: (payload) => {
      const chain = requireString(payload.chainId, 'chainId');
      if (!chain.ok) return chain;
      const fromStage = requireString(payload.fromStage, 'fromStage');
      if (!fromStage.ok) return fromStage;
      const toStage = requireString(payload.toStage, 'toStage');
      if (!toStage.ok) return toStage;
      const intent = requireString(payload.intent, 'intent');
      if (!intent.ok) return intent;
      const title = requireString(payload.title, 'title');
      if (!title.ok) return title;
      const args: Record<string, unknown> = {
        p_chain_id: chain.value,
        p_from_stage: fromStage.value.toUpperCase(),
        p_to_stage: toStage.value.toUpperCase(),
        p_intent: intent.value.toUpperCase(),
        p_title: title.value,
      };
      const titleAr = asString(payload.titleAr);
      if (titleAr !== null) args.p_title_ar = titleAr;
      const note = asString(payload.note);
      if (note !== null) args.p_note = note;
      const role = asString(payload.assignedRole);
      if (role !== null) args.p_assigned_role = role.toUpperCase();
      const assignee = asString(payload.assignedTo);
      if (assignee !== null) args.p_assigned_to = assignee;
      const dueOn = asString(payload.dueOn);
      if (dueOn !== null) args.p_due_on = dueOn;
      const parent = asString(payload.parentId);
      if (parent !== null) args.p_parent_id = parent;
      const subjectType = asString(payload.subjectType);
      if (subjectType !== null) args.p_subject_type = subjectType;
      const subjectId = asString(payload.subjectId);
      if (subjectId !== null) args.p_subject_id = subjectId;
      if (payload.payload !== undefined && payload.payload !== null) {
        if (typeof payload.payload !== 'object' || Array.isArray(payload.payload)) {
          return fail('INVALID_ARGUMENT', 'payload must be an object');
        }
        args.p_payload = payload.payload;
      }
      return succeed(args);
    },
    invalidates: ['spineInbox', 'spineChain', 'spineOverview', 'auditTrail'],
  },

  /** Take it. Says who is holding it now, which is the whole point of a queue
   *  that more than one person can see. */
  'spine.handoff.accept': {
    rpc: 'accept_spine_handoff_command',
    args: (payload) => {
      const id = requireString(payload.handoffId, 'handoffId');
      if (!id.ok) return id;
      const args: Record<string, unknown> = { p_handoff_id: id.value };
      const note = asString(payload.note);
      if (note !== null) args.p_note = note;
      return succeed(args);
    },
    invalidates: ['spineInbox', 'spineChain', 'spineOverview', 'auditTrail'],
  },

  /** Done. Advances the chain's stage, which is why `spineOverview` goes stale. */
  'spine.handoff.complete': {
    rpc: 'complete_spine_handoff_command',
    args: (payload) => {
      const id = requireString(payload.handoffId, 'handoffId');
      if (!id.ok) return id;
      const args: Record<string, unknown> = { p_handoff_id: id.value };
      const note = asString(payload.note);
      if (note !== null) args.p_note = note;
      return succeed(args);
    },
    invalidates: ['spineInbox', 'spineChain', 'spineOverview', 'auditTrail'],
  },

  /**
   * No, and here is why.
   *
   * `requireString`, not `asString`, and it is the only command here where the
   * note is mandatory. The wrapper has no default on `p_note` either, so this
   * refusal happens twice on purpose: a decline with no reason is a row that
   * stops a flow and explains nothing, and the person best placed to explain it
   * is the one who just said no.
   */
  'spine.handoff.decline': {
    rpc: 'decline_spine_handoff_command',
    args: (payload) => {
      const id = requireString(payload.handoffId, 'handoffId');
      if (!id.ok) return id;
      const note = requireString(payload.note, 'note');
      if (!note.ok) return note;
      return succeed({ p_handoff_id: id.value, p_note: note.value });
    },
    invalidates: ['spineInbox', 'spineChain', 'spineOverview', 'auditTrail'],
  },

  /**
   * End the chain: CLOSED if everything was answered, ABANDONED if it was not.
   *
   * ABANDONED supersedes whatever is still open, one event each, so rows leave
   * queues that the caller may never have looked at -- which is why this
   * invalidates the Inbox as well as the board.
   */
  'spine.chain.close': {
    rpc: 'close_spine_chain_command',
    args: (payload) => {
      const id = requireString(payload.chainId, 'chainId');
      if (!id.ok) return id;
      const args: Record<string, unknown> = { p_chain_id: id.value };
      const status = asString(payload.status);
      if (status !== null) args.p_status = status.toUpperCase();
      const note = asString(payload.note);
      if (note !== null) args.p_note = note;
      return succeed(args);
    },
    invalidates: ['spineInbox', 'spineChain', 'spineOverview', 'auditTrail'],
  },

  /**
   * Open or amend a control. `controlId` absent means create; present means amend,
   * and the server authorises the two differently -- `create` reaches nothing but
   * the create verb, `update` goes through the guard that also refuses a retired
   * row.
   *
   * Every field is sent every time, including the ones the user did not touch. The
   * server writes all four from its arguments unconditionally, so omitting the
   * description would clear it. That is a PUT, and pretending otherwise in the
   * broker -- by dropping absent keys -- would turn "I only edited the frequency"
   * into a silent erasure of the description.
   */
  'controls.upsert': {
    rpc: 'upsert_financial_control_command',
    args: (payload) => {
      const code = requireString(payload.controlCode, 'controlCode');
      if (!code.ok) return code;
      const frequency = requireString(payload.frequency, 'frequency');
      if (!frequency.ok) return frequency;
      return succeed({
        p_id: asString(payload.controlId),
        p_control_code: code.value,
        p_description: asString(payload.description),
        p_owner_role: asString(payload.ownerRole),
        p_frequency: frequency.value.toLowerCase(),
      });
    },
    invalidates: ['financialControls', 'auditTrail'],
  },

  /**
   * Record a test. This writes the history row and moves the register's four
   * latest-result columns in one server-side transaction, which is why both
   * datasets are invalidated: a UI that refreshed only the history would show a
   * test the register does not yet reflect, and the disagreement is exactly the
   * failure mode the single-command design exists to prevent.
   *
   * `result` is lower-cased here as well as on the server. The server is the
   * authority; this only keeps a `PASSED` from a select element from arriving as a
   * refusal the user cannot explain.
   */
  'controls.test': {
    rpc: 'record_control_test_command',
    args: (payload) => {
      const id = requireString(payload.controlId, 'controlId');
      if (!id.ok) return id;
      const result = requireString(payload.result, 'result');
      if (!result.ok) return result;
      return succeed({
        p_control_id: id.value,
        p_result: result.value.toLowerCase(),
        p_population: asString(payload.population),
        p_exceptions: asString(payload.exceptions),
        p_note: asString(payload.note),
      });
    },
    invalidates: ['financialControls', 'controlTests', 'auditTrail'],
  },

  /**
   * Retire a control. The reason is required by the server and required here, so
   * the refusal arrives before the round trip rather than after it.
   *
   * `controlTests` is not invalidated: retiring changes what the register accepts,
   * not what its history says. Nothing about the recorded tests moves.
   */
  'controls.retire': {
    rpc: 'retire_financial_control_command',
    args: (payload) => {
      const id = requireString(payload.controlId, 'controlId');
      if (!id.ok) return id;
      const reason = requireString(payload.reason, 'reason');
      if (!reason.ok) return reason;
      return succeed({ p_control_id: id.value, p_reason: reason.value });
    },
    invalidates: ['financialControls', 'auditTrail'],
  },

  /* ---------------------------------------------------------------- *
   * The commercial pipeline
   * ---------------------------------------------------------------- */

  'crm.lead.create': CRM_LEAD.create,
  'crm.lead.update': CRM_LEAD.update,
  'crm.lead.delete': CRM_LEAD.remove,
  'crm.customer.create': CRM_CUSTOMER.create,
  'crm.customer.update': CRM_CUSTOMER.update,
  'crm.customer.delete': CRM_CUSTOMER.remove,
  'crm.opportunity.create': CRM_OPPORTUNITY.create,
  'crm.opportunity.update': CRM_OPPORTUNITY.update,
  'crm.opportunity.delete': CRM_OPPORTUNITY.remove,
  'crm.quote.create': CRM_QUOTE.create,
  'crm.quote.update': CRM_QUOTE.update,
  'crm.quote.delete': CRM_QUOTE.remove,
  'crm.quoteLine.create': CRM_QUOTE_LINE.create,
  'crm.quoteLine.update': CRM_QUOTE_LINE.update,
  'crm.quoteLine.delete': CRM_QUOTE_LINE.remove,
  'crm.activity.log': CRM_ACTIVITY.create,
  'crm.activity.delete': CRM_ACTIVITY.remove,
  'crm.followup.create': CRM_FOLLOWUP.create,
  'crm.followup.update': CRM_FOLLOWUP.update,
  'crm.followup.delete': CRM_FOLLOWUP.remove,
  'crm.campaign.create': CRM_CAMPAIGN.create,
  'crm.campaign.update': CRM_CAMPAIGN.update,
  'crm.campaign.delete': CRM_CAMPAIGN.remove,

  /**
   * A lead becomes a customer and an opportunity in one transaction.
   *
   * Only the lead is required. Everything else is what a salesperson knows at the
   * moment of qualification and may not know yet -- which package, how many
   * travellers, what it is worth, when it closes -- and a conversion refused for
   * want of an expected close date is a conversion that happens in somebody's
   * head instead of in the database.
   */
  'crm.lead.convert': {
    rpc: 'convert_crm_lead_command',
    args: (payload) => {
      const leadId = requireString(payload.leadId, 'leadId');
      if (!leadId.ok) return leadId;
      const args: Record<string, unknown> = { p_lead_id: leadId.value };
      const packageId = asString(payload.packageId);
      if (packageId !== null) args.p_package_id = packageId;
      const travelers = asNumber(payload.travelers);
      if (travelers !== null) args.p_travelers = travelers;
      const value = asNumber(payload.expectedValueDzd);
      if (value !== null) args.p_expected_value_dzd = value;
      const closeDate = asString(payload.expectedCloseDate);
      if (closeDate !== null) args.p_expected_close_date = closeDate;
      const title = asString(payload.title);
      if (title !== null) args.p_title = title;
      return succeed(args);
    },
    invalidates: ['crmLeads', 'crmCustomers', 'crmOpportunities', 'crmPipeline', 'crmActivities'],
  },

  /**
   * The whole tag set, replaced.
   *
   * `tags` is `text[]`, and a jsonb `p_payload` cannot carry a Postgres array, so
   * this is its own function rather than a field in `crm.customer.update`.
   * `stringList` treats absent as empty, which is right: clearing every tag is a
   * thing a person means to do, and refusing it would leave the last tag
   * un-removable.
   */
  'crm.customer.tags': {
    rpc: 'set_crm_customer_tags_command',
    args: (payload) => {
      const id = requireString(payload.id, 'id');
      if (!id.ok) return id;
      const tags = stringList(payload.tags, 'tags');
      if (!tags.ok) return tags;
      return succeed({ p_id: id.value, p_tags: tags.value });
    },
    invalidates: ['crmCustomers'],
  },

  /**
   * A stage transition, which the server refuses if it is illegal.
   *
   * The legal moves live in the migration and are mirrored in
   * `CRM_STAGE_TRANSITIONS` for the app's benefit; this binding does not re-check
   * them. The kernel would be guessing at a rule it does not own, and a
   * client-side copy that agreed with the server would be dead code while one
   * that disagreed would be a bug hiding the server's answer.
   *
   * `WON` is not reachable here. An opportunity is won by accepting its quote,
   * which is the path that writes the booking, the payment and the journal entry;
   * a "mark as won" would produce a won deal with no money behind it.
   */
  'crm.opportunity.stage': {
    rpc: 'transition_crm_opportunity_stage',
    args: (payload) => {
      const id = requireString(payload.opportunityId, 'opportunityId');
      if (!id.ok) return id;
      const stage = requireString(payload.toStage, 'toStage');
      if (!stage.ok) return stage;
      const args: Record<string, unknown> = {
        p_opportunity_id: id.value,
        p_to_stage: stage.value.toUpperCase(),
      };
      const note = asString(payload.note);
      if (note !== null) args.p_note = note;
      const lostReason = asString(payload.lostReason);
      if (lostReason !== null) args.p_lost_reason = lostReason;
      return succeed(args);
    },
    invalidates: ['crmOpportunities', 'crmStageHistory', 'crmPipeline', 'crmActivities'],
  },

  /**
   * Sending a quote stamps a validity window from the day it is sent, which is
   * why the window is a count of days and not a date: "fourteen days" is the
   * promise, and computing the date here would put the customer's deadline on the
   * client's clock.
   */
  'crm.quote.send': {
    rpc: 'send_crm_quote_command',
    args: (payload) => {
      const id = requireString(payload.quoteId, 'quoteId');
      if (!id.ok) return id;
      const args: Record<string, unknown> = { p_quote_id: id.value };
      const validDays = asNumber(payload.validDays);
      if (validDays !== null) args.p_valid_days = validDays;
      return succeed(args);
    },
    invalidates: ['crmQuotes', 'crmActivities'],
  },

  /**
   * A decline carries a required reason. The sentence explaining why a customer
   * said no is the most valuable thing that happens to a lost quote, and a field
   * that may be skipped is a field that is skipped.
   */
  'crm.quote.decline': {
    rpc: 'decline_crm_quote_command',
    args: (payload) => {
      const id = requireString(payload.quoteId, 'quoteId');
      if (!id.ok) return id;
      const reason = requireString(payload.reason, 'reason');
      if (!reason.ok) return reason;
      return succeed({ p_quote_id: id.value, p_reason: reason.value });
    },
    invalidates: ['crmQuotes', 'crmOpportunities', 'crmPipeline', 'crmActivities'],
  },

  /**
   * Completing a follow-up stamps who closed it and when, which an `update` of
   * the status column would not. The diary's value is in knowing somebody
   * actually made the call, not in a row that now reads DONE.
   */
  'crm.followup.complete': {
    rpc: 'complete_crm_followup_command',
    args: (payload) => {
      const id = requireString(payload.id, 'id');
      if (!id.ok) return id;
      const args: Record<string, unknown> = { p_id: id.value };
      const note = asString(payload.note);
      if (note !== null) args.p_note = note;
      return succeed(args);
    },
    invalidates: ['crmFollowups', 'crmActivities'],
  },

  /**
   * Accepting a quote is the act that books the sale.
   *
   * One call writes a pilgrim, a booking, an invoice, a payment and a journal
   * entry and moves the opportunity to `WON` -- `CrmQuoteAcceptedResult` names
   * every one of them. That is why this is the single CRM command costing
   * `ledger.post` rather than `crm.write`, and why the invalidation list below
   * looks excessive and is not: each page named is a page that became wrong the
   * instant this returned.
   *
   * Only the quote is required. A deposit of zero is a legitimate acceptance --
   * the booking exists and the money is owed -- so the amounts cannot be checked
   * for presence; they are forwarded when given and left to the function's own
   * defaults when not.
   *
   * `bookings` and `documents` are missing from the list because they are not
   * datasets. The booking created here is read through `groups` and the ledger
   * pages; when a `bookings` dataset exists it belongs in this array, and this
   * paragraph is the reminder.
   */
  'crm.quote.accept': {
    rpc: 'accept_crm_quote_command',
    args: (payload) => {
      const id = requireString(payload.quoteId, 'quoteId');
      if (!id.ok) return id;
      const args: Record<string, unknown> = { p_quote_id: id.value };
      const dzd = asNumber(payload.paymentAmountDzd);
      if (dzd !== null) args.p_payment_amount_dzd = dzd;
      const sar = asNumber(payload.paymentAmountSar);
      if (sar !== null) args.p_payment_amount_sar = sar;
      const method = asString(payload.paymentMethod);
      if (method !== null) args.p_payment_method = method;
      const groupId = asString(payload.groupId);
      if (groupId !== null) args.p_group_id = groupId;
      const passport = asString(payload.passportNumber);
      if (passport !== null) args.p_passport_number = passport;
      const notes = asString(payload.notes);
      if (notes !== null) args.p_notes = notes;
      return succeed(args);
    },
    invalidates: [
      'crmQuotes',
      'crmOpportunities',
      'crmPipeline',
      'crmActivities',
      'crmCustomers',
      'groups',
      'invoices',
      'payments',
      'journalEntries',
      'journalLines',
      'trialBalance',
      'auditTrail',
    ],
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
        : source.kind === 'rpc'
          ? await this.fetchRpc(source, query, limit)
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

  /**
   * A read that is a function call.
   *
   * `source.args` is the only thing standing between the app's query and the
   * database, and it is a whitelist by construction: it returns the named
   * arguments it chose, so a `where` key nobody declared cannot arrive at the
   * function. Note what is missing compared with `fetchTable` -- no `order`, no
   * `range`, no filter loop. Ordering and row limits are the function's business,
   * because it is the function that knows what a page of its answer means.
   */
  private async fetchRpc(
    source: RpcSource,
    query: DatasetQuery,
    limit: number,
  ): Promise<AbiResult<readonly DatasetRow[]>> {
    if (!isSupabaseConfigured) {
      return fail('IO_ERROR', 'The finance backend is not configured');
    }
    const args = source.args(query, limit);
    if (!args.ok) return fail<readonly DatasetRow[]>(args.error.code, args.error.message, args.error.details);

    try {
      const { data, error } = await supabase.rpc(source.rpc, args.value);
      if (error !== null) {
        const code = error.code === 'PGRST202' ? 'NOT_SUPPORTED' : 'IO_ERROR';
        return fail(code, humanizeRpcError(error.message, source.rpc), {
          rpc: source.rpc,
          dbCode: error.code ?? '',
        });
      }
      return succeed(source.rows(data));
    } catch (error) {
      return fail('IO_ERROR', error instanceof Error ? error.message : String(error), { rpc: source.rpc });
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

/**
 * A function's array result, as a page.
 *
 * Non-object members are dropped rather than coerced: a `null` in the middle of a
 * jsonb array would otherwise reach an app as a row with no columns, and every
 * caller would have to defend against it. Dropping is safe here because the page
 * already reports `complete`, so a short page is a shape the caller handles.
 */
function asRows(value: unknown): readonly DatasetRow[] {
  if (!Array.isArray(value)) return [];
  const rows: DatasetRow[] = [];
  for (const entry of value as readonly unknown[]) {
    const row = asRow(entry);
    if (row !== null) rows.push(row);
  }
  return rows;
}

/**
 * A function's single-object result, as a one-row page.
 *
 * This is the whole reason `RpcSource.rows` exists. `get_modeling_spec` answers
 * with one document; wrapping it here means `DatasetPage` needs no second shape
 * and `useDataset` needs no new hook -- a screen reads `rows[0]` and an absent
 * model is an empty page, which is exactly how a missing row already reads.
 */
function asDocumentRows(value: unknown): readonly DatasetRow[] {
  const row = asRow(value);
  return row === null ? [] : [row];
}

/**
 * A required string drawn from a query's `where`.
 *
 * An `rpc` source cannot forward a predicate, so the few arguments it does accept
 * arrive as `where` keys and are pulled out by name. `DatasetFilterValue` admits
 * arrays, which is why this narrows rather than casts: `where: { modelId: [] }`
 * is a refusal, not an argument.
 */
function requireWhereString(query: DatasetQuery, key: string): AbiResult<string> {
  return requireString(query.where?.[key], key);
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

/**
 * A required jsonb object.
 *
 * The generic CRUD commands hand Postgres a whole record as one `p_payload`
 * argument, and jsonb accepts an array or a bare number as happily as it accepts
 * an object -- so `[{...}]` would insert successfully and produce a row whose
 * columns are all null, which reads as data loss rather than as a rejected call.
 * Arrays and null are refused here for the same reason `asRow` refuses them one
 * layer down: the shape has to be decided before it crosses the wire, not
 * discovered afterwards by whoever opens the record.
 */
function requireObject(value: unknown, field: string): AbiResult<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('INVALID_ARGUMENT', `${field} must be an object`);
  }
  return succeed(value as Record<string, unknown>);
}

/**
 * A list of strings, absent meaning empty.
 *
 * Written for the two `text[]` arguments the modelling commands take -- a model's
 * periods and a certificate's limitations. A non-string member is refused rather
 * than coerced, because `String(undefined)` would have travelled as the period
 * label `"undefined"` and appeared on a chart axis.
 */
function stringList(value: unknown, field: string): AbiResult<readonly string[]> {
  if (value === undefined || value === null) return succeed([]);
  if (!Array.isArray(value)) return fail('INVALID_ARGUMENT', `${field} must be a list`);
  const items: string[] = [];
  for (const entry of value as readonly unknown[]) {
    const text = asString(entry);
    if (text === null) return fail('INVALID_ARGUMENT', `${field} contains an entry that is not text`);
    items.push(text);
  }
  return succeed(items);
}

/** A list of finite numbers. One bad member refuses the whole list: a row of given
 *  values with a hole in it is a wrong row, not a shorter one. */
function numberList(value: readonly unknown[], field: string): AbiResult<readonly number[]> {
  const items: number[] = [];
  for (const entry of value) {
    const parsed = asNumber(entry);
    if (parsed === null) return fail('INVALID_ARGUMENT', `${field} contains a value that is not a number`);
    items.push(parsed);
  }
  return succeed(items);
}

/** A required finite number. `0` and negatives are legitimate assumption values,
 *  so this cannot be written as a falsiness check. */
function requireNumber(value: unknown, field: string): AbiResult<number> {
  const parsed = asNumber(value);
  return parsed === null ? fail('INVALID_ARGUMENT', `${field} must be a number`) : succeed(parsed);
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
    if (source.kind === 'table') return [name, source.table];
    // Named so the diagnostics page reads as an explanation of where a number
    // came from rather than a list of table names it could not find.
    if (source.kind === 'rpc') return [name, `function(${source.rpc})`];
    return [name, `derived(${source.dependsOn.join(', ')})`];
  }),
);
