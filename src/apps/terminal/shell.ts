/**
 * Terminal — the shell itself.
 *
 * Deliberately not a simulation. Every command below is one or more syscalls, so
 * `dir` prints exactly what `fs.list` returned and `kill` fails with
 * `ELEVATION_REQUIRED` when the dispatcher says it should. The command table is
 * data, which is what lets `help` and Tab completion stay truthful instead of
 * being a second list that drifts away from the first.
 */
import {
  APP_IDS,
  type AbiResult,
  type AppId,
  type AppLang,
  CAPABILITIES,
  DATASETS,
  type EventChannel,
  type EventLevel,
  type Localized,
  type Pid,
  type RegistryValue,
  type ServiceStartType,
  type SyscallName,
  type SyscallRequest,
  type SyscallResponse,
  fmt,
} from '@/platform/sdk';
import { dirname, join } from '../shared/paths';

export type LineKind = 'input' | 'output' | 'error' | 'note' | 'ok';

export interface TerminalLine {
  readonly id: number;
  readonly kind: LineKind;
  readonly text: string;
}

export type Tr = (ar: string, fr: string, en: string) => string;

/** What a command is allowed to do. Anything else needs a new syscall. */
export interface ShellHost {
  readonly cwd: string;
  readonly lang: AppLang;
  readonly history: readonly string[];
  invoke<K extends SyscallName>(name: K, request: SyscallRequest<K>): Promise<AbiResult<SyscallResponse<K>>>;
  print: (text: string, kind?: LineKind) => void;
  clear: () => void;
  chdir: (path: string) => void;
  exit: () => void;
  tr: Tr;
  t: (label: Localized) => string;
}

export interface ShellCommand {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly usage: string;
  readonly summary: (tr: Tr) => string;
  readonly run: (argv: readonly string[], host: ShellHost) => Promise<void>;
}

/* ------------------------------------------------------------------ *
 * plumbing
 * ------------------------------------------------------------------ */

/**
 * `..\Documents`, `\Windows`, `D:` and `notes.txt` all mean something different
 * relative to a working directory; this is the one place that knows which.
 */
export function resolvePath(cwd: string, arg: string): string {
  const raw = arg.replace(/\//g, '\\').trim().replace(/^"|"$/g, '');
  if (raw === '' || raw === '.') return cwd;
  let out: string;
  let rest: string;
  if (/^[A-Za-z]:/.test(raw)) {
    out = `${raw[0].toUpperCase()}:\\`;
    rest = raw.slice(2);
  } else if (raw.startsWith('\\')) {
    out = `${cwd.slice(0, 1).toUpperCase()}:\\`;
    rest = raw;
  } else {
    out = cwd;
    rest = raw;
  }
  for (const segment of rest.split('\\')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out = dirname(out);
    else out = join(out, segment);
  }
  return out;
}

/** Splits a line into words, honouring double quotes so paths with spaces work. */
export function tokenize(line: string): readonly string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (/\s/.test(char) && !quoted) {
      if (current !== '') out.push(current);
      current = '';
    } else current += char;
  }
  if (current !== '') out.push(current);
  return out;
}

/** `/n:20` → `'20'`; a bare `/f` → `''`; absent → `null`. */
function flag(argv: readonly string[], name: string): string | null {
  const prefix = `/${name}`;
  for (const token of argv) {
    const lower = token.toLowerCase();
    if (lower === prefix) return '';
    if (lower.startsWith(`${prefix}:`)) return token.slice(prefix.length + 1);
  }
  return null;
}

const operands = (argv: readonly string[]): readonly string[] => argv.filter((token) => !token.startsWith('/'));

function count(argv: readonly string[], fallback: number): number {
  const raw = flag(argv, 'n');
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Fixed-width table. Monospace output is the whole reason a terminal reads well. */
function table(host: ShellHost, headers: readonly string[], rows: readonly (readonly string[])[], right: readonly number[] = []): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => (right.includes(index) ? cell.padStart(widths[index]) : cell.padEnd(widths[index])))
      .join('  ')
      .trimEnd();
  host.print(line(headers), 'note');
  host.print(widths.map((width) => '─'.repeat(width)).join('  '), 'note');
  for (const row of rows) host.print(line(row));
}

/** Runs a syscall, printing the failure in error tone and returning null. */
async function call<K extends SyscallName>(
  host: ShellHost,
  name: K,
  request: SyscallRequest<K>,
): Promise<SyscallResponse<K> | null> {
  const result = await host.invoke(name, request);
  if (result.ok) return result.value;
  host.print(`${result.error.code}: ${result.error.message}`, 'error');
  return null;
}

