/**
 * Store — the model.
 *
 * The Store draws two lists and merges them. `apps.available` is the OS image —
 * every manifest this kernel was ever handed, installed or not — and it is the
 * spine, because an app the user removed still has to appear somewhere or it
 * could never come back. `apps.list` is the inventory, and it contributes what
 * only a running system knows: when the app was installed, whether it is pinned,
 * how many times it has been launched.
 *
 * Everything here is derived. Nothing is cached and nothing is stored app-side:
 * the kernel owns the inventory, and the one broadcast it makes when the
 * inventory changes (`CHANNEL_APPS_CHANGED`) is what keeps this view honest —
 * including when the change came from Settings, from Start's pin menu or from a
 * `store` command in Terminal rather than from here.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  BookOpen,
  ChartPie,
  ClipboardList,
  Cpu,
  History,
  LayoutGrid,
  Library,
  type LucideIcon,
  PackageCheck,
  Target,
  Wallet,
} from 'lucide-react';
import {
  type AbiResult,
  type AppCategoryId,
  type AppId,
  type AppInventoryRecord,
  type AppManifest,
  CHANNEL_APPS_CHANGED,
  type Capability,
  type Localized,
  PRIVILEGED_CAPABILITIES,
  useApp,
  useIpc,
  usePolledSyscall,
} from '@/platform/sdk';
import { CATEGORY_ORDER } from '../shared/categories';

/** The inventory changes by broadcast, never by the clock — so: read once. */
const ONCE = 0;

/** Shared because it is never mutated, and because the hook keys on its shape. */
const NO_REQUEST = {} as const;

/** Install history: the Setup channel, as deep as the ring goes. */
export const HISTORY_LIMIT = 200;

/** Only the app registry writes install and removal events. */
export const HISTORY_SOURCE = 'AppRegistry';

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

export type ViewId = 'catalogue' | 'installed' | 'library' | 'history';

export const VIEW_LABEL: Readonly<Record<ViewId, Localized>> = {
  catalogue: { ar: 'كل التطبيقات', fr: 'Toutes les applications', en: 'All apps' },
  installed: { ar: 'المثبتة', fr: 'Installées', en: 'Installed' },
  library: { ar: 'المكتبة', fr: 'Bibliothèque', en: 'Library' },
  history: { ar: 'سجل التثبيت', fr: 'Historique', en: 'History' },
};

export const VIEW_ICON: Readonly<Record<ViewId, LucideIcon>> = {
  catalogue: LayoutGrid,
  installed: PackageCheck,
  library: Library,
  history: History,
};

export const CATEGORY_ICON: Readonly<Record<AppCategoryId, LucideIcon>> = {
  system: Cpu,
  productivity: ClipboardList,
  accounting: BookOpen,
  analysis: ChartPie,
  planning: Target,
  treasury: Wallet,
};

/* ------------------------------------------------------------------ *
 * The merged inventory
 * ------------------------------------------------------------------ */

export interface StoreEntry {
  readonly manifest: AppManifest;
  /** `null` for an app the image can supply but the user has removed. */
  readonly record: AppInventoryRecord | null;
}

