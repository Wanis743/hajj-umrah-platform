/**
 * Desktop — wallpaper, icons, rubber-band selection and the desktop menu.
 *
 * Two kinds of thing live on the desktop, exactly as in Windows: *namespace*
 * items (application shortcuts, which are not files at all) and the real
 * contents of `C:\Users\finance\Desktop`. Both are read live — the app registry
 * and the VFS are the only stores, so a file created by Terminal appears here
 * without the shell being told, and an uninstall removes its shortcut.
 *
 * The desktop is also the shell's file manager of last resort: it creates,
 * renames and deletes through the VFS subsystem directly (it is the shell, the
 * way `explorer.exe` is), while every *application* has to ask for `fs.write`
 * through a syscall. Failures are never swallowed — each one raises a toast.
 */
import {
  ArrowDownAZ,
  Copy,
  FileText,
  Folder,
  LayoutGrid,
  Monitor,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  SquareArrowOutUpRight,
  Table2,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import { APP_IDS, REG, type AbiResult, type VfsStat } from '../kernel/abi';
import type { InstalledApp, Kernel } from '../kernel/contracts';
import { KERNEL_USER_FOLDER } from '../kernel/kernel';
import type { AppLocale } from '../sdk';
import { MenuFlyout, type MenuEntry } from '../sdk/ui';
import { ICON_PIXELS, wallpaperById, type Appearance, type IconSize } from './appearance';
import { WallpaperLayer } from './Wallpaper';
import {
  useKernel,
  useKernelAction,
  useKernelView,
  useKernelView2,
  useShellHostController,
  useToast,
} from './bindings';
import { iconForContentType } from './iconRegistry';
import { AppIcon } from './icons';

const DESKTOP_FOLDER = `${KERNEL_USER_FOLDER}\\Desktop`;
/** Opening a whole marquee-selected screenful at once would be hostile. */
const MAX_BULK_OPEN = 4;

type SortKey = 'name' | 'kind' | 'date' | 'size';
const SORT_KEYS: readonly SortKey[] = ['name', 'kind', 'date', 'size'];

type DeskItem =
  | { readonly kind: 'app'; readonly key: string; readonly label: string; readonly app: InstalledApp }
  | { readonly kind: 'file'; readonly key: string; readonly label: string; readonly stat: VfsStat };

type FileItem = Extract<DeskItem, { kind: 'file' }>;
type Selection = ReadonlySet<string>;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/* ------------------------------------------------------------------ *
 * Reading the desktop
 * ------------------------------------------------------------------ */

const asSortKey = (value: string): SortKey =>
  (SORT_KEYS as readonly string[]).includes(value) ? (value as SortKey) : 'name';

/** Windows' ordering rule: folders lead, then the chosen column. */
const compareStats =
  (sort: SortKey, locale: AppLocale) =>
  (a: VfsStat, b: VfsStat): number => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    if (sort === 'date') return b.modifiedAt.localeCompare(a.modifiedAt);
    if (sort === 'size') return b.size - a.size;
    if (sort === 'kind' && a.contentType !== b.contentType) return a.contentType.localeCompare(b.contentType);
    return a.name.localeCompare(b.name, locale.intlLocale);
  };

function buildItems(kernel: Kernel, locale: AppLocale, sort: SortKey): readonly DeskItem[] {
  const shortcuts = kernel.apps
    .list()
    .filter((app) => app.enabled && app.manifest.desktopShortcut)
    .map<DeskItem>((app) => ({
      kind: 'app',
      key: `app:${app.manifest.id as string}`,
      label: locale.t(app.manifest.name),
      app,
    }));

  const listed = kernel.vfs.list(DESKTOP_FOLDER, false);
  const files = (listed.ok ? [...listed.value] : [])
    .sort(compareStats(sort, locale))
    .map<DeskItem>((stat) => ({ kind: 'file', key: stat.path, label: stat.name, stat }));

  return [...shortcuts, ...files];
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

const spanRect = (from: { x: number; y: number }, to: { x: number; y: number }): Rect => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  w: Math.abs(to.x - from.x),
  h: Math.abs(to.y - from.y),
});