const usageError = (host: ShellHost, usage: string): void =>
  host.print(host.tr(`الاستخدام: ${usage}`, `Utilisation : ${usage}`, `Usage: ${usage}`), 'error');

/* ------------------------------------------------------------------ *
 * commands
 * ------------------------------------------------------------------ */

const fsCommands: readonly ShellCommand[] = [
  {
    name: 'dir',
    aliases: ['ls'],
    usage: 'dir [path] [/a]',
    summary: (tr) => tr('يسرد محتويات مجلد', 'Liste le contenu d’un dossier', 'Lists the contents of a folder'),
    run: async (argv, host) => {
      const target = resolvePath(host.cwd, operands(argv)[0] ?? '.');
      const entries = await call(host, 'fs.list', { path: target, showHidden: flag(argv, 'a') !== null });
      if (entries === null) return;
      host.print(host.tr(`محتويات ${target}`, `Contenu de ${target}`, `Directory of ${target}`), 'note');
      if (entries.length === 0) {
        host.print(host.tr('  (فارغ)', '  (vide)', '  (empty)'));
        return;
      }
      table(
        host,
        [
          host.tr('عُدّل', 'Modifié', 'Modified'),
          host.tr('النوع', 'Type', 'Type'),
          host.tr('الحجم', 'Taille', 'Size'),
          host.tr('الاسم', 'Nom', 'Name'),
        ],
        entries.map((entry) => [
          fmt.dateTime(entry.modifiedAt, host.lang),
          entry.kind === 'directory' ? '<DIR>' : entry.contentType,
          entry.kind === 'directory' ? '' : String(entry.size),
          entry.hidden ? `${entry.name}  (h)` : entry.name,
        ]),
        [2],
      );
      const files = entries.filter((entry) => entry.kind === 'file');
      const bytes = files.reduce((sum, entry) => sum + entry.size, 0);
      host.print(
        host.tr(
          `  ${files.length} ملفًا، ${entries.length - files.length} مجلدًا، ${fmt.bytes(bytes, host.lang)}`,
          `  ${files.length} fichier(s), ${entries.length - files.length} dossier(s), ${fmt.bytes(bytes, host.lang)}`,
          `  ${files.length} file(s), ${entries.length - files.length} dir(s), ${fmt.bytes(bytes, host.lang)}`,
        ),
        'note',
      );
    },
  },
  {
    name: 'cd',
    aliases: ['chdir'],
    usage: 'cd <path>',
    summary: (tr) => tr('يغيّر المجلد الحالي', 'Change de dossier courant', 'Changes the working directory'),
    run: async (argv, host) => {
      const arg = operands(argv)[0];
      if (arg === undefined) {
        host.print(host.cwd);
        return;
      }
      const target = resolvePath(host.cwd, arg);
      const stat = await call(host, 'fs.stat', { path: target });
      if (stat === null) return;
      if (stat.kind !== 'directory') {
        host.print(host.tr('ليس مجلدًا', 'Ce n’est pas un dossier', 'Not a directory'), 'error');
        return;
      }
      host.chdir(stat.path);
    },
  },
  {
    name: 'type',
    aliases: ['cat'],
    usage: 'type <file>',
    summary: (tr) => tr('يعرض محتوى ملف نصي', 'Affiche le contenu d’un fichier', 'Prints the contents of a text file'),
    run: async (argv, host) => {
      const arg = operands(argv)[0];
      if (arg === undefined) return usageError(host, 'type <file>');
      const read = await call(host, 'fs.readText', { path: resolvePath(host.cwd, arg) });
      if (read === null) return;
      if (read.content === '') host.print(host.tr('(ملف فارغ)', '(fichier vide)', '(empty file)'), 'note');
      else for (const line of read.content.split('\n')) host.print(line);
    },
  },
  {
    name: 'mkdir',
    aliases: ['md'],
    usage: 'mkdir <path>',
    summary: (tr) => tr('ينشئ مجلدًا', 'Crée un dossier', 'Creates a folder'),
    run: async (argv, host) => {
      const arg = operands(argv)[0];
      if (arg === undefined) return usageError(host, 'mkdir <path>');
      const made = await call(host, 'fs.mkdir', { path: resolvePath(host.cwd, arg), recursive: true });
      if (made !== null) host.print(made.path, 'ok');
    },
  },
  {
    name: 'del',
    aliases: ['rm', 'erase'],
    usage: 'del <path> [/s]',
    summary: (tr) => tr('يحذف ملفًا أو مجلدًا', 'Supprime un fichier ou un dossier', 'Deletes a file or folder'),
    run: async (argv, host) => {
      const arg = operands(argv)[0];
      if (arg === undefined) return usageError(host, 'del <path> [/s]');
      const removed = await call(host, 'fs.remove', {
        path: resolvePath(host.cwd, arg),
        recursive: flag(argv, 's') !== null,
      });
      if (removed !== null) {
        host.print(host.tr(`حُذف ${removed.removed} عنصرًا`, `${removed.removed} élément(s) supprimé(s)`, `${removed.removed} item(s) deleted`), 'ok');
      }
    },
  },
  {
    name: 'move',
    aliases: ['ren', 'rename'],
    usage: 'move <from> <to>',
    summary: (tr) => tr('ينقل أو يعيد تسمية', 'Déplace ou renomme', 'Moves or renames'),
    run: async (argv, host) => {
      const [from, to] = operands(argv);
      if (from === undefined || to === undefined) return usageError(host, 'move <from> <to>');
      const moved = await call(host, 'fs.move', {
        from: resolvePath(host.cwd, from),
        to: resolvePath(host.cwd, to),
        overwrite: flag(argv, 'y') !== null,
      });
      if (moved !== null) host.print(moved.path, 'ok');
    },
  },
  {
    name: 'copy',
    aliases: ['cp'],
    usage: 'copy <from> <to>',
    summary: (tr) => tr('ينسخ ملفًا أو مجلدًا', 'Copie un fichier ou un dossier', 'Copies a file or folder'),
    run: async (argv, host) => {
      const [from, to] = operands(argv);
      if (from === undefined || to === undefined) return usageError(host, 'copy <from> <to>');
      const copied = await call(host, 'fs.copy', {
        from: resolvePath(host.cwd, from),
        to: resolvePath(host.cwd, to),
        overwrite: flag(argv, 'y') !== null,
      });
      if (copied !== null) host.print(copied.path, 'ok');
    },
  },
  {
    name: 'where',
    aliases: ['find'],
    usage: 'where <text> [/n:count]',
    summary: (tr) => tr('يبحث عن ملفات تحت المجلد الحالي', 'Recherche sous le dossier courant', 'Searches below the working directory'),
    run: async (argv, host) => {
      const text = operands(argv).join(' ');
      if (text === '') return usageError(host, 'where <text> [/n:count]');
      const found = await call(host, 'fs.search', { root: host.cwd, query: text, limit: count(argv, 100) });
      if (found === null) return;
      if (found.length === 0) host.print(host.tr('لا نتائج', 'Aucun résultat', 'No matches'), 'note');
      else for (const entry of found) host.print(entry.path);
    },
  },
  {
    name: 'vol',
    aliases: ['df'],
    usage: 'vol',
    summary: (tr) => tr('يسرد وحدات التخزين', 'Liste les volumes montés', 'Lists mounted volumes'),
    run: async (_argv, host) => {
      const volumes = await call(host, 'fs.volumes', {});
      if (volumes === null) return;
      table(
        host,
        ['', host.tr('التسمية', 'Étiquette', 'Label'), host.tr('النوع', 'Type', 'Kind'), host.tr('مستخدم', 'Utilisé', 'Used'), host.tr('الحصة', 'Quota', 'Quota'), '%'],
        volumes.map((volume) => [
          `${volume.letter}:`,
          `${host.t(volume.label)}${volume.readOnly ? ' (ro)' : ''}`,
          volume.kind,
          fmt.bytes(volume.usedBytes, host.lang),
          fmt.bytes(volume.quotaBytes, host.lang),
          `${Math.round((volume.usedBytes / Math.max(1, volume.quotaBytes)) * 100)}%`,
        ]),
        [3, 4, 5],
      );
    },
  },
];
const systemCommands: readonly ShellCommand[] = [
  {
    name: 'ps',
    aliases: ['tasklist'],
    usage: 'ps',
    summary: (tr) => tr('يسرد العمليات ومقاييسها', 'Liste les processus et leurs métriques', 'Lists processes with their metrics'),
    run: async (_argv, host) => {
      const processes = await call(host, 'process.list', {});
      if (processes === null) return;
      const metrics = (await call(host, 'process.metrics', {})) ?? [];
      const byPid = new Map(metrics.map((entry) => [String(entry.pid), entry]));
      table(
        host,
        ['PID', host.tr('الاسم', 'Nom', 'Name'), host.tr('الحالة', 'État', 'State'), 'CPU%', host.tr('الذاكرة', 'Mémoire', 'Memory'), 'H', host.tr('نداءات', 'Appels', 'Syscalls')],
        processes.map((process) => {
          const metric = byPid.get(String(process.pid));
          return [
            String(process.pid),
            `${host.t(process.name)}${process.elevated ? ' *' : ''}`,
            process.state,
            (metric?.cpuPercent ?? 0).toFixed(1),
            fmt.bytes(metric?.memoryBytes ?? 0, host.lang),
            String(process.handleCount),
            String(metric?.syscalls ?? 0),
          ];
        }),
        [0, 3, 4, 5, 6],
      );
    },
  },
  {
    name: 'kill',
    aliases: ['taskkill'],
    usage: 'kill <pid> [/f]',
    summary: (tr) => tr('ينهي عملية (يتطلب ترقية)', 'Termine un processus (élévation requise)', 'Terminates a process (needs elevation)'),
    run: async (argv, host) => {
      const raw = operands(argv)[0];
      if (raw === undefined) return usageError(host, 'kill <pid> [/f]');
      const pid = Number.parseInt(raw, 10);
      if (!Number.isFinite(pid)) {
        host.print(host.tr('معرّف عملية غير صالح', 'PID invalide', 'Not a valid pid'), 'error');
        return;
      }
      const done = await call(host, 'process.terminate', { pid: pid as Pid, force: flag(argv, 'f') !== null });
      if (done !== null) host.print(host.tr(`أُنهيت العملية ${pid}`, `Processus ${pid} terminé`, `Terminated ${pid}`), 'ok');
    },
  },
  {
    name: 'sc',
    usage: 'sc <list|start|stop|restart|config> [name] [startType]',
    summary: (tr) => tr('يتحكم في خدمات النظام', 'Contrôle les services système', 'Controls system services'),
    run: async (argv, host) => {
      const [verb = 'list', name, startType] = operands(argv);
      if (verb === 'list') {
        const services = await call(host, 'service.list', {});
        if (services === null) return;
        table(
          host,
          [host.tr('الاسم', 'Nom', 'Name'), host.tr('العرض', 'Affichage', 'Display'), host.tr('الحالة', 'État', 'State'), host.tr('البدء', 'Démarrage', 'Start'), 'PID', host.tr('عمل', 'Travail', 'Work')],
          services.map((service) => [
            service.name,
            host.t(service.display),
            service.lastError === null ? service.state : `${service.state} (!)`,
            service.startType,
            service.pid === null ? '—' : String(service.pid),
            String(service.workCompleted),
          ]),
          [4, 5],
        );
        return;
      }
      if (name === undefined) return usageError(host, 'sc <list|start|stop|restart|config> [name] [startType]');
      if (verb === 'config') {
        const types: readonly ServiceStartType[] = ['automatic', 'automaticDelayed', 'manual', 'disabled'];
        const chosen = types.find((candidate) => candidate.toLowerCase() === (startType ?? '').toLowerCase());
        if (chosen === undefined) {
          host.print(host.tr(`أنواع البدء: ${types.join(', ')}`, `Types : ${types.join(', ')}`, `Start types: ${types.join(', ')}`), 'error');
          return;
        }
        const set = await call(host, 'service.setStartType', { name, startType: chosen });
        if (set !== null) host.print(`${set.name}: ${set.startType}`, 'ok');
        return;
      }
      if (verb !== 'start' && verb !== 'stop' && verb !== 'restart') return usageError(host, 'sc <list|start|stop|restart|config> [name] [startType]');
      const info = await call(host, verb === 'start' ? 'service.start' : verb === 'stop' ? 'service.stop' : 'service.restart', { name });
      if (info !== null) host.print(`${info.name}: ${info.state}`, 'ok');
    },
  },
  {
    name: 'reg',
    usage: 'reg <query|add|delete> <key> [name] [value] [/multi]',
    summary: (tr) => tr('يقرأ ويكتب في سجل النظام', 'Lit et écrit dans le registre', 'Reads and writes the registry'),
    run: async (argv, host) => {
      const [verb, key, name, ...rest] = operands(argv);
      if (verb === undefined || key === undefined) return usageError(host, 'reg <query|add|delete> <key> [name] [value] [/multi]');
      if (verb === 'query') {
        const keys = (await call(host, 'registry.enumKeys', { key })) ?? [];
        for (const child of keys) host.print(`${key}\\${child}`, 'note');
        const values = await call(host, 'registry.enumValues', { key });
        if (values === null) return;
        if (values.length === 0 && keys.length === 0) host.print(host.tr('لا قيم', 'Aucune valeur', 'No values'), 'note');
        else if (values.length > 0) {
          table(
            host,
            [host.tr('الاسم', 'Nom', 'Name'), host.tr('النوع', 'Type', 'Type'), host.tr('القيمة', 'Valeur', 'Value')],
            values.map((entry) => [entry.name, registryType(entry.value), describeValue(entry.value)]),
          );
        }
        return;
      }
      if (verb === 'add') {
        if (name === undefined) return usageError(host, 'reg add <key> <name> <value>');
        const raw = rest.join(' ');
        const value: RegistryValue = flag(argv, 'multi') !== null ? raw.split(';') : parseRegistryValue(raw);
        const set = await call(host, 'registry.set', { key, name, value });
        if (set !== null) host.print(`${set.key}\\${set.name} = ${describeValue(set.value)}`, 'ok');
        return;
      }
      if (verb === 'delete') {
        const deleted = await call(host, 'registry.delete', name === undefined ? { key } : { key, name });
        if (deleted !== null) host.print(host.tr(`حُذف ${deleted.deleted}`, `${deleted.deleted} supprimé(s)`, `${deleted.deleted} deleted`), 'ok');
        return;
      }
      usageError(host, 'reg <query|add|delete> <key> [name] [value] [/multi]');
    },
  },
  {
    name: 'events',
    aliases: ['eventlog'],
    usage: 'events [/c:channel] [/l:level] [/s:text] [/n:count]',
    summary: (tr) => tr('يستعلم سجل الأحداث', 'Interroge le journal d’événements', 'Queries the event log'),
    run: async (argv, host) => {
      const channels: readonly EventChannel[] = ['System', 'Application', 'Security', 'Setup'];
      const levels: readonly EventLevel[] = ['critical', 'error', 'warning', 'information', 'verbose'];
      const channel = channels.find((candidate) => candidate.toLowerCase() === (flag(argv, 'c') ?? '').toLowerCase());
      const level = levels.find((candidate) => candidate === flag(argv, 'l'));
      const search = flag(argv, 's');
      const records = await call(host, 'eventlog.query', {
        ...(channel === undefined ? {} : { channel }),
        ...(level === undefined ? {} : { levels: [level] }),
        ...(search === null || search === '' ? {} : { search }),
        limit: count(argv, 40),
      });
      if (records === null) return;
      if (records.length === 0) {
        host.print(host.tr('لا أحداث مطابقة', 'Aucun événement', 'No matching events'), 'note');
        return;
      }
      table(
        host,
        ['ID', host.tr('الوقت', 'Heure', 'Time'), host.tr('القناة', 'Canal', 'Channel'), host.tr('المستوى', 'Niveau', 'Level'), host.tr('المصدر', 'Source', 'Source'), host.tr('الرسالة', 'Message', 'Message')],
        records.map((record) => [
          String(record.eventId),
          fmt.time(record.at, host.lang),
          record.channel,
          record.level,
          record.source,
          record.message,
        ]),
        [0],
      );
    },
  },
];
/* ---- registry value plumbing ------------------------------------- */

