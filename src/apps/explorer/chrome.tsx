/**
 * Explorer chrome — the toolbar, the status bar, the details pane, the listing
 * and the two flyouts.
 *
 * None of these holds state. Each is a pure function of the current folder and
 * the current selection, which is what lets `App.tsx` read as the list of things
 * Explorer *does* rather than as a wall of markup. The split is the same one a
 * shell makes between its frame and its content, and it is why the toolbar can
 * be re-ordered without touching a single syscall.
 */
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardCopy,
  Eye,
  FilePlus2,
  FolderPlus,
  Pencil,
  RotateCw,
  Trash2,
} from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  type AppLocale,
  Breadcrumb,
  Button,
  type Column,
  DataGrid,
  Dialog,
  EmptyState,
  Field,
  Input,
  MenuFlyout,
  Meter,
  PropertyRow,
  SearchBox,
  StatusItem,
  Switch,
  ToolbarSeparator,
  ToolbarSpacer,
  type VfsStat,
  fmt,
} from '@/platform/sdk';
import { iconForFile, typeLabel } from '../shared/fileIcons';

/** Icon + name, ellipsised, dimmed when the entry is hidden. */
export function NameCell({ entry }: { entry: VfsStat }) {
  const Glyph = iconForFile(entry.contentType, entry.kind);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Glyph
        size={15}
        style={{ flex: 'none', color: entry.kind === 'directory' ? 'var(--fx-accent-text)' : 'var(--fx-text-secondary)' }}
      />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: entry.hidden ? 0.55 : 1,
        }}
      >
        {entry.name}
      </span>
    </span>
  );
}

/**
 * What the toolbar can do.
 *
 * Every field is a verb with no arguments: the app has already decided *which*
 * entry a rename applies to by the time the button exists, so the toolbar never
 * has to know about the selection it is acting on.
 */
export interface CommandActions {
  readonly back: () => void;
  readonly forward: () => void;
  readonly up: () => void;
  readonly reload: () => void;
  readonly newFolder: () => void;
  readonly newFile: () => void;
  readonly rename: () => void;
  readonly remove: () => void;
  readonly search: () => void;
}

export function ExplorerCommands({
  locale,
  canBack,
  canForward,
  canUp,
  canRename,
  canRemove,
  query,
  onQueryChange,
  actions,
}: {
  locale: AppLocale;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  canRename: boolean;
  canRemove: boolean;
  query: string;
  onQueryChange: (next: string) => void;
  actions: CommandActions;
}) {
  const { tr } = locale;
  return (
    <>
      <Button icon={ArrowLeft} variant="subtle" size="sm" disabled={!canBack} onClick={actions.back} title={tr('رجوع', 'Précédent', 'Back')} />
      <Button icon={ArrowRight} variant="subtle" size="sm" disabled={!canForward} onClick={actions.forward} title={tr('تقدم', 'Suivant', 'Forward')} />
      <Button icon={ArrowUp} variant="subtle" size="sm" disabled={!canUp} onClick={actions.up} title={tr('أعلى', 'Dossier parent', 'Up')} />
      <Button icon={RotateCw} variant="subtle" size="sm" onClick={actions.reload} title={tr('تحديث', 'Actualiser', 'Refresh')} />
      <ToolbarSeparator />
      <Button icon={FolderPlus} variant="subtle" size="sm" onClick={actions.newFolder}>
        {tr('مجلد', 'Dossier', 'Folder')}
      </Button>
      <Button icon={FilePlus2} variant="subtle" size="sm" onClick={actions.newFile}>
        {tr('ملف', 'Fichier', 'File')}
      </Button>
      <ToolbarSeparator />
      <Button icon={Pencil} variant="subtle" size="sm" disabled={!canRename} onClick={actions.rename} title={tr('إعادة تسمية', 'Renommer', 'Rename')} />
      <Button icon={Trash2} variant="subtle" size="sm" disabled={!canRemove} onClick={actions.remove} title={tr('حذف', 'Supprimer', 'Delete')} />
      <ToolbarSpacer />
      <SearchBox
        value={query}
        onChange={onQueryChange}
        onEnter={actions.search}
        width={200}
        placeholder={tr('بحث في المجلد', 'Rechercher ici', 'Search this folder')}
      />
    </>
  );
}

