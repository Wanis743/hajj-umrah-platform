/**
 * File Explorer.
 *
 * The whole app is a view over `fs.*`. It holds no copy of the tree: every list
 * is what `fs.list` last returned, every mutation is a syscall, and the file-change
 * channel is what tells it to look again — so a file created by Notepad, by the
 * Backup service or by another Explorer window appears here without anyone
 * arranging it.
 *
 * What the boundary costs, and why it is worth it: Explorer cannot see the VFS
 * data structures, so it cannot show a folder's recursive size without walking it.
 * It therefore shows what it actually knows — the child count — instead of a
 * plausible-looking number.
 *
 * The markup lives in `chrome.tsx`. What is left here is the state, the four
 * columns, and every syscall Explorer makes.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type AppEntryProps,
  AppFrame,
  type AppLocale,
  type Column,
  IPC_CHANNELS,
  TreeView,
  type VfsStat,
  fmt,
  useAppCommands,
  useContextMenu,
  useDirectory,
  useIpc,
  usePolledSyscall,
  useSetting,
  useWindowTitle,
} from '@/platform/sdk';
import { contentTypeForName, typeLabel } from '../shared/fileIcons';
import { DOCUMENTS, HOME, REPORTS, ancestry, basename, dirname, isValidName, join, uniqueName } from '../shared/paths';
import { buildTree, useCapacity, useHistory, useInitialExpansion } from './navigation';
import { DetailsPane, EntryMenu, ExplorerCommands, ExplorerStatus, Listing, NameCell, NameDialog } from './chrome';

/** Volumes change only when one is mounted or fills up; a slow poll is honest. */
const VOLUME_POLL_MS = 4000;

/** The one edit a name dialog is open for. */
type Pending =
  | { readonly kind: 'folder' | 'file'; readonly name: string }
  | { readonly kind: 'rename'; readonly name: string; readonly target: VfsStat };

/* ---------------- columns ---------------- */

/** The four Windows columns, in the order Explorer shows them. */
function useExplorerColumns(locale: AppLocale): readonly Column<VfsStat>[] {
  const { tr, lang } = locale;
  return useMemo<readonly Column<VfsStat>[]>(
    () => [
      {
        id: 'name',
        header: tr('الاسم', 'Nom', 'Name'),
        sort: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
        render: (row) => <NameCell entry={row} />,
      },
      {
        id: 'modified',
        header: tr('تاريخ التعديل', 'Modifié le', 'Date modified'),
        width: 170,
        sort: (a, b) => a.modifiedAt.localeCompare(b.modifiedAt),
        render: (row) => fmt.dateTime(row.modifiedAt, lang),
      },
      {
        id: 'type',
        header: tr('النوع', 'Type', 'Type'),
        width: 160,
        sort: (a, b) => a.contentType.localeCompare(b.contentType),
        render: (row) => typeLabel(row.contentType, row.kind, tr),
      },
      {
        id: 'size',
        header: tr('الحجم', 'Taille', 'Size'),
        width: 100,
        align: 'end',
        mono: true,
        sort: (a, b) => a.size - b.size,
        render: (row) => (row.kind === 'directory' ? '—' : fmt.bytes(row.size, lang)),
      },
    ],
    [lang, tr],
  );
}

/* ---------------- mutations ---------------- */

/** Performs one pending edit and returns the failure message, or `null`. */
async function applyPending(
  runtime: AppEntryProps['runtime'],
  path: string,
  pending: Pending,
  name: string,
): Promise<string | null> {
  if (pending.kind === 'rename') {
    const to = join(dirname(pending.target.path), name);
    const moved = await runtime.invoke('fs.move', { from: pending.target.path, to });
    return moved.ok ? null : moved.error.message;
  }
  if (pending.kind === 'folder') {
    const created = await runtime.invoke('fs.mkdir', { path: join(path, name) });
    return created.ok ? null : created.error.message;
  }
  const created = await runtime.invoke('fs.writeText', {
    path: join(path, name),
    content: '',
    contentType: contentTypeForName(name),
    createOnly: true,
  });
  return created.ok ? null : created.error.message;
}

/** The one destructive prompt Explorer owns: `fs.remove` has no recycle bin. */
function confirmDelete(runtime: AppEntryProps['runtime'], targets: readonly VfsStat[]): Promise<boolean> {
  const { tr } = runtime.locale;
  const only = targets[0]?.name ?? '';
  return runtime.confirm({
    kind: 'warning',
    destructive: true,
    title: tr('حذف نهائي', 'Suppression définitive', 'Delete permanently'),
    body:
      targets.length === 1
        ? tr(
            `سيتم حذف "${only}" نهائيًا.`,
            `« ${only} » sera supprimé définitivement.`,
            `"${only}" will be deleted permanently.`,
          )
        : tr(
            `سيتم حذف ${targets.length} عنصرًا نهائيًا.`,
            `${targets.length} éléments seront supprimés définitivement.`,
            `${targets.length} items will be deleted permanently.`,
          ),
  });
}