function registryType(value: RegistryValue): string {
  if (value === null) return 'NONE';
  if (Array.isArray(value)) return 'MULTI_SZ';
  if (typeof value === 'number') return 'DWORD';
  if (typeof value === 'boolean') return 'BOOL';
  return 'SZ';
}

function describeValue(value: RegistryValue): string {
  if (value === null) return '(null)';
  if (Array.isArray(value)) return value.join('; ');
  return String(value);
}

/** `42` → number, `true` → boolean, everything else stays a string. */
function parseRegistryValue(raw: string): RegistryValue {
  const text = raw.trim();
  if (text === '') return '';
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

const dataCommands: readonly ShellCommand[] = [
  {
    name: 'query',
    usage: 'query <dataset> [/n:count] [/o:column]',
    summary: (tr) => tr('يستعلم مجموعة بيانات عبر الوسيط', 'Interroge un jeu de données via le courtier', 'Queries a dataset through the broker'),
    run: async (argv, host) => {
      const name = operands(argv)[0];
      const dataset = DATASETS.find((candidate) => candidate === name);
      if (dataset === undefined) {
        host.print(host.tr('مجموعات البيانات:', 'Jeux de données :', 'Datasets:'), 'note');
        for (const candidate of DATASETS) host.print(`  ${candidate}`);
        return;
      }
      const order = flag(argv, 'o');
      const page = await call(host, 'data.query', {
        dataset,
        limit: count(argv, 20),
        ...(order === null || order === '' ? {} : { orderBy: { column: order, ascending: false } }),
      });
      if (page === null) return;
      if (page.rows.length === 0) {
        host.print(host.tr('لا صفوف', 'Aucune ligne', 'No rows'), 'note');
        return;
      }
      const columns = Object.keys(page.rows[0]).slice(0, 7);
      table(
        host,
        columns,
        page.rows.map((row) => columns.map((column) => cell(row[column]))),
      );
      host.print(
        host.tr(
          `  ${page.rows.length} صفًا، ${fmt.bytes(page.bytes, host.lang)}${page.fromCache ? '، من الذاكرة المؤقتة' : ''}`,
          `  ${page.rows.length} ligne(s), ${fmt.bytes(page.bytes, host.lang)}${page.fromCache ? ', depuis le cache' : ''}`,
          `  ${page.rows.length} row(s), ${fmt.bytes(page.bytes, host.lang)}${page.fromCache ? ', from cache' : ''}`,
        ),
        'note',
      );
    },
  },
  {
    name: 'whoami',
    usage: 'whoami [/all]',
    summary: (tr) => tr('يعرض المستخدم وصلاحياته', 'Affiche l’utilisateur et ses droits', 'Shows the signed-in principal'),
    run: async (argv, host) => {
      const principal = await call(host, 'security.principal', {});
      if (principal === null) return;
      host.print(`${principal.displayName}  (${principal.sid as string})`);
      host.print(`${host.tr('الأدوار', 'Rôles', 'Roles')}: ${principal.roles.join(', ') || '—'}`);
      host.print(
        `${host.tr('مرقّى', 'Élevé', 'Elevated')}: ${principal.elevated ? host.tr('نعم', 'oui', 'yes') : host.tr('لا', 'non', 'no')}${
          principal.elevationExpiresAt === null ? '' : ` → ${fmt.time(principal.elevationExpiresAt, host.lang)}`
        }`,
      );
      if (flag(argv, 'all') !== null) {
        host.print(host.tr('الصلاحيات:', 'Capacités :', 'Capabilities:'), 'note');
        for (const capability of principal.capabilities) host.print(`  ${capability}`);
      }
    },
  },
  {
    name: 'elevate',
    usage: 'elevate <capability>',
    summary: (tr) => tr('يطلب ترقية مؤقتة لصلاحية', 'Demande une élévation temporaire', 'Requests a time-limited elevation'),
    run: async (argv, host) => {
      const raw = operands(argv)[0];
      const capability = CAPABILITIES.find((candidate) => candidate === raw);
      if (capability === undefined) {
        host.print(host.tr('الصلاحيات المتاحة:', 'Capacités :', 'Capabilities:'), 'note');
        for (const candidate of CAPABILITIES) host.print(`  ${candidate}`);
        return;
      }
      const granted = await call(host, 'security.elevate', {
        capability,
        reason: {
          ar: `الطرفية تطلب ${capability}`,
          fr: `Le terminal demande ${capability}`,
          en: `Terminal requests ${capability}`,
        },
      });
      if (granted === null) return;
      if (granted.granted) {
        host.print(
          host.tr(
            `تمت الترقية حتى ${granted.expiresAt ?? ''}`,
            `Élévation accordée jusqu’à ${granted.expiresAt ?? ''}`,
            `Elevated until ${granted.expiresAt ?? ''}`,
          ),
          'ok',
        );
      } else host.print(host.tr('رُفضت الترقية', 'Élévation refusée', 'Elevation denied'), 'error');
    },
  },
  {
    name: 'stat',
    aliases: ['uptime'],
    usage: 'stat',
    summary: (tr) => tr('مقاييس النظام الحالية', 'Métriques système actuelles', 'Current system metrics'),
    run: async (_argv, host) => {
      const metrics = await call(host, 'system.metrics', {});
      if (metrics === null) return;
      const rows: readonly (readonly [string, string])[] = [
        [host.tr('مدة التشغيل', 'Disponibilité', 'Uptime'), fmt.duration(metrics.uptimeMs, host.lang)],
        ['CPU', `${metrics.cpuPercent.toFixed(1)}%`],
        [
          host.tr('الذاكرة', 'Mémoire', 'Memory'),
          `${fmt.bytes(metrics.memoryBytes, host.lang)} / ${fmt.bytes(metrics.memoryLimitBytes, host.lang)}`,
        ],
        [host.tr('العمليات', 'Processus', 'Processes'), String(metrics.processCount)],
        [host.tr('الخيوط', 'Threads', 'Threads'), String(metrics.threadCount)],
        [host.tr('المقابض', 'Handles', 'Handles'), String(metrics.handleCount)],
        [host.tr('نبضات/ث', 'Ticks/s', 'Ticks/s'), metrics.tickRate.toFixed(1)],
        [host.tr('نداءات/ث', 'Appels/s', 'Syscalls/s'), metrics.syscallRate.toFixed(1)],
      ];
      for (const [label, value] of rows) host.print(`${label.padEnd(14)} ${value}`);
    },
  },
];
/** Broker rows are `unknown` by contract; print them without pretending. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}

const shellCommands: readonly ShellCommand[] = [
  {
    name: 'help',
    aliases: ['?'],
    usage: 'help [command]',
    summary: (tr) => tr('يعرض هذه القائمة', 'Affiche cette liste', 'Shows this list'),
    run: async (argv, host) => {
      const wanted = operands(argv)[0];
      if (wanted !== undefined) {
        const command = findCommand(wanted);
        if (command === null) {
          host.print(host.tr(`أمر غير معروف: ${wanted}`, `Commande inconnue : ${wanted}`, `Unknown command: ${wanted}`), 'error');
          return;
        }
        host.print(command.usage, 'note');
        host.print(command.summary(host.tr));
        if (command.aliases !== undefined) {
          host.print(`${host.tr('مرادفات', 'Alias', 'Aliases')}: ${command.aliases.join(', ')}`, 'note');
        }
        return;
      }
      table(
        host,
        [host.tr('الأمر', 'Commande', 'Command'), host.tr('الوصف', 'Description', 'Description')],
        COMMANDS.map((command) => [command.name, command.summary(host.tr)]),
      );
      host.print(
        host.tr(
          'يمكن توجيه المخرجات إلى ملف: dir > list.txt',
          'La sortie peut être redirigée : dir > liste.txt',
          'Output can be redirected: dir > list.txt',
        ),
        'note',
      );
    },
  },
  {
    name: 'cls',
    aliases: ['clear'],
    usage: 'cls',
    summary: (tr) => tr('يمسح الشاشة', 'Efface l’écran', 'Clears the screen'),
    run: async (_argv, host) => host.clear(),
  },
  {
    name: 'echo',
    usage: 'echo <text>',
    summary: (tr) => tr('يكتب نصًا', 'Écrit du texte', 'Writes text'),
    run: async (argv, host) => host.print(argv.join(' ')),
  },
  {
    name: 'pwd',
    usage: 'pwd',
    summary: (tr) => tr('يطبع المجلد الحالي', 'Affiche le dossier courant', 'Prints the working directory'),
    run: async (_argv, host) => host.print(host.cwd),
  },
  {
    name: 'start',
    aliases: ['run'],
    usage: 'start <app> [path]',
    summary: (tr) => tr('يشغّل تطبيقًا', 'Lance une application', 'Launches an application'),
    run: async (argv, host) => {
      const [name, path] = operands(argv);
      const known = Object.entries(APP_IDS) as readonly (readonly [string, AppId])[];
      const match = known.find(([key, id]) => key.toLowerCase() === (name ?? '').toLowerCase() || (id as string) === name);
      if (match === undefined) {
        host.print(host.tr('التطبيقات:', 'Applications :', 'Applications:'), 'note');
        for (const [key, id] of known) host.print(`  ${key.padEnd(16)} ${id as string}`);
        return;
      }
      const launched = await call(host, 'shell.launch', {
        appId: match[1],
        ...(path === undefined ? {} : { args: { path: resolvePath(host.cwd, path) } }),
      });
      if (launched !== null) host.print(host.tr(`العملية ${launched.pid}`, `Processus ${launched.pid}`, `Process ${launched.pid}`), 'ok');
    },
  },
  {
    name: 'open',
    usage: 'open <path>',
    summary: (tr) => tr('يفتح ملفًا بتطبيقه المرتبط', 'Ouvre un fichier avec son application', 'Opens a path with its associated app'),
    run: async (argv, host) => {
      const arg = operands(argv)[0];
      if (arg === undefined) return usageError(host, 'open <path>');
      const opened = await call(host, 'shell.openPath', { path: resolvePath(host.cwd, arg) });
      if (opened === null) return;
      if (opened.pid === null) host.print(host.tr('لا تطبيق مرتبط', 'Aucune application associée', 'No associated application'), 'error');
      else host.print(host.tr(`العملية ${opened.pid}`, `Processus ${opened.pid}`, `Process ${opened.pid}`), 'ok');
    },
  },
  {
    name: 'clip',
    usage: 'clip <text>',
    summary: (tr) => tr('ينسخ نصًا إلى الحافظة', 'Copie du texte dans le presse-papiers', 'Copies text to the clipboard'),
    run: async (argv, host) => {
      const text = argv.join(' ');
      if (text === '') return usageError(host, 'clip <text>');
      const written = await call(host, 'shell.clipboardWrite', { text });
      if (written !== null) host.print(host.tr('نُسخ', 'Copié', 'Copied'), 'ok');
    },
  },
  {
    name: 'history',
    usage: 'history',
    summary: (tr) => tr('يعرض الأوامر السابقة', 'Affiche les commandes précédentes', 'Shows previous commands'),
    run: async (_argv, host) => {
      if (host.history.length === 0) {
        host.print(host.tr('لا سجل', 'Aucun historique', 'No history'), 'note');
        return;
      }
      host.history.forEach((entry, index) => host.print(`${String(index + 1).padStart(3)}  ${entry}`));
    },
  },
  {
    name: 'exit',
    aliases: ['quit'],
    usage: 'exit',
    summary: (tr) => tr('يغلق الطرفية', 'Ferme le terminal', 'Closes the terminal'),
    run: async (_argv, host) => host.exit(),
  },
];

export const COMMANDS: readonly ShellCommand[] = [...fsCommands, ...systemCommands, ...dataCommands, ...shellCommands];

export function findCommand(name: string): ShellCommand | null {
  const lower = name.toLowerCase();
  return (
    COMMANDS.find((command) => command.name === lower || (command.aliases ?? []).includes(lower)) ?? null
  );
}

/** Command names and aliases, for Tab completion of the first word. */
export function completions(prefix: string): readonly string[] {
  const lower = prefix.toLowerCase();
  const names = COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
  return names.filter((name) => name.startsWith(lower)).sort();
}

/**
 * Runs one command line. Output redirection is handled here rather than in each
 * command: the printer is swapped for a collector, so `ps > procs.txt` works for
 * every command that prints, present and future.
 */
export async function runCommandLine(line: string, host: ShellHost): Promise<void> {
  const trimmed = line.trim();
  if (trimmed === '') return;

  const redirect = /\s(>>?)\s*("[^"]+"|\S+)\s*$/.exec(trimmed);
  const body = redirect === null ? trimmed : trimmed.slice(0, redirect.index);
  const tokens = tokenize(body);
  const [name, ...argv] = tokens;
  if (name === undefined) return;

  const command = findCommand(name);
  if (command === null) {
    host.print(
      host.tr(
        `'${name}' ليس أمرًا معروفًا. اكتب help.`,
        `« ${name} » n’est pas une commande. Tapez help.`,
        `'${name}' is not a known command. Type help.`,
      ),
      'error',
    );
    return;
  }

  if (redirect === null) {
    await command.run(argv, host);
    return;
  }

  const collected: string[] = [];
  const collector: ShellHost = { ...host, print: (text) => collected.push(text) };
  await command.run(argv, collector);
  const target = resolvePath(host.cwd, redirect[2]);
  const append = redirect[1] === '>>';
  let content = collected.join('\n');
  if (append) {
    const existing = await host.invoke('fs.readText', { path: target });
    if (existing.ok) content = `${existing.value.content}\n${content}`;
  }
  const written = await call(host, 'fs.writeText', { path: target, content });
  if (written !== null) {
    host.print(
      host.tr(
        `كُتب ${collected.length} سطرًا إلى ${target}`,
        `${collected.length} ligne(s) écrite(s) dans ${target}`,
        `${collected.length} line(s) written to ${target}`,
      ),
      'ok',
    );
  }
}