export interface StoreModel {
  readonly entries: readonly StoreEntry[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export function useStore(): StoreModel {
  const installed = usePolledSyscall('apps.list', NO_REQUEST, ONCE);
  const available = usePolledSyscall('apps.available', NO_REQUEST, ONCE);

  const { refresh: refreshInstalled } = installed;
  const { refresh: refreshAvailable } = available;
  const refresh = useCallback(() => {
    refreshInstalled();
    refreshAvailable();
  }, [refreshInstalled, refreshAvailable]);

  // An install, a removal or a pin — wherever it happened — re-reads both lists.
  useIpc(CHANNEL_APPS_CHANGED, refresh);

  const entries = useMemo<readonly StoreEntry[]>(() => {
    const records = new Map<AppId, AppInventoryRecord>();
    for (const record of installed.data ?? []) records.set(record.manifest.id, record);
    return (available.data ?? []).map((manifest) => ({
      manifest,
      record: records.get(manifest.id) ?? null,
    }));
  }, [installed.data, available.data]);

  return {
    entries,
    loading: installed.data === null || available.data === null,
    error: installed.error ?? available.error,
    refresh,
  };
}

/* ------------------------------------------------------------------ *
 * Selection, sorting, counting
 * ------------------------------------------------------------------ */

export type SortId = 'name' | 'category' | 'installed' | 'launches';

export const SORT_LABEL: Readonly<Record<SortId, Localized>> = {
  name: { ar: 'الاسم', fr: 'Nom', en: 'Name' },
  category: { ar: 'الفئة', fr: 'Catégorie', en: 'Category' },
  installed: { ar: 'الأحدث تثبيتًا', fr: 'Installation récente', en: 'Recently installed' },
  launches: { ar: 'الأكثر استخدامًا', fr: 'Les plus utilisées', en: 'Most used' },
};

export interface Filter {
  readonly view: ViewId;
  readonly category: AppCategoryId | null;
  readonly needle: string;
}

/** What a person would actually type: a name, a publisher, a keyword, an id. */
function matches(entry: StoreEntry, needle: string, t: (text: Localized) => string): boolean {
  if (needle === '') return true;
  const { manifest } = entry;
  const haystack = [
    t(manifest.name),
    manifest.name.en,
    manifest.name.fr,
    manifest.name.ar,
    t(manifest.description),
    manifest.publisher,
    String(manifest.id),
    ...(manifest.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** `-1` for a removed app, which is what sorts it below every installed one. */
const installedAtMs = (entry: StoreEntry): number =>
  entry.record === null ? -1 : Date.parse(entry.record.installedAt);

function comparator(sort: SortId, t: (text: Localized) => string): (a: StoreEntry, b: StoreEntry) => number {
  const byName = (a: StoreEntry, b: StoreEntry) => t(a.manifest.name).localeCompare(t(b.manifest.name));
  if (sort === 'name') return byName;
  if (sort === 'category') {
    return (a, b) =>
      CATEGORY_ORDER.indexOf(a.manifest.category) - CATEGORY_ORDER.indexOf(b.manifest.category) || byName(a, b);
  }
  if (sort === 'launches') {
    return (a, b) => (b.record?.launches ?? -1) - (a.record?.launches ?? -1) || byName(a, b);
  }
  return (a, b) => installedAtMs(b) - installedAtMs(a) || byName(a, b);
}

/** The visible rows: the view, then the category, then the search box. */
export function selectEntries(
  entries: readonly StoreEntry[],
  filter: Filter,
  sort: SortId,
  t: (text: Localized) => string,
): readonly StoreEntry[] {
  const needle = filter.needle.trim().toLowerCase();
  const rows = entries.filter((entry) => {
    if (filter.view === 'installed' && entry.record === null) return false;
    if (filter.view === 'library' && entry.record !== null) return false;
    if (filter.category !== null && entry.manifest.category !== filter.category) return false;
    return matches(entry, needle, t);
  });
  return rows.sort(comparator(sort, t));
}

export interface StoreCounts {
  readonly total: number;
  readonly installed: number;
  readonly removed: number;
  readonly pinned: number;
  readonly byCategory: Readonly<Partial<Record<AppCategoryId, number>>>;
}

export function tally(entries: readonly StoreEntry[]): StoreCounts {
  const byCategory: Partial<Record<AppCategoryId, number>> = {};
  let installed = 0;
  let pinned = 0;
  for (const entry of entries) {
    byCategory[entry.manifest.category] = (byCategory[entry.manifest.category] ?? 0) + 1;
    if (entry.record === null) continue;
    installed += 1;
    if (entry.record.pinned) pinned += 1;
  }
  return { total: entries.length, installed, removed: entries.length - installed, pinned, byCategory };
}

/* ------------------------------------------------------------------ *
 * What an app is allowed to do
 * ------------------------------------------------------------------ */

export interface PermissionRow {
  readonly capability: Capability;
  /** Privileged capabilities cost a consent prompt when they are exercised. */
  readonly privileged: boolean;
}

/** Privileged first: the permissions worth reading are the ones that interrupt. */
export function permissions(manifest: AppManifest): readonly PermissionRow[] {
  return manifest.capabilities
    .map((capability) => ({ capability, privileged: PRIVILEGED_CAPABILITIES.includes(capability) }))
    .sort((a, b) => Number(b.privileged) - Number(a.privileged));
}

/**
 * Whether Remove can do anything.
 *
 * The app registry refuses to uninstall a system component — but the refusal
 * arrives *after* the kernel has already asked the user to consent to a registry
 * write, so a live button here would buy a consent prompt and then an error. This
 * is the one place the Store is right to answer a question the kernel would
 * answer later.
 */
export function canRemove(entry: StoreEntry): boolean {
  return entry.record !== null && !entry.manifest.systemComponent;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export type BusyKind = 'open' | 'pin' | 'install' | 'remove';

export interface StoreBusy {
  readonly appId: AppId;
  readonly kind: BusyKind;
}

export interface StoreActions {
  readonly busy: StoreBusy | null;
  readonly open: (entry: StoreEntry) => void;
  readonly togglePin: (entry: StoreEntry) => void;
  readonly install: (entry: StoreEntry) => void;
  readonly remove: (entry: StoreEntry) => void;
}

/**
 * The four things the Store can do to an app.
 *
 * There is no confirmation dialog anywhere in here, and that is deliberate.
 * Installing and removing both rewrite the machine hive; `registry.write` is a
 * privileged capability, so the *kernel* raises the consent prompt before the
 * syscall is ever dispatched. An app that asked first would be asking a question
 * the user is about to be asked again — the opposite of Explorer's delete, where
 * `fs.write` is unprivileged and nothing else would ask at all. What the Store
 * owes the user instead is the consequence in words, next to the button: a
 * removed app goes back to the Library rather than off the machine.
 *
 * @param refresh re-reads both lists. The kernel also broadcasts the change, so
 *   this only closes the gap before the broadcast lands.
 */
export function useStoreActions(refresh: () => void): StoreActions {
  const runtime = useApp();
  const { t, tr } = runtime.locale;
  const [busy, setBusy] = useState<StoreBusy | null>(null);

  const run = useCallback(
    (appId: AppId, kind: BusyKind, act: () => Promise<AbiResult<unknown>>, done?: () => void) => {
      const go = async () => {
        setBusy({ appId, kind });
        const result = await act();
        setBusy(null);
        if (!result.ok) {
          void runtime.toast({ kind: 'error', title: result.error.message });
          return;
        }
        refresh();
        done?.();
      };
      void go();
    },
    [runtime, refresh],
  );

  const open = useCallback(
    (entry: StoreEntry) => {
      run(entry.manifest.id, 'open', () => runtime.invoke('shell.launch', { appId: entry.manifest.id }));
    },
    [run, runtime],
  );

  const togglePin = useCallback(
    (entry: StoreEntry) => {
      const pinned = !(entry.record?.pinned ?? false);
      run(
        entry.manifest.id,
        'pin',
        () => runtime.invoke('apps.setPinned', { appId: entry.manifest.id, pinned }),
        () => {
          void runtime.toast({
            kind: 'success',
            title: pinned
              ? tr('ثُبّت في شريط المهام', 'Épinglée à la barre des tâches', 'Pinned to the taskbar')
              : tr('أُلغي التثبيت', 'Détachée de la barre', 'Unpinned'),
            body: t(entry.manifest.name),
          });
        },
      );
    },
    [run, runtime, t, tr],
  );

  const install = useCallback(
    (entry: StoreEntry) => {
      const name = t(entry.manifest.name);
      run(
        entry.manifest.id,
        'install',
        () => runtime.invoke('apps.install', { appId: entry.manifest.id }),
        () => {
          // A notification rather than a toast: an install is worth finding again
          // in the Notification Center, and clicking it opens what was installed.
          void runtime.notify({
            kind: 'success',
            title: tr('اكتمل التثبيت', 'Installation terminée', 'Install complete'),
            body: tr(`${name} جاهز للاستخدام.`, `${name} est prête à l’emploi.`, `${name} is ready to use.`),
            launch: entry.manifest.id,
          });
        },
      );
    },
    [run, runtime, t, tr],
  );

  const remove = useCallback(
    (entry: StoreEntry) => {
      const name = t(entry.manifest.name);
      run(
        entry.manifest.id,
        'remove',
        () => runtime.invoke('apps.uninstall', { appId: entry.manifest.id }),
        () => {
          void runtime.toast({
            kind: 'success',
            title: tr(`أُزيل ${name}`, `${name} a été supprimée`, `${name} removed`),
            body: tr(
              'يمكن إعادة تثبيته من المكتبة.',
              'Réinstallable depuis la bibliothèque.',
              'It can be reinstalled from the Library.',
            ),
          });
        },
      );
    },
    [run, runtime, t, tr],
  );

  return { busy, open, togglePin, install, remove };
}