/** Keys of every cell the band touches, in grid-local coordinates. */
function bandHits(cells: Map<string, HTMLElement>, origin: DOMRect, band: Rect): readonly string[] {
  const found: string[] = [];
  for (const [key, element] of cells) {
    const cell = element.getBoundingClientRect();
    const x = cell.left - origin.left;
    const y = cell.top - origin.top;
    const touches = x < band.x + band.w && x + cell.width > band.x && y < band.y + band.h && y + cell.height > band.y;
    if (touches) found.push(key);
  }
  return found;
}

/** `New folder`, `New folder (2)`, … — the same disambiguation Windows uses. */
function uniqueName(taken: ReadonlySet<string>, base: string, extension: string): string {
  let candidate = `${base}${extension}`;
  let counter = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} (${counter})${extension}`;
    counter += 1;
  }
  return candidate;
}

/* ------------------------------------------------------------------ *
 * File operations
 * ------------------------------------------------------------------ */

interface DeskFiles {
  /** Path being renamed in place, or `null`. */
  readonly renaming: string | null;
  readonly beginRename: (path: string | null) => void;
  readonly create: (what: 'folder' | 'text' | 'sheet', taken: Selection) => void;
  readonly rename: (item: FileItem, next: string) => void;
  readonly remove: (targets: readonly DeskItem[]) => Promise<void>;
  readonly copyPath: (path: string) => Promise<void>;
}

/**
 * The desktop's write side. Kept out of the component because these are five
 * independent operations over one store, and none of them touches layout.
 */
function useDeskFiles(locale: AppLocale, setSelection: Dispatch<SetStateAction<Selection>>): DeskFiles {
  const kernel = useKernel();
  const toast = useToast();
  const { host } = useShellHostController();
  const [renaming, setRenaming] = useState<string | null>(null);

  const settle = useCallback(
    (title: string, result: AbiResult<VfsStat>): VfsStat | null => {
      if (result.ok) return result.value;
      toast({ kind: 'error', title, body: result.error.message });
      return null;
    },
    [toast],
  );

  const create = useCallback(
    (what: 'folder' | 'text' | 'sheet', taken: Selection) => {
      const title = locale.tr('عنصر جديد', 'Nouvel élément', 'New item');
      if (what === 'folder') {
        const name = uniqueName(taken, locale.tr('مجلد جديد', 'Nouveau dossier', 'New folder'), '');
        const stat = settle(title, kernel.vfs.mkdir(`${DESKTOP_FOLDER}\\${name}`, false));
        if (stat !== null) setRenaming(stat.path);
        return;
      }
      const sheet = what === 'sheet';
      const base = sheet
        ? locale.tr('جدول جديد', 'Nouvelle feuille', 'New Spreadsheet')
        : locale.tr('مستند نصي جديد', 'Nouveau document texte', 'New Text Document');
      const name = uniqueName(taken, base, sheet ? '.fsheet' : '.txt');
      const stat = settle(
        title,
        kernel.vfs.writeText(
          `${DESKTOP_FOLDER}\\${name}`,
          sheet ? '{"cells":{}}' : '',
          sheet ? 'application/vnd.financeos.sheet' : 'text/plain',
          true,
        ),
      );
      if (stat !== null) setRenaming(stat.path);
    },
    [kernel, locale, settle],
  );

  const rename = useCallback(
    (item: FileItem, next: string) => {
      setRenaming(null);
      const clean = next.trim();
      if (clean.length === 0 || clean === item.label) return;
      const moved = kernel.vfs.move(item.stat.path, `${DESKTOP_FOLDER}\\${clean}`, false);
      const stat = settle(locale.tr('إعادة التسمية', 'Renommer', 'Rename'), moved);
      if (stat !== null) setSelection(new Set([stat.path]));
    },
    [kernel, locale, setSelection, settle],
  );

  const remove = useCallback(
    async (targets: readonly DeskItem[]) => {
      const files = targets.filter((item): item is FileItem => item.kind === 'file');
      const first = files[0];
      if (first === undefined) return;
      const title = locale.tr('حذف', 'Supprimer', 'Delete');
      const many = files.length > 1;
      const confirmed = await host.messageBox({
        kind: 'warning',
        title,
        // There is no recycle bin, so say plainly that this is permanent.
        body: many
          ? locale.tr(
              `سيتم حذف ${files.length} عناصر نهائيًا.`,
              `${files.length} éléments seront supprimés définitivement.`,
              `${files.length} items will be permanently deleted.`,
            )
          : locale.tr(
              `سيتم حذف "${first.label}" نهائيًا.`,
              `« ${first.label} » sera supprimé définitivement.`,
              `"${first.label}" will be permanently deleted.`,
            ),
        confirmLabel: { ar: 'حذف', fr: 'Supprimer', en: 'Delete' },
        cancelLabel: { ar: 'إلغاء', fr: 'Annuler', en: 'Cancel' },
        destructive: true,
      });
      if (!confirmed) return;
      for (const file of files) {
        const result = kernel.vfs.remove(file.stat.path, true);
        if (!result.ok) toast({ kind: 'error', title, body: result.error.message });
      }
      setSelection(new Set<string>());
    },
    [host, kernel, locale, setSelection, toast],
  );

  const copyPath = useCallback(
    async (path: string) => {
      const done = await host.clipboardWrite(path);
      toast(
        done
          ? { kind: 'success', title: locale.tr('تم نسخ المسار', 'Chemin copié', 'Path copied'), body: path }
          : {
              kind: 'error',
              title: locale.tr('نسخ المسار', 'Copier le chemin', 'Copy path'),
              body: locale.tr('الحافظة غير متاحة.', 'Presse-papiers indisponible.', 'The clipboard is unavailable.'),
            },
      );
    },
    [host, locale, toast],
  );

  return { renaming, beginRename: setRenaming, create, rename, remove, copyPath };
}

/* ------------------------------------------------------------------ *
 * Desktop
 * ------------------------------------------------------------------ */

export interface DesktopProps {
  readonly locale: AppLocale;
  readonly appearance: Appearance;
}

export function Desktop({ locale, appearance }: DesktopProps) {
  const kernel = useKernel();
  const runAction = useKernelAction();

  const gridRef = useRef<HTMLDivElement | null>(null);
  const cells = useRef(new Map<string, HTMLElement>()).current;
  const anchor = useRef(0);

  const [, refresh] = useReducer((tick: number) => tick + 1, 0);
  const [selection, setSelection] = useState<Selection>(() => new Set<string>());
  const [band, setBand] = useState<Rect | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: DeskItem | null } | null>(null);
  const files = useDeskFiles(locale, setSelection);

  const sort = useKernelView(kernel.registry, () =>
    asSortKey(kernel.registry.getString(REG.userDesktop, 'SortBy', 'name')),
  );
  const items = useKernelView2(kernel.vfs, kernel.apps, () => buildItems(kernel, locale, sort));
  const paper = wallpaperById(appearance.wallpaper);
  const chosen = items.filter((item) => selection.has(item.key));

  const open = useCallback(
    (item: DeskItem) => {
      const call = item.kind === 'app' ? () => kernel.launch(item.app.manifest.id) : () => kernel.openPath(item.stat.path);
      void runAction(item.label, call);
    },
    [kernel, runAction],
  );

  const select = (index: number, item: DeskItem, event: { ctrlKey: boolean; shiftKey: boolean }) => {
    if (event.ctrlKey) {
      setSelection((previous) => {
        const next = new Set(previous);
        if (next.has(item.key)) next.delete(item.key);
        else next.add(item.key);
        return next;
      });
      anchor.current = index;
      return;
    }
    if (event.shiftKey) {
      const [from, to] = anchor.current <= index ? [anchor.current, index] : [index, anchor.current];
      setSelection(new Set(items.slice(from, to + 1).map((entry) => entry.key)));
      return;
    }
    setSelection(new Set([item.key]));
    anchor.current = index;
  };

  /** Rubber band. Tracked on `window` so a drag that leaves the grid still works. */
  const beginBand = (event: ReactPointerEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (event.button !== 0 || grid === null || event.target !== grid) return;
    grid.focus();
    files.beginRename(null);

    const origin = grid.getBoundingClientRect();
    const additive = event.ctrlKey || event.shiftKey;
    const base = additive ? new Set(selection) : new Set<string>();
    if (!additive) setSelection(new Set<string>());
    const from = { x: event.clientX - origin.left, y: event.clientY - origin.top };

    const move = (native: PointerEvent) => {
      const next = spanRect(from, { x: native.clientX - origin.left, y: native.clientY - origin.top });
      setBand(next);
      setSelection(new Set([...base, ...bandHits(cells, origin, next)]));
    };
    const finish = () => {
      setBand(null);
      window.removeEventListener('pointermove', move);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const onItemCommand = (item: DeskItem, id: string) => {
    if (id === 'open') open(item);
    else if (item.kind === 'app') {
      if (id === 'pin' || id === 'unpin') kernel.apps.setPinned(item.app.manifest.id, id === 'pin');
    } else if (id === 'rename') files.beginRename(item.stat.path);
    else if (id === 'delete') void files.remove(chosen.length > 1 ? chosen : [item]);
    else if (id === 'copy') void files.copyPath(item.stat.path);
  };

  const onCommand = (id: string) => {
    const settings = (page: string) =>
      void runAction(locale.tr('الإعدادات', 'Paramètres', 'Settings'), () =>
        kernel.launch(APP_IDS.settings, { page }),
      );
    if (id.startsWith('view:')) kernel.registry.set(REG.userDesktop, 'IconSize', id.slice(5));
    else if (id.startsWith('sort:')) kernel.registry.set(REG.userDesktop, 'SortBy', id.slice(5));
    else if (id.startsWith('new:')) {
      const taken = new Set(items.filter((item) => item.kind === 'file').map((item) => item.label.toLowerCase()));
      files.create(id.slice(4) as 'folder' | 'text' | 'sheet', taken);
    } else if (id === 'icons') kernel.registry.set(REG.userDesktop, 'ShowIcons', !appearance.showDesktopIcons);
    else if (id === 'refresh') refresh();
    else if (id === 'terminal') {
      void runAction('Terminal', () => kernel.launch(APP_IDS.terminal, { cwd: DESKTOP_FOLDER }));
    } else if (id === 'display') settings('system');
    else if (id === 'personalise') settings('personalisation');
    else if (menu?.item != null) onItemCommand(menu.item, id);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (files.renaming !== null) return;
    if (event.key === 'Escape') setSelection(new Set<string>());
    else if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      setSelection(new Set(items.map((item) => item.key)));
    } else if (event.key === 'F5') {
      event.preventDefault();
      refresh();
    } else if (chosen.length === 0) return;
    else if (event.key === 'Enter') {
      event.preventDefault();
      for (const item of chosen.slice(0, MAX_BULK_OPEN)) open(item);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void files.remove(chosen);
    } else if (event.key === 'F2') {
      event.preventDefault();
      const target = chosen.find((item): item is FileItem => item.kind === 'file');
      if (target !== undefined) files.beginRename(target.stat.path);
    }
  };

  const openMenu = (clientX: number, clientY: number, item: DeskItem | null) => {
    const origin = gridRef.current?.getBoundingClientRect();
    setMenu({ x: clientX - (origin?.left ?? 0), y: clientY - (origin?.top ?? 0), item });
  };

  return (
    <div className="fx-desktop" data-light={paper.light ? 'true' : 'false'}>
      <WallpaperLayer paper={paper} />
      <div
        ref={gridRef}
        className="fx-desk-grid"
        tabIndex={0}
        aria-label={locale.tr('سطح المكتب', 'Bureau', 'Desktop')}
        onPointerDown={beginBand}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          setSelection(new Set<string>());
          openMenu(event.clientX, event.clientY, null);
        }}
      >
        {appearance.showDesktopIcons
          ? items.map((item, index) => (
              <DeskIcon
                key={item.key}
                item={item}
                size={appearance.iconSize}
                selected={selection.has(item.key)}
                renaming={item.kind === 'file' && files.renaming === item.stat.path}
                register={(element) => {
                  if (element === null) cells.delete(item.key);
                  else cells.set(item.key, element);
                }}
                onSelect={(event) => select(index, item, event)}
                onOpen={() => open(item)}
                onRename={(next) => {
                  if (item.kind === 'file') files.rename(item, next);
                }}
                onCancelRename={() => files.beginRename(null)}
                onContext={(x, y) => {
                  if (!selection.has(item.key)) setSelection(new Set([item.key]));
                  openMenu(x, y, item);
                }}
              />
            ))
          : null}

        {band !== null ? (
          <div className="fx-marquee" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />
        ) : null}
      </div>

      {menu !== null ? (
        <MenuFlyout
          position="absolute"
          x={menu.x}
          y={menu.y}
          minWidth={menu.item === null ? 236 : 216}
          entries={
            menu.item === null ? desktopEntries(locale, appearance, sort) : itemEntries(menu.item, locale, chosen.length)
          }
          onDismiss={() => setMenu(null)}
          onSelect={onCommand}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

interface DeskIconProps {
  readonly item: DeskItem;
  readonly size: IconSize;
  readonly selected: boolean;
  readonly renaming: boolean;
  readonly register: (element: HTMLElement | null) => void;
  readonly onSelect: (event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  readonly onOpen: () => void;
  readonly onRename: (next: string) => void;
  readonly onCancelRename: () => void;
  readonly onContext: (clientX: number, clientY: number) => void;
}

function DeskIcon({
  item,
  size,
  selected,
  renaming,
  register,
  onSelect,
  onOpen,
  onRename,
  onCancelRename,
  onContext,
}: DeskIconProps) {
  const pixels = ICON_PIXELS[size];
  const Glyph = item.kind === 'file' ? iconForContentType(item.stat.contentType, item.stat.kind) : null;

  return (
    <div
      ref={register}
      className="fx-desk-icon"
      data-selected={selected ? 'true' : 'false'}
      style={{ width: pixels + 44 }}
      role="button"
      tabIndex={-1}
      aria-pressed={selected}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button === 0) onSelect(event);
      }}
      onDoubleClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContext(event.clientX, event.clientY);
      }}
    >
      {item.kind === 'app' ? (
        <AppIcon icon={item.app.manifest.icon} category={item.app.manifest.category} size={pixels} />
      ) : Glyph !== null ? (
        <Glyph size={pixels} strokeWidth={1.4} />
      ) : null}

      {renaming ? (
        <RenameField value={item.label} onCommit={onRename} onCancel={onCancelRename} />
      ) : (
        <span className="fx-desk-label">{item.label}</span>
      )}
    </div>
  );
}

/**
 * In-place rename box. Owns a "already committed" flag so the blur that follows
 * Enter (or Escape) does not fire a second, failing move.
 */
function RenameField({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const done = useRef(false);
  return (
    <input
      className="fx-desk-rename"
      autoFocus
      defaultValue={value}
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          done.current = true;
          onCommit(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(event) => {
        if (done.current) return;
        done.current = true;
        onCommit(event.currentTarget.value);
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Menus
 * ------------------------------------------------------------------ */

function desktopEntries(locale: AppLocale, appearance: Appearance, sort: SortKey): readonly MenuEntry[] {
  const sizes: readonly { readonly id: IconSize; readonly label: string }[] = [
    { id: 'large', label: locale.tr('أيقونات كبيرة', 'Grandes icônes', 'Large icons') },
    { id: 'medium', label: locale.tr('أيقونات متوسطة', 'Icônes moyennes', 'Medium icons') },
    { id: 'small', label: locale.tr('أيقونات صغيرة', 'Petites icônes', 'Small icons') },
  ];
  const columns: readonly { readonly id: SortKey; readonly label: string }[] = [
    { id: 'name', label: locale.tr('الاسم', 'Nom', 'Name') },
    { id: 'kind', label: locale.tr('النوع', 'Type', 'Item type') },
    { id: 'date', label: locale.tr('تاريخ التعديل', 'Date de modification', 'Date modified') },
    { id: 'size', label: locale.tr('الحجم', 'Taille', 'Size') },
  ];

  return [
    {
      id: 'view',
      label: locale.tr('عرض', 'Affichage', 'View'),
      icon: LayoutGrid,
      submenu: [
        ...sizes.map<MenuEntry>((entry) => ({
          id: `view:${entry.id}`,
          label: entry.label,
          checked: appearance.iconSize === entry.id,
        })),
        { id: 'view-sep', kind: 'separator' },
        {
          id: 'icons',
          label: locale.tr('إظهار أيقونات سطح المكتب', 'Afficher les icônes', 'Show desktop icons'),
          checked: appearance.showDesktopIcons,
        },
      ],
    },
    {
      id: 'sort',
      label: locale.tr('ترتيب حسب', 'Trier par', 'Sort by'),
      icon: ArrowDownAZ,
      submenu: columns.map<MenuEntry>((entry) => ({
        id: `sort:${entry.id}`,
        label: entry.label,
        checked: sort === entry.id,
      })),
    },
    { id: 'refresh', label: locale.tr('تحديث', 'Actualiser', 'Refresh'), icon: RefreshCw, accelerator: 'F5' },
    { id: 'sep-new', kind: 'separator' },
    {
      id: 'new',
      label: locale.tr('جديد', 'Nouveau', 'New'),
      icon: Plus,
      submenu: [
        { id: 'new:folder', label: locale.tr('مجلد', 'Dossier', 'Folder'), icon: Folder },
        { id: 'new:text', label: locale.tr('مستند نصي', 'Document texte', 'Text document'), icon: FileText },
        { id: 'new:sheet', label: locale.tr('جدول بيانات', 'Feuille de calcul', 'Spreadsheet'), icon: Table2 },
      ],
    },
    { id: 'sep-open', kind: 'separator' },
    {
      id: 'terminal',
      label: locale.tr('فتح في الطرفية', 'Ouvrir dans le terminal', 'Open in Terminal'),
      icon: Terminal,
    },
    { id: 'display', label: locale.tr('إعدادات العرض', 'Paramètres d’affichage', 'Display settings'), icon: Monitor },
    { id: 'personalise', label: locale.tr('تخصيص', 'Personnaliser', 'Personalise'), icon: Palette },
  ];
}

function itemEntries(item: DeskItem, locale: AppLocale, selected: number): readonly MenuEntry[] {
  const openEntry: MenuEntry = {
    id: 'open',
    label: locale.tr('فتح', 'Ouvrir', 'Open'),
    icon: SquareArrowOutUpRight,
  };
  if (item.kind === 'app') {
    return [
      openEntry,
      { id: 'sep', kind: 'separator' },
      item.app.pinned
        ? { id: 'unpin', label: locale.tr('إزالة من الشريط', 'Détacher', 'Unpin from taskbar'), icon: PinOff }
        : { id: 'pin', label: locale.tr('تثبيت في الشريط', 'Épingler', 'Pin to taskbar'), icon: Pin },
    ];
  }
  return [
    openEntry,
    { id: 'sep-edit', kind: 'separator' },
    {
      id: 'rename',
      label: locale.tr('إعادة التسمية', 'Renommer', 'Rename'),
      icon: Pencil,
      accelerator: 'F2',
      disabled: selected > 1,
    },
    { id: 'copy', label: locale.tr('نسخ المسار', 'Copier le chemin', 'Copy path'), icon: Copy },
    { id: 'sep-del', kind: 'separator' },
    {
      id: 'delete',
      label:
        selected > 1
          ? locale.tr(`حذف ${selected} عناصر`, `Supprimer ${selected} éléments`, `Delete ${selected} items`)
          : locale.tr('حذف', 'Supprimer', 'Delete'),
      icon: Trash2,
      accelerator: 'Del',
      danger: true,
    },
  ];
}