interface Mutations {
  readonly commit: () => Promise<void>;
  readonly remove: (targets: readonly VfsStat[]) => Promise<void>;
  readonly open: (entry: VfsStat) => Promise<void>;
  readonly search: () => Promise<void>;
}

interface MutationInput {
  readonly runtime: AppEntryProps['runtime'];
  readonly path: string;
  readonly query: string;
  readonly pending: Pending | null;
  readonly reload: () => void;
  readonly navigate: (path: string) => void;
  readonly setPending: (next: Pending | null) => void;
  readonly setError: (next: string | null) => void;
  readonly setResults: (next: readonly VfsStat[] | null) => void;
  readonly clearSelection: () => void;
}

/**
 * Every write Explorer performs, as one object.
 *
 * The input is read through a ref instead of being closed over, so the returned
 * callbacks keep their identity for the life of the window: a toolbar button does
 * not become a different button because the folder listing changed underneath it.
 */
function useExplorerMutations(input: MutationInput): Mutations {
  const latest = useRef(input);
  latest.current = input;

  const report = useCallback(async (message: string): Promise<void> => {
    const { runtime, setError } = latest.current;
    const { tr } = runtime.locale;
    setError(message);
    await runtime.toast({
      kind: 'error',
      title: tr('فشل العملية', 'Opération échouée', 'Operation failed'),
      body: message,
    });
  }, []);

  const commit = useCallback(async (): Promise<void> => {
    const { runtime, path, pending, reload, setPending, setError } = latest.current;
    if (pending === null) return;
    const name = pending.name.trim();
    if (!isValidName(name)) {
      setError(runtime.locale.tr('اسم غير صالح', 'Nom invalide', 'That name is not allowed'));
      return;
    }
    const failure = await applyPending(runtime, path, pending, name);
    if (failure !== null) return report(failure);
    setPending(null);
    setError(null);
    reload();
  }, [report]);

  const remove = useCallback(async (targets: readonly VfsStat[]): Promise<void> => {
    const { runtime, reload, clearSelection } = latest.current;
    if (targets.length === 0) return;
    if (!(await confirmDelete(runtime, targets))) return;
    for (const target of targets) {
      const removed = await runtime.invoke('fs.remove', {
        path: target.path,
        recursive: target.kind === 'directory',
      });
      if (!removed.ok) {
        await report(removed.error.message);
        break;
      }
    }
    clearSelection();
    reload();
  }, [report]);

  const open = useCallback(async (entry: VfsStat): Promise<void> => {
    const { runtime, navigate } = latest.current;
    if (entry.kind === 'directory') {
      navigate(entry.path);
      return;
    }
    const opened = await runtime.invoke('shell.openPath', { path: entry.path });
    if (!opened.ok) return report(opened.error.message);
    if (opened.value.pid !== null) return;
    const { tr } = runtime.locale;
    await runtime.toast({
      kind: 'info',
      title: tr('لا تطبيق مرتبط', 'Aucune application associée', 'No app is associated'),
      body: entry.name,
    });
  }, [report]);

  const search = useCallback(async (): Promise<void> => {
    const { runtime, path, query, setResults } = latest.current;
    const text = query.trim();
    if (text === '') {
      setResults(null);
      return;
    }
    const found = await runtime.invoke('fs.search', { root: path, query: text, limit: 400 });
    if (found.ok) setResults(found.value);
    else await report(found.error.message);
  }, [report]);

  return useMemo(() => ({ commit, remove, open, search }), [commit, remove, open, search]);
}

