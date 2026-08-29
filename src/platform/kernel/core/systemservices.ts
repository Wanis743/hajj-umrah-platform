/**
 * The services the OS ships with.
 *
 * Each definition is real background work, not a heartbeat that increments a
 * counter. Between them they keep the broker cache warm, maintain the `L:`
 * ledger projection, record performance history, watch the fiscal calendar,
 * index the file system for search, and snapshot the persistent volume.
 *
 * Every one of them reaches the outside world the same way an application does:
 * through `ctx.invoke`, which is the syscall dispatcher. A service has no
 * privileged back door into the broker, the window manager or Supabase — it is
 * simply a process the kernel starts for you.
 *
 * Failure discipline: a data source being unavailable is *not* a fault. It is
 * logged and the tick returns, because a service that faults every 45 seconds
 * because the network is down would exhaust its restart policy and stay dead
 * after the network came back. Only programming errors are allowed to throw.
 */
import {
  APP_IDS,
  REG,
  type DatasetName,
  type DatasetPage,
  type DatasetRow,
  type Localized,
  type ToastKind,
} from '../abi';
import type { ServiceContext, ServiceDefinition } from '../contracts';
import { IPC_CHANNELS } from './bus';
import { EVENT_IDS } from './eventlog';
import { join } from './paths';
import type { ProjectedEntry, ProjectionVolumeHandle } from './volumes';

/** Service names, exported so Settings and the Services app can address them. */
export const SERVICE_NAMES = {
  ledgerSync: 'FinanceOS.LedgerSync',
  ledgerIndexer: 'FinanceOS.LedgerIndexer',
  diagnostics: 'FinanceOS.Diagnostics',
  periodGuard: 'FinanceOS.PeriodGuard',
  searchIndexer: 'FinanceOS.SearchIndexer',
  backup: 'FinanceOS.Backup',
} as const;

/** Registry root the services keep their own state under. */
const STATE_KEY = `${REG.machinePolicy}\\ServiceState`;

/** Datasets LedgerSync keeps warm — the ones every finance app opens with. */
const HOT_DATASETS: readonly DatasetName[] = [
  'accounts',
  'journalEntries',
  'fiscalPeriods',
  'bankTransactions',
  'closeTasks',
];

/** Performance samples retained in the rolling log. */
const PERF_HISTORY = 240;
/** Memory pressure that earns a warning in the System channel. */
const MEMORY_PRESSURE = 0.85;
/** Files the search indexer will hold. Bounded so `X:` cannot be filled. */
const SEARCH_INDEX_LIMIT = 4_000;
/** Directory depth the indexer descends. Deep enough for the whole profile. */
const SEARCH_MAX_DEPTH = 8;
/** Snapshots kept in the backup folder before the oldest is pruned. */
const BACKUP_RETENTION = 5;
/** Draft entries older than this are worth telling someone about. */
const STALE_DRAFT_DAYS = 7;
/** Unmatched bank lines above this count raise a reconciliation reminder. */
const UNMATCHED_ALERT = 10;

const PERF_LOG_PATH = 'X:\\Windows\\Temp\\perf.jsonl';
const SEARCH_INDEX_PATH = 'X:\\Windows\\Search\\index.json';

