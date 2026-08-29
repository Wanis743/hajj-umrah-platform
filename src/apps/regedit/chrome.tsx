/**
 * Registry Editor — chrome.
 *
 * The address bar is the one piece worth explaining. Regedit grew one in Windows
 * 10 and it changed how the app is used: paths are what people paste to each
 * other, so typing one has to work as well as clicking down the tree. It accepts
 * either spelling of a hive (`HKCU` or `HKEY_CURRENT_USER`), a leading
 * `Computer\`, and forward slashes, because those are what actually get pasted.
 */
import { useMemo, useState } from 'react';
import {
  ArrowUp,
  ClipboardCopy,
  Database,
  FileDown,
  FilePlus2,
  FolderPlus,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  InfoBar,
  Input,
  MenuFlyout,
  NavItem,
  type RegistryEntry,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  fmt,
  useApp,
} from '@/platform/sdk';
import {
  type FindHit,
  type FindScope,
  DEFAULT_VALUE_NAME,
  findAll,
  fromLongPath,
  isMachineKey,
  isVolatileKey,
  keyName,
  toLongPath,
} from './catalog';

/** Enough to fill the list twice over; a hive that big means a better query. */
const FIND_LIMIT = 200;

export interface RegToolbarProps {
  readonly path: string;
  readonly onNavigate: (key: string) => void;
  readonly canGoUp: boolean;
  readonly onUp: () => void;
  readonly onRefresh: () => void;
  readonly onFind: () => void;
  readonly onNewValue: () => void;
  readonly onExport: () => void;
  readonly favorite: boolean;
  readonly onFavorite: () => void;
  readonly busy: boolean;
}

export function RegToolbar({
  path,
  onNavigate,
  canGoUp,
  onUp,
  onRefresh,
  onFind,
  onNewValue,
  onExport,
  favorite,
  onFavorite,
  busy,
}: RegToolbarProps) {
  const { tr } = useApp().locale;
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? toLongPath(path);

  const commit = () => {
    if (draft !== null) onNavigate(fromLongPath(draft));
    setDraft(null);
  };

  return (
    <>
      <IconButton
        icon={ArrowUp}
        label={tr('إلى الأعلى', 'Remonter', 'Up one level')}
        onClick={onUp}
        disabled={!canGoUp}
      />
      <div style={{ flex: 1, minWidth: 120, display: 'flex' }}>
        <Input
          value={shown}
          onChange={setDraft}
          onEnter={commit}
          onEscape={() => setDraft(null)}
          mono
          aria-label={tr('مسار المفتاح', 'Chemin de la clé', 'Key path')}
        />
      </div>
      <IconButton icon={RefreshCw} label={tr('تحديث', 'Actualiser', 'Refresh')} onClick={onRefresh} />
      <IconButton
        icon={Star}
        label={favorite ? tr('إزالة من المفضّلة', 'Retirer des favoris', 'Remove from favourites') : tr('إضافة إلى المفضّلة', 'Ajouter aux favoris', 'Add to favourites')}
        onClick={onFavorite}
        active={favorite}
        tone={favorite ? 'warning' : undefined}
      />
      <ToolbarSeparator />
      <Button size="sm" icon={FilePlus2} onClick={onNewValue}>
        {tr('قيمة جديدة', 'Nouvelle valeur', 'New value')}
      </Button>
      <Button size="sm" variant="subtle" icon={Search} onClick={onFind}>
        {tr('بحث', 'Rechercher', 'Find')}
      </Button>
      <Button size="sm" variant="subtle" icon={FileDown} onClick={onExport} busy={busy}>
        {tr('تصدير', 'Exporter', 'Export')}
      </Button>
    </>
  );
}

export interface RegStatusProps {
  readonly path: string;
  readonly values: number;
  readonly subkeys: number;
  readonly keys: number;
  readonly error: string | null;
}