export default function ExplorerApp({ runtime }: AppEntryProps) {
  const { locale } = runtime;
  const { t, tr } = locale;
  const history = useHistory(runtime.args.path ?? HOME);
  const [showHidden, setShowHidden] = useSetting<boolean>('ShowHidden', false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly VfsStat[] | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menu = useContextMenu<VfsStat | null>();

  // A search result set is a listing too, so the directory read stands down while
  // one is on screen rather than racing it.
  const dir = useDirectory(results === null ? history.path : null, showHidden);
  const volumes = usePolledSyscall('fs.volumes', {}, VOLUME_POLL_MS).data ?? [];
  const [expanded, toggleExpanded] = useInitialExpansion();
  const capacity = useCapacity(volumes);

  const rows = results ?? dir.entries;
  useWindowTitle(`${basename(history.path)} — ${tr('المستكشف', 'Explorateur', 'Explorer')}`);
  useIpc(IPC_CHANNELS.fileChanged, () => dir.reload());

  const navigate = useCallback(
    (path: string) => {
      setResults(null);
      setQuery('');
      setSelection(new Set());
      setError(null);
      history.go(path);
    },
    [history],
  );

  const clearSelection = useCallback(() => setSelection(new Set()), []);
  const mutations = useExplorerMutations({
    runtime,
    path: history.path,
    query,
    pending,
    reload: dir.reload,
    navigate,
    setPending,
    setError,
    setResults,
    clearSelection,
  });

  const newFolder = useCallback(
    () => setPending({ kind: 'folder', name: tr('مجلد جديد', 'Nouveau dossier', 'New folder') }),
    [tr],
  );
  const newFile = useCallback(
    () => setPending({ kind: 'file', name: uniqueName('notes.txt', dir.entries.map((entry) => entry.name)) }),
    [dir.entries],
  );

  useAppCommands((command) => {
    if (command === 'go:home') navigate(HOME);
    else if (command === 'go:documents') navigate(DOCUMENTS);
    else if (command === 'go:reports') navigate(REPORTS);
    else if (command === 'go:ledger') navigate('L:\\');
    else if (command === 'refresh') dir.reload();
    else if (command === 'new-folder') newFolder();
    else if (command === 'new-file') newFile();
  });

  const selectedRows = useMemo(() => rows.filter((row) => selection.has(row.path)), [rows, selection]);
  const focused = selectedRows.length === 1 ? selectedRows[0] : null;
  const columns = useExplorerColumns(locale);
  const crumbs = useMemo(
    () => ancestry(history.path).map((path) => ({ label: basename(path), value: path })),
    [history.path],
  );

  const onMenuSelect = useCallback(
    (id: string) => {
      const target = menu.menu?.target;
      if (target == null) return;
      if (id === 'open') void mutations.open(target);
      else if (id === 'rename') setPending({ kind: 'rename', name: target.name, target });
      else if (id === 'copy') void runtime.invoke('shell.clipboardWrite', { text: target.path });
      else if (id === 'delete') void mutations.remove([target]);
    },
    [menu.menu, mutations, runtime],
  );

  return (
    <AppFrame
      commands={
        <ExplorerCommands
          locale={locale}
          canBack={history.canBack}
          canForward={history.canForward}
          canUp={dirname(history.path) !== history.path}
          canRename={focused !== null}
          canRemove={selectedRows.length > 0}
          query={query}
          onQueryChange={setQuery}
          actions={{
            back: history.back,
            forward: history.forward,
            up: () => navigate(dirname(history.path)),
            reload: dir.reload,
            newFolder,
            newFile,
            rename: () => {
              if (focused !== null) setPending({ kind: 'rename', name: focused.name, target: focused });
            },
            remove: () => void mutations.remove(selectedRows),
            search: () => void mutations.search(),
          }}
        />
      }
      nav={
        <TreeView
          nodes={buildTree(volumes, tr, t)}
          selectedId={history.path}
          expandedIds={expanded}
          onToggle={toggleExpanded}
          onSelect={(node) => {
            if (node.id !== 'volumes') navigate(node.id);
            toggleExpanded(node.id);
          }}
        />
      }
      aside={
        <DetailsPane
          entry={focused}
          locale={locale}
          onCopyPath={(path) => void runtime.invoke('shell.clipboardWrite', { text: path })}
        />
      }
      status={
        <ExplorerStatus
          locale={locale}
          total={rows.length}
          selected={selectedRows.length}
          showHidden={showHidden}
          onShowHidden={setShowHidden}
          used={capacity.used}
          quota={capacity.quota}
        />
      }
      scroll={false}
    >
      <Listing
        locale={locale}
        crumbs={crumbs}
        onNavigate={navigate}
        resultCount={results === null ? null : results.length}
        onClearResults={() => {
          setResults(null);
          setQuery('');
        }}
        error={error}
        rows={rows}
        columns={columns}
        selection={selection}
        onSelectionChange={setSelection}
        onActivate={(row) => void mutations.open(row)}
        onRowContextMenu={(row, event) => menu.open(event, row)}
        loading={dir.loading}
        loadError={dir.error}
      />

      {menu.menu !== null && menu.menu.target !== null ? (
        <EntryMenu locale={locale} x={menu.menu.x} y={menu.menu.y} onDismiss={menu.close} onSelect={onMenuSelect} />
      ) : null}

      <NameDialog
        locale={locale}
        kind={pending?.kind ?? null}
        name={pending?.name ?? ''}
        error={error}
        onChange={(next) => setPending((current) => (current === null ? null : { ...current, name: next }))}
        onClose={() => {
          setPending(null);
          setError(null);
        }}
        onCommit={() => void mutations.commit()}
      />
    </AppFrame>
  );
}