export interface SystemServiceDeps {
  /** The `L:` volume the indexer publishes into. */
  readonly ledgerVolume: ProjectionVolumeHandle;
  /** Absolute path of the interactive user's profile, e.g. `C:\Users\finance`. */
  readonly userFolder: string;
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function text(ar: string, fr: string, en: string): Localized {
  return { ar, fr, en };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Pulls a dataset, logging (never throwing) when the source is unavailable.
 * Returns `null` so the caller can skip the rest of its tick cleanly.
 */
async function read(
  ctx: ServiceContext,
  dataset: DatasetName,
  options: { limit?: number; where?: Readonly<Record<string, string | number | boolean | null>>; maxAgeMs?: number } = {},
): Promise<DatasetPage | null> {
  const result = await ctx.invoke('data.query', {
    dataset,
    limit: options.limit,
    where: options.where,
    maxAgeMs: options.maxAgeMs,
  });
  if (result.ok) return result.value;
  ctx.log.write(
    'Application',
    'warning',
    EVENT_IDS.datasetQuery,
    'Service',
    `Dataset ${dataset} unavailable`,
    { code: result.error.code, error: result.error.message },
    ctx.pid,
  );
  return null;
}

/**
 * Cheap change signature for a page: row count plus the most recent timestamp.
 * Two pages with the same signature are treated as the same data, which is what
 * keeps the services from republishing and re-notifying on every tick.
 */
function signatureOf(page: DatasetPage): string {
  let newest = '';
  for (const row of page.rows) {
    const stamp = asString(row.updated_at) ?? asString(row.posted_at) ?? asString(row.created_at) ?? '';
    if (stamp > newest) newest = stamp;
  }
  return `${page.rows.length}:${newest}`;
}

/** Filesystem-safe file or folder name. */
function safeName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned === '' ? fallback : cleaned.slice(0, 80);
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** Reads a remembered marker, so a reminder fires on change and not on repeat. */
function marker(ctx: ServiceContext, name: string): string {
  return ctx.registry.getString(STATE_KEY, name, '');
}

function setMarker(ctx: ServiceContext, name: string, value: string): void {
  ctx.registry.set(STATE_KEY, name, value);
}

async function notify(
  ctx: ServiceContext,
  kind: ToastKind,
  title: string,
  body: string,
  launch: (typeof APP_IDS)[keyof typeof APP_IDS],
): Promise<void> {
  await ctx.invoke('shell.notify', { kind, title, body, launch });
}

/* ------------------------------------------------------------------ *
 * FinanceOS.LedgerSync — keeps the broker cache warm
 * ------------------------------------------------------------------ */

function ledgerSync(): ServiceDefinition {
  const signatures = new Map<DatasetName, string>();

  return {
    name: SERVICE_NAMES.ledgerSync,
    display: text('مزامنة دفتر الأستاذ', 'Synchronisation du grand livre', 'Ledger Sync'),
    description: text(
      'يحدّث بيانات المحاسبة في الخلفية وينبّه التطبيقات عند تغيّرها.',
      'Rafraîchit les données comptables en arrière-plan et notifie les applications des changements.',
      'Refreshes accounting datasets in the background and tells applications when they change.',
    ),
    startType: 'automatic',
    capabilities: ['ledger.read', 'notify'],
    intervalMs: 45_000,

    async tick(ctx) {
      const changed: DatasetName[] = [];

      for (const dataset of HOT_DATASETS) {
        // `maxAgeMs: 0` bypasses the cache: this tick *is* the refresh.
        const page = await read(ctx, dataset, { limit: 200, maxAgeMs: 0 });
        if (page === null) continue;
        ctx.noteWork();

        const next = signatureOf(page);
        if (signatures.get(dataset) !== next) {
          signatures.set(dataset, next);
          changed.push(dataset);
        }
      }

      ctx.registry.set(STATE_KEY, 'LedgerSyncAt', ctx.clock.iso());
      ctx.registry.set(STATE_KEY, 'LedgerSyncDatasets', signatures.size);

      // Only publish when something actually moved, so open apps refetch on
      // real change rather than on a timer.
      if (changed.length > 0) {
        ctx.bus.publish(ctx.pid, IPC_CHANNELS.dataChanged, { datasets: changed });
        ctx.noteWork(changed.length);
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * FinanceOS.LedgerIndexer — materialises the `L:` volume
 * ------------------------------------------------------------------ */

function ledgerIndexer(deps: SystemServiceDeps): ServiceDefinition {
  let lastSignature = '';

  return {
    name: SERVICE_NAMES.ledgerIndexer,
    display: text('فهرسة الدفتر', 'Indexation du grand livre', 'Ledger Indexer'),
    description: text(
      'يبني القرص L: من الحسابات والقيود والفترات حتى يمكن استعراض الدفتر كملفات.',
      'Construit le volume L: à partir des comptes, écritures et périodes pour parcourir le grand livre comme des fichiers.',
      'Builds the L: volume from accounts, journals and periods so the ledger can be browsed as files.',
    ),
    startType: 'automaticDelayed',
    dependsOn: [SERVICE_NAMES.ledgerSync],
    capabilities: ['ledger.read', 'fs.read'],
    intervalMs: 120_000,

    async tick(ctx) {
      const accounts = await read(ctx, 'accounts', { limit: 500 });
      if (accounts === null) return;
      const entries = await read(ctx, 'journalEntries', { limit: 300 });
      if (entries === null) return;
      const periods = await read(ctx, 'fiscalPeriods', { limit: 100 });
      if (periods === null) return;
      const trial = await read(ctx, 'trialBalance', { limit: 500 });

      const signature = [accounts, entries, periods]
        .map((page) => signatureOf(page))
        .concat(trial === null ? 'no-tb' : signatureOf(trial))
        .join('|');
      if (signature === lastSignature) return;

      const projected: ProjectedEntry[] = [
        {
          path: 'README.md',
          contentType: 'text/markdown',
          content: readme(ctx, accounts.rows.length, entries.rows.length, periods.rows.length),
        },
        ...accountEntries(accounts.rows),
        ...journalEntries(entries.rows),
        ...periodEntries(periods.rows),
      ];

      if (trial !== null) {
        projected.push({
          path: 'Reports\\trial-balance.csv',
          contentType: 'text/csv',
          content: trialBalanceCsv(trial.rows),
        });
      }

      deps.ledgerVolume.publish(projected);
      lastSignature = signature;
      ctx.noteWork(projected.length);
      ctx.registry.set(STATE_KEY, 'LedgerIndexAt', ctx.clock.iso());
      ctx.registry.set(STATE_KEY, 'LedgerIndexFiles', projected.length);
      ctx.bus.publish(ctx.pid, IPC_CHANNELS.fileChanged, { path: 'L:\\', kind: 'modified' });
    },
  };
}

function readme(ctx: ServiceContext, accounts: number, entries: number, periods: number): string {
  return [
    '# Ledger projection (L:)',
    '',
    'This volume is generated by **FinanceOS.LedgerIndexer** and is read-only.',
    'Editing the ledger happens in Journal, Ledger and Reconciliation — never here.',
    '',
    `- Generated: ${ctx.clock.iso()}`,
    `- Accounts: ${accounts}`,
    `- Journal entries: ${entries}`,
    `- Fiscal periods: ${periods}`,
    '',
    '## Layout',
    '',
    '| Folder | Contents |',
    '| --- | --- |',
    '| `Accounts\\<type>` | One JSON document per chart-of-accounts entry |',
    '| `Journals\\<year>\\<month>` | One JSON document per journal entry |',
    '| `Periods` | One JSON document per fiscal period |',
    '| `Reports` | Derived extracts, refreshed with the projection |',
    '',
  ].join('\n');
}

function accountEntries(rows: readonly DatasetRow[]): readonly ProjectedEntry[] {
  return rows.map((row) => {
    const type = safeName((asString(row.account_type) ?? 'OTHER').toUpperCase(), 'OTHER');
    const code = safeName(asString(row.code) ?? '0000', '0000');
    const name = safeName(asString(row.name) ?? 'Account', 'Account');
    return {
      path: `Accounts\\${type}\\${code} - ${name}.json`,
      contentType: 'application/json' as const,
      content: `${JSON.stringify(row, null, 2)}\n`,
    };
  });
}

function journalEntries(rows: readonly DatasetRow[]): readonly ProjectedEntry[] {
  return rows.map((row) => {
    const date = asString(row.entry_date) ?? '0000-00-00';
    const year = safeName(date.slice(0, 4), '0000');
    const month = safeName(date.slice(5, 7), '00');
    const reference = safeName(asString(row.reference) ?? asString(row.id) ?? 'entry', 'entry');
    return {
      path: `Journals\\${year}\\${month}\\${reference}.json`,
      contentType: 'application/vnd.financeos.journal' as const,
      content: `${JSON.stringify(row, null, 2)}\n`,
    };
  });
}

function periodEntries(rows: readonly DatasetRow[]): readonly ProjectedEntry[] {
  return rows.map((row) => ({
    path: `Periods\\${safeName(asString(row.label) ?? asString(row.id) ?? 'period', 'period')}.json`,
    contentType: 'application/json' as const,
    content: `${JSON.stringify(row, null, 2)}\n`,
  }));
}

function trialBalanceCsv(rows: readonly DatasetRow[]): string {
  const header = 'code,name,account_type,currency,debit,credit,balance,lines';
  const body = rows.map((row) =>
    [
      csvCell(row.code),
      csvCell(row.name),
      csvCell(row.account_type),
      csvCell(row.currency_code),
      (asNumber(row.debit) ?? 0).toFixed(2),
      (asNumber(row.credit) ?? 0).toFixed(2),
      (asNumber(row.balance) ?? 0).toFixed(2),
      csvCell(row.line_count),
    ].join(','),
  );
  return `${[header, ...body].join('\n')}\n`;
}

/* ------------------------------------------------------------------ *
 * FinanceOS.Diagnostics — performance history and pressure alerts
 * ------------------------------------------------------------------ */

function diagnostics(): ServiceDefinition {
  const log: string[] = [];
  let pressureReported = false;

  return {
    name: SERVICE_NAMES.diagnostics,
    display: text('التشخيصات', 'Diagnostics', 'Diagnostics'),
    description: text(
      'يسجّل أداء النظام في X:\\Windows\\Temp وينبّه عند ارتفاع استخدام الذاكرة.',
      "Enregistre les performances système dans X:\\Windows\\Temp et alerte en cas de pression mémoire.",
      'Records system performance to X:\\Windows\\Temp and warns when memory pressure is high.',
    ),
    startType: 'automatic',
    capabilities: ['process.enumerate', 'fs.write', 'notify'],
    intervalMs: 15_000,

    start(ctx) {
      ctx.vfs.mkdir('X:\\Windows\\Temp', true);
    },

    async tick(ctx) {
      const metrics = await ctx.invoke('system.metrics', {});
      if (!metrics.ok) return;
      const snapshot = metrics.value;

      log.push(
        JSON.stringify({
          at: snapshot.sampledAt,
          uptimeMs: Math.round(snapshot.uptimeMs),
          cpu: snapshot.cpuPercent,
          memory: snapshot.memoryBytes,
          processes: snapshot.processCount,
          handles: snapshot.handleCount,
          tickRate: snapshot.tickRate,
          syscallRate: snapshot.syscallRate,
        }),
      );
      if (log.length > PERF_HISTORY) log.splice(0, log.length - PERF_HISTORY);

      const written = ctx.vfs.writeText(PERF_LOG_PATH, `${log.join('\n')}\n`, 'text/plain', false);
      if (written.ok) ctx.noteWork();

      const pressure = snapshot.memoryBytes / Math.max(1, snapshot.memoryLimitBytes);
      if (pressure >= MEMORY_PRESSURE && !pressureReported) {
        pressureReported = true;
        ctx.log.write(
          'System',
          'warning',
          EVENT_IDS.quotaExceeded,
          'Diagnostics',
          'Memory pressure is high; consider closing windows',
          { usedBytes: snapshot.memoryBytes, limitBytes: snapshot.memoryLimitBytes, processes: snapshot.processCount },
          ctx.pid,
        );
        ctx.bus.publish(ctx.pid, IPC_CHANNELS.health, { level: 'degraded', reason: 'memory' });
        await notify(
          ctx,
          'warning',
          'Memory pressure',
          `The desktop is using ${Math.round(pressure * 100)}% of its memory budget across ${snapshot.processCount} processes.`,
          APP_IDS.taskManager,
        );
      } else if (pressure < MEMORY_PRESSURE * 0.9 && pressureReported) {
        // Hysteresis: recovery is only announced once the reading is clearly back.
        pressureReported = false;
        ctx.bus.publish(ctx.pid, IPC_CHANNELS.health, { level: 'healthy', reason: 'memory' });
      }
    },

    stop(ctx) {
      ctx.vfs.remove(PERF_LOG_PATH, false);
    },
  };
}

/* ------------------------------------------------------------------ *
 * FinanceOS.PeriodGuard — watches the fiscal calendar
 * ------------------------------------------------------------------ */

function periodGuard(): ServiceDefinition {
  return {
    name: SERVICE_NAMES.periodGuard,
    display: text('حامي الفترات', 'Gardien des périodes', 'Period Guard'),
    description: text(
      'يراقب الفترات المالية والقيود المسوّدة والتسويات البنكية المعلّقة.',
      'Surveille les périodes fiscales, les écritures brouillon et les rapprochements en attente.',
      'Watches fiscal periods, draft journals and outstanding bank reconciliations.',
    ),
    startType: 'automaticDelayed',
    dependsOn: [SERVICE_NAMES.ledgerSync],
    capabilities: ['ledger.read', 'notify'],
    intervalMs: 300_000,

    async tick(ctx) {
      const today = new Date(ctx.clock.now()).toISOString().slice(0, 10);

      const periods = await read(ctx, 'fiscalPeriods', { limit: 100 });
      if (periods !== null) {
        ctx.noteWork();
        const overdue = periods.rows.filter((row) => {
          const status = (asString(row.status) ?? '').toUpperCase();
          const end = asString(row.end_date) ?? '';
          return status === 'OPEN' && end !== '' && end < today;
        });

        for (const period of overdue) {
          const id = asString(period.id) ?? '';
          const key = `PeriodOverdue:${id}`;
          if (id === '' || marker(ctx, key) !== '') continue;
          setMarker(ctx, key, ctx.clock.iso());
          const label = asString(period.label) ?? asString(period.end_date) ?? 'period';
          ctx.bus.publish(ctx.pid, IPC_CHANNELS.periodChanged, { period: id, action: 'overdue' });
          await notify(
            ctx,
            'warning',
            'Period ready to close',
            `${label} ended on ${asString(period.end_date) ?? 'an earlier date'} and is still open.`,
            APP_IDS.close,
          );
          ctx.noteWork();
        }
      }

      const drafts = await read(ctx, 'journalEntries', { limit: 300, where: { status: 'DRAFT' } });
      if (drafts !== null) {
        ctx.noteWork();
        const cutoff = new Date(ctx.clock.now() - STALE_DRAFT_DAYS * 86_400_000).toISOString().slice(0, 10);
        const stale = drafts.rows.filter((row) => (asString(row.entry_date) ?? today) < cutoff);
        const key = 'StaleDrafts';
        if (stale.length > 0 && marker(ctx, key) !== String(stale.length)) {
          setMarker(ctx, key, String(stale.length));
          await notify(
            ctx,
            'info',
            'Unposted journals',
            `${stale.length} draft ${stale.length === 1 ? 'entry is' : 'entries are'} older than ${STALE_DRAFT_DAYS} days.`,
            APP_IDS.journal,
          );
          ctx.noteWork();
        } else if (stale.length === 0) {
          setMarker(ctx, key, '');
        }
      }

      const unmatched = await read(ctx, 'bankTransactions', { limit: 300, where: { status: 'UNMATCHED' } });
      if (unmatched !== null) {
        ctx.noteWork();
        const count = unmatched.rows.length;
        const key = 'UnmatchedBank';
        if (count >= UNMATCHED_ALERT && marker(ctx, key) !== String(count)) {
          setMarker(ctx, key, String(count));
          await notify(
            ctx,
            'info',
            'Reconciliation pending',
            `${count} bank transactions have no ledger match yet.`,
            APP_IDS.reconcile,
          );
          ctx.noteWork();
        } else if (count < UNMATCHED_ALERT) {
          setMarker(ctx, key, '');
        }
      }

      ctx.registry.set(STATE_KEY, 'PeriodGuardAt', ctx.clock.iso());
    },
  };
}

/* ------------------------------------------------------------------ *
 * FinanceOS.SearchIndexer — file index for Explorer and Start
 * ------------------------------------------------------------------ */

interface IndexRow {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly contentType: string;
  readonly volume: string;
  readonly modifiedAt: string;
  readonly size: number;
}

function searchIndexer(): ServiceDefinition {
  let lastCount = -1;

  return {
    name: SERVICE_NAMES.searchIndexer,
    display: text('فهرسة البحث', 'Indexation de la recherche', 'Search Indexer'),
    description: text(
      'يفهرس الملفات على جميع الأقراص حتى يكون البحث في المستكشف وقائمة ابدأ فوريًا.',
      'Indexe les fichiers de tous les volumes pour que la recherche dans l’Explorateur et le menu Démarrer soit instantanée.',
      'Indexes files across every volume so Explorer and Start search resolve instantly.',
    ),
    startType: 'automaticDelayed',
    capabilities: ['fs.read', 'fs.write'],
    intervalMs: 60_000,

    start(ctx) {
      ctx.vfs.mkdir('X:\\Windows\\Search', true);
    },

    async tick(ctx) {
      const volumes = await ctx.invoke('fs.volumes', {});
      if (!volumes.ok) return;

      const index: IndexRow[] = [];
      for (const volume of volumes.value) {
        // The index itself lives on `X:`; indexing it would be circular.
        if (volume.letter.toUpperCase() === 'X') continue;
        walk(ctx, `${volume.letter.toUpperCase()}:\\`, 0, index);
        ctx.noteWork();
      }

      if (index.length === lastCount) return;
      lastCount = index.length;

      const written = ctx.vfs.writeText(
        SEARCH_INDEX_PATH,
        `${JSON.stringify({ builtAt: ctx.clock.iso(), count: index.length, entries: index }, null, 0)}\n`,
        'application/json',
        false,
      );
      if (!written.ok) {
        ctx.log.write('System', 'warning', EVENT_IDS.quotaExceeded, 'Search', 'Could not write the search index', {
          error: written.error.message,
        }, ctx.pid);
        return;
      }
      ctx.registry.set(STATE_KEY, 'SearchIndexAt', ctx.clock.iso());
      ctx.registry.set(STATE_KEY, 'SearchIndexCount', index.length);
      ctx.noteWork(index.length);
    },

    stop(ctx) {
      ctx.vfs.remove(SEARCH_INDEX_PATH, false);
    },
  };
}

function walk(ctx: ServiceContext, path: string, depth: number, into: IndexRow[]): void {
  if (depth > SEARCH_MAX_DEPTH || into.length >= SEARCH_INDEX_LIMIT) return;
  const listing = ctx.vfs.list(path, true);
  if (!listing.ok) return;

  for (const stat of listing.value) {
    if (into.length >= SEARCH_INDEX_LIMIT) return;
    into.push({
      path: stat.path,
      name: stat.name,
      kind: stat.kind,
      contentType: stat.contentType,
      volume: stat.volume,
      modifiedAt: stat.modifiedAt,
      size: stat.size,
    });
    if (stat.kind === 'directory') walk(ctx, stat.path, depth + 1, into);
  }
}

/* ------------------------------------------------------------------ *
 * FinanceOS.Backup — snapshots the persistent volume
 * ------------------------------------------------------------------ */

function backup(deps: SystemServiceDeps): ServiceDefinition {
  const backupFolder = join(deps.userFolder, 'Documents', 'Backups');
  let lastDigest = '';

  return {
    name: SERVICE_NAMES.backup,
    display: text('النسخ الاحتياطي', 'Sauvegarde', 'Backup'),
    description: text(
      'يأخذ نسخة من ملفات المستخدم وإعداداته عند تغيّرها ويحتفظ بآخر خمس نسخ.',
      'Sauvegarde les fichiers et préférences de l’utilisateur lorsqu’ils changent et conserve les cinq dernières copies.',
      'Snapshots the user profile and preferences whenever they change, keeping the last five copies.',
    ),
    startType: 'manual',
    capabilities: ['fs.read', 'fs.write', 'registry.read'],
    intervalMs: 300_000,

    start(ctx) {
      ctx.vfs.mkdir(backupFolder, true);
    },

    tick(ctx) {
      const files: IndexRow[] = [];
      walk(ctx, deps.userFolder, 0, files);

      // The backup folder is excluded, otherwise each snapshot would change the
      // digest and the service would back up its own output forever.
      const tracked = files
        .filter((file) => !file.path.toLowerCase().startsWith(backupFolder.toLowerCase()))
        .sort((a, b) => a.path.localeCompare(b.path));

      const digest = tracked.map((file) => `${file.path}|${file.size}|${file.modifiedAt}`).join('\n');
      if (digest === lastDigest) return;

      const contents = tracked
        .filter((file) => file.kind === 'file')
        .map((file) => {
          const read = ctx.vfs.readText(file.path);
          return { path: file.path, contentType: file.contentType, content: read.ok ? read.value.content : null };
        });

      const preferences = [REG.userAppearance, REG.userDesktop, REG.userTaskbar, REG.userStart].flatMap((key) =>
        ctx.registry.enumValues(key).map((entry) => ({ key: entry.key, name: entry.name, value: entry.value })),
      );

      const stamp = ctx.clock.iso().replace(/[:.]/g, '-');
      const target = join(backupFolder, `snapshot-${stamp}.json`);
      const written = ctx.vfs.writeText(
        target,
        `${JSON.stringify({ createdAt: ctx.clock.iso(), files: contents, preferences }, null, 2)}\n`,
        'application/json',
        false,
      );
      if (!written.ok) {
        ctx.log.write('System', 'warning', EVENT_IDS.quotaExceeded, 'Backup', 'Snapshot could not be written', {
          error: written.error.message,
          path: target,
        }, ctx.pid);
        return;
      }

      lastDigest = digest;
      ctx.noteWork(contents.length);
      ctx.registry.set(STATE_KEY, 'BackupAt', ctx.clock.iso());
      ctx.registry.set(STATE_KEY, 'BackupPath', target);
      prune(ctx, backupFolder);
      ctx.bus.publish(ctx.pid, IPC_CHANNELS.fileChanged, { path: target, kind: 'created' });
    },
  };
}

function prune(ctx: ServiceContext, folder: string): void {
  const listing = ctx.vfs.list(folder, false);
  if (!listing.ok) return;
  const snapshots = listing.value
    .filter((stat) => stat.kind === 'file' && stat.name.startsWith('snapshot-'))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const stale of snapshots.slice(BACKUP_RETENTION)) ctx.vfs.remove(stale.path, false);
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/** Every service the OS image ships with, in registration order. */
export function createSystemServices(deps: SystemServiceDeps): readonly ServiceDefinition[] {
  return [ledgerSync(), ledgerIndexer(deps), diagnostics(), periodGuard(), searchIndexer(), backup(deps)];
}