export function RegStatus({ path, values, subkeys, keys, error }: RegStatusProps) {
  const { tr, lang } = useApp().locale;
  return (
    <>
      <StatusItem icon={Database} title={tr('المفتاح المحدّد', 'Clé sélectionnée', 'Selected key')}>
        {toLongPath(path)}
      </StatusItem>
      <StatusItem>
        {tr(
          `${fmt.integer(subkeys, lang)} مفتاح فرعي · ${fmt.integer(values, lang)} قيمة`,
          `${fmt.integer(subkeys, lang)} sous-clés · ${fmt.integer(values, lang)} valeurs`,
          `${fmt.integer(subkeys, lang)} subkeys · ${fmt.integer(values, lang)} values`,
        )}
      </StatusItem>
      {isVolatileKey(path) ? (
        <StatusItem tone="warning" title={tr('يُعاد بناؤه عند الإقلاع', 'Reconstruit au démarrage', 'Rebuilt at boot')}>
          {tr('مؤقّت', 'Volatile', 'Volatile')}
        </StatusItem>
      ) : null}
      {isMachineKey(path) ? (
        <StatusItem icon={ShieldAlert} tone="warning">
          {tr('يتطلّب موافقة', 'Consentement requis', 'Consent required')}
        </StatusItem>
      ) : null}
      {error === null ? null : <StatusItem tone="danger">{error}</StatusItem>}
      <ToolbarSpacer />
      <StatusItem title={tr('مفاتيح مقروءة', 'Clés lues', 'Keys walked')}>{fmt.integer(keys, lang)}</StatusItem>
    </>
  );
}

export interface KeyMenuProps {
  readonly x: number;
  readonly y: number;
  readonly path: string;
  readonly favorite: boolean;
  readonly canDelete: boolean;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

export function KeyMenu({ x, y, path, favorite, canDelete, onSelect, onDismiss }: KeyMenuProps) {
  const { tr } = useApp().locale;
  return (
    <MenuFlyout
      position="fixed"
      x={x}
      y={y}
      onSelect={onSelect}
      onDismiss={onDismiss}
      entries={[
        { id: 'newKey', label: tr('مفتاح جديد', 'Nouvelle clé', 'New key'), icon: FolderPlus },
        { id: 'new', label: tr('قيمة جديدة', 'Nouvelle valeur', 'New value'), icon: FilePlus2 },
        { id: 'sep0', kind: 'separator' },
        { id: 'copy', label: tr('نسخ اسم المفتاح', 'Copier le nom de la clé', 'Copy key name'), icon: ClipboardCopy },
        { id: 'export', label: tr('تصدير هذا الفرع', 'Exporter cette branche', 'Export this branch'), icon: FileDown },
        { id: 'sep', kind: 'separator' },
        {
          id: 'favorite',
          label: tr('مفضّلة', 'Favori', 'Favourite'),
          icon: Star,
          checked: favorite,
        },
        { id: 'sep2', kind: 'separator' },
        {
          id: 'delete',
          label: tr('حذف المفتاح', 'Supprimer la clé', 'Delete key'),
          icon: Trash2,
          danger: true,
          disabled: !canDelete,
          accelerator: keyName(path),
        },
      ]}
    />
  );
}

export interface ValueMenuProps {
  readonly x: number;
  readonly y: number;
  readonly entry: RegistryEntry;
  readonly onSelect: (id: string) => void;
  readonly onDismiss: () => void;
}

export function ValueMenu({ x, y, entry, onSelect, onDismiss }: ValueMenuProps) {
  const { tr } = useApp().locale;
  return (
    <MenuFlyout
      position="fixed"
      x={x}
      y={y}
      onSelect={onSelect}
      onDismiss={onDismiss}
      entries={[
        { id: 'modify', label: tr('تعديل', 'Modifier', 'Modify'), icon: Pencil, accelerator: entry.name },
        { id: 'copyName', label: tr('نسخ الاسم', 'Copier le nom', 'Copy name'), icon: ClipboardCopy },
        { id: 'copyData', label: tr('نسخ البيانات', 'Copier les données', 'Copy data'), icon: ClipboardCopy },
        { id: 'sep', kind: 'separator' },
        {
          id: 'delete',
          label: tr('حذف', 'Supprimer', 'Delete'),
          icon: Trash2,
          danger: true,
          disabled: entry.name === DEFAULT_VALUE_NAME,
        },
      ]}
    />
  );
}

export interface NewKeyDialogProps {
  readonly parent: string;
  /** Existing child names, so the new key cannot collide with one. */
  readonly taken: readonly string[];
  readonly busy: boolean;
  readonly onCommit: (name: string) => void;
  readonly onClose: () => void;
}

/**
 * New ▸ Key.
 *
 * A key in this hive exists because it holds a value — `registry.ts` drops one
 * that has none — so creating a key means writing its `(Default)` entry as unset.
 * That is not a workaround: it is what Windows shows you the moment a key is
 * created, a lone `(Default)` reading `(value not set)`.
 */
export function NewKeyDialog({ parent, taken, busy, onCommit, onClose }: NewKeyDialogProps) {
  const { tr } = useApp().locale;
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const error = trimmed === ''
    ? undefined
    : /[\\/]/.test(trimmed)
      ? tr('لا يمكن أن يحتوي الاسم على شرطة مائلة', 'Le nom ne peut pas contenir de barre oblique', 'A key name cannot contain a slash')
      : taken.some((candidate) => candidate.toLowerCase() === trimmed.toLowerCase())
        ? tr('يوجد مفتاح بهذا الاسم', 'Cette clé existe déjà', 'A key by that name is already here')
        : undefined;
  const commit = () => {
    if (trimmed !== '' && error === undefined) onCommit(trimmed);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={460}
      title={tr('مفتاح جديد', 'Nouvelle clé', 'New key')}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: tr('إنشاء', 'Créer', 'Create'),
        onClick: commit,
        disabled: trimmed === '' || error !== undefined,
        busy,
      }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <InfoBar tone={isMachineKey(parent) ? 'warning' : 'info'} title={toLongPath(parent)}>
          {tr(
            'يُنشأ المفتاح تحت هذا المسار، ويبدأ بقيمة افتراضية غير معيّنة.',
            'La clé est créée sous ce chemin, avec une valeur par défaut non définie.',
            'The key is created under this path, holding one unset default value.',
          )}
        </InfoBar>
        <Field label={tr('اسم المفتاح', 'Nom de la clé', 'Key name')} error={error}>
          <Input value={name} onChange={setName} mono onEnter={commit} autoFocus />
        </Field>
      </div>
    </Dialog>
  );
}