/** Item count, selection count, the hidden-files switch and volume capacity. */
export function ExplorerStatus({
  locale,
  total,
  selected,
  showHidden,
  onShowHidden,
  used,
  quota,
}: {
  locale: AppLocale;
  total: number;
  selected: number;
  showHidden: boolean;
  onShowHidden: (next: boolean) => void;
  used: number;
  quota: number;
}) {
  const { tr, lang } = locale;
  return (
    <>
      <StatusItem>{tr(`${total} عنصرًا`, `${total} élément(s)`, `${total} items`)}</StatusItem>
      {selected > 0 ? (
        <StatusItem tone="accent">
          {tr(`${selected} محدد`, `${selected} sélectionné(s)`, `${selected} selected`)}
        </StatusItem>
      ) : null}
      <ToolbarSpacer />
      <StatusItem icon={Eye} title={tr('إظهار المخفي', 'Afficher les éléments masqués', 'Show hidden items')}>
        <Switch checked={showHidden} onChange={onShowHidden} label={tr('المخفية', 'Masqués', 'Hidden')} />
      </StatusItem>
      <div style={{ width: 130 }}>
        <Meter
          value={used}
          max={Math.max(1, quota)}
          label={`${fmt.bytes(used, lang)} / ${fmt.bytes(quota, lang)}`}
        />
      </div>
    </>
  );
}

/**
 * The properties pane.
 *
 * A folder shows `—` for its size rather than a computed total: Explorer talks
 * to the VFS through `fs.*` and cannot walk a tree for free, so it reports what
 * it actually knows instead of a plausible-looking number.
 */
export function DetailsPane({
  entry,
  locale,
  onCopyPath,
}: {
  entry: VfsStat | null;
  locale: AppLocale;
  onCopyPath: (path: string) => void;
}) {
  const { tr, lang } = locale;
  if (entry === null) {
    return (
      <EmptyState
        compact
        title={tr('لا عنصر محدد', 'Aucun élément sélectionné', 'Nothing selected')}
        description={tr(
          'اختر ملفًا لعرض تفاصيله.',
          'Choisissez un fichier pour voir ses détails.',
          'Pick a file to see its details.',
        )}
      />
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 12 }}>
      <PropertyRow label={tr('الاسم', 'Nom', 'Name')}>{entry.name}</PropertyRow>
      <PropertyRow label={tr('النوع', 'Type', 'Type')}>{typeLabel(entry.contentType, entry.kind, tr)}</PropertyRow>
      <PropertyRow label={tr('المسار', 'Chemin', 'Path')} mono>
        {entry.path}
      </PropertyRow>
      <PropertyRow label={tr('الحجم', 'Taille', 'Size')} mono>
        {entry.kind === 'directory' ? '—' : fmt.bytes(entry.size, lang)}
      </PropertyRow>
      <PropertyRow label={tr('وحدة التخزين', 'Volume', 'Volume')}>{`${entry.volume}:`}</PropertyRow>
      <PropertyRow label={tr('أُنشئ', 'Créé le', 'Created')}>{fmt.dateTime(entry.createdAt, lang)}</PropertyRow>
      <PropertyRow label={tr('عُدّل', 'Modifié le', 'Modified')}>{fmt.dateTime(entry.modifiedAt, lang)}</PropertyRow>
      <PropertyRow label={tr('للقراءة فقط', 'Lecture seule', 'Read-only')}>
        {entry.readOnly ? tr('نعم', 'Oui', 'Yes') : tr('لا', 'Non', 'No')}
      </PropertyRow>
      <div style={{ marginTop: 10 }}>
        <Button icon={ClipboardCopy} size="sm" block onClick={() => onCopyPath(entry.path)}>
          {tr('نسخ المسار', 'Copier le chemin', 'Copy path')}
        </Button>
      </div>
    </div>
  );
}

/** The right-click menu for one row. The caller decides what each id means. */
export function EntryMenu({
  locale,
  x,
  y,
  onDismiss,
  onSelect,
}: {
  locale: AppLocale;
  x: number;
  y: number;
  onDismiss: () => void;
  onSelect: (id: string) => void;
}) {
  const { tr } = locale;
  return (
    <MenuFlyout
      position="fixed"
      x={x}
      y={y}
      entries={[
        { id: 'open', label: tr('فتح', 'Ouvrir', 'Open') },
        { id: 'rename', label: tr('إعادة تسمية', 'Renommer', 'Rename'), icon: Pencil },
        { id: 'copy', label: tr('نسخ المسار', 'Copier le chemin', 'Copy path'), icon: ClipboardCopy },
        { id: 'sep', kind: 'separator' },
        { id: 'delete', label: tr('حذف', 'Supprimer', 'Delete'), icon: Trash2, danger: true },
      ]}
      onDismiss={onDismiss}
      onSelect={onSelect}
    />
  );
}