const ALL_SCOPES: FindScope = { keys: true, names: true, data: true };

export interface FindDialogProps {
  readonly hive: ReadonlyMap<string, readonly RegistryEntry[]>;
  readonly onPick: (hit: FindHit) => void;
  readonly onClose: () => void;
}

/**
 * Regedit has Find Next, which walks the tree one hit at a time because in 1995
 * it could not afford to hold the results. This holds the whole hive already, so
 * it shows the list — same search, minus the pressing of F3.
 */
export function FindDialog({ hive, onPick, onClose }: FindDialogProps) {
  const { tr } = useApp().locale;
  const [needle, setNeedle] = useState('');
  const [scope, setScope] = useState<FindScope>(ALL_SCOPES);

  const hits = useMemo(() => findAll(hive, needle, scope, FIND_LIMIT), [hive, needle, scope]);
  const empty = needle.trim() !== '' && hits.length === 0;

  return (
    <Dialog
      open
      onClose={onClose}
      width={620}
      title={tr('بحث في السجل', 'Rechercher dans le Registre', 'Find in registry')}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <Input
          value={needle}
          onChange={setNeedle}
          placeholder={tr('ابحث عن مفتاح أو قيمة أو بيانات', 'Clé, nom de valeur ou données', 'Key, value name or data')}
        />
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Checkbox
            checked={scope.keys}
            onChange={(next) => setScope((current) => ({ ...current, keys: next }))}
            label={tr('أسماء المفاتيح', 'Noms de clés', 'Key names')}
          />
          <Checkbox
            checked={scope.names}
            onChange={(next) => setScope((current) => ({ ...current, names: next }))}
            label={tr('أسماء القيم', 'Noms de valeurs', 'Value names')}
          />
          <Checkbox
            checked={scope.data}
            onChange={(next) => setScope((current) => ({ ...current, data: next }))}
            label={tr('البيانات', 'Données', 'Data')}
          />
        </div>
        <div className="fx-scroll" style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 2 }}>
          {empty ? (
            <EmptyState
              compact
              icon={Search}
              title={tr('لا نتائج', 'Aucun résultat', 'No matches')}
              description={tr(
                'جرّب نطاقًا أوسع أو نصًا أقصر.',
                'Essayez une portée plus large ou un texte plus court.',
                'Try a wider scope, or a shorter piece of text.',
              )}
            />
          ) : (
            hits.map((hit) => (
              <NavItem
                key={`${hit.key}::${hit.name ?? ''}`}
                icon={Database}
                onClick={() => onPick(hit)}
                label={
                  <>
                    <span style={{ color: 'var(--fx-text-primary)' }}>{hit.name ?? keyName(hit.key)}</span>
                    <span style={{ color: 'var(--fx-text-tertiary)' }}>{`  ·  ${toLongPath(hit.key)}`}</span>
                  </>
                }
              />
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