const dialogTitle = (kind: 'folder' | 'file' | 'rename' | null, tr: AppLocale['tr']): string =>
  kind === 'rename' ? tr('إعادة تسمية', 'Renommer', 'Rename')
  : kind === 'folder' ? tr('مجلد جديد', 'Nouveau dossier', 'New folder')
  : tr('ملف نصي جديد', 'Nouveau fichier texte', 'New text file');

/**
 * The name prompt, shared by create and rename.
 *
 * One dialog for three verbs because the question is the same in all three —
 * only the title changes — and because a rename that reused a different dialog
 * would drift out of step with the validation the app performs on commit.
 */
export function NameDialog({
  locale,
  kind,
  name,
  error,
  onChange,
  onClose,
  onCommit,
}: {
  locale: AppLocale;
  kind: 'folder' | 'file' | 'rename' | null;
  name: string;
  error: string | null;
  onChange: (next: string) => void;
  onClose: () => void;
  onCommit: () => void;
}) {
  const { tr } = locale;
  return (
    <Dialog
      open={kind !== null}
      title={dialogTitle(kind, tr)}
      onClose={onClose}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{ label: tr('موافق', 'OK', 'OK'), onClick: onCommit }}
    >
      <Field label={tr('الاسم', 'Nom', 'Name')} error={error}>
        <Input value={name} onChange={onChange} onEnter={onCommit} autoFocus />
      </Field>
    </Dialog>
  );
}

/** Where a search banner replaces the breadcrumb's meaning, in one place. */
export interface ListingProps {
  readonly locale: AppLocale;
  readonly crumbs: readonly { readonly label: string; readonly value: string }[];
  readonly onNavigate: (path: string) => void;
  readonly resultCount: number | null;
  readonly onClearResults: () => void;
  readonly error: string | null;
  readonly rows: readonly VfsStat[];
  readonly columns: readonly Column<VfsStat>[];
  readonly selection: ReadonlySet<string>;
  readonly onSelectionChange: (keys: ReadonlySet<string>) => void;
  readonly onActivate: (row: VfsStat) => void;
  readonly onRowContextMenu: (row: VfsStat, event: ReactMouseEvent) => void;
  readonly loading: boolean;
  readonly loadError: string | null;
}

/**
 * The listing: breadcrumb, search banner, error line, grid.
 *
 * Virtualised at a fixed 28px row so `L:\` — which can hold every journal line
 * in a fiscal year — scrolls at the same speed as a folder of six files.
 */
export function Listing(props: ListingProps) {
  const { locale, crumbs, onNavigate, resultCount, onClearResults, error, loadError } = props;
  const { tr } = locale;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--fx-divider)',
        }}
      >
        <Breadcrumb segments={crumbs} onNavigate={onNavigate} />
        {resultCount !== null ? (
          <Button size="sm" variant="subtle" onClick={onClearResults}>
            {tr(
              `نتائج البحث (${resultCount}) — إلغاء`,
              `Résultats (${resultCount}) — effacer`,
              `Search results (${resultCount}) — clear`,
            )}
          </Button>
        ) : null}
      </div>
      {error !== null ? (
        <div style={{ padding: '8px 10px 0' }}>
          <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-danger)' }}>{error}</span>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={props.rows}
          columns={props.columns}
          rowKey={(row) => row.path}
          selectedKeys={props.selection}
          onSelectionChange={props.onSelectionChange}
          onActivate={props.onActivate}
          onRowContextMenu={props.onRowContextMenu}
          loading={props.loading}
          density="compact"
          virtualized
          rowHeight={28}
          empty={
            <EmptyState
              icon={FolderPlus}
              title={loadError ?? tr('هذا المجلد فارغ', 'Ce dossier est vide', 'This folder is empty')}
              description={tr(
                'أنشئ مجلدًا أو ملفًا للبدء.',
                'Créez un dossier ou un fichier pour commencer.',
                'Create a folder or a file to get started.',
              )}
            />
          }
        />
      </div>
    </div>
  );
}

