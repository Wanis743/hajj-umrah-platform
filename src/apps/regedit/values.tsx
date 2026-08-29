/**
 * Registry Editor — the right-hand pane and the box that edits one value.
 *
 * The grid is the classic three columns: Name, Type, Data. The editor is the
 * dialog behind a double-click, and it keeps regedit's two rules — a value's name
 * and type are fixed once it exists, so changing either means deleting and
 * creating — which is also exactly what the ABI offers, since `registry.set`
 * addresses a value by name and would otherwise silently orphan the old one.
 *
 * The elevation note is not decoration. `HKCU` writes are exempt from the
 * kernel's consent gate and `HKLM` writes are not, so the dialog says which of
 * the two you are about to do before you press Save.
 */
import { useMemo, useState } from 'react';
import { Binary, Braces, Hash, List, type LucideIcon, Minus, ShieldAlert, Type as TypeIcon } from 'lucide-react';
import {
  type Column,
  DataGrid,
  type DataGridProps,
  Dialog,
  EmptyState,
  Field,
  InfoBar,
  Input,
  type RegistryEntry,
  type RegistryValue,
  Select,
  TextArea,
  fmt,
  useApp,
} from '@/platform/sdk';
import {
  DEFAULT_VALUE_NAME,
  KIND_HINT,
  KIND_LABEL,
  NEW_KINDS,
  type RegKind,
  displayData,
  isMachineKey,
  isVolatileKey,
  kindOf,
  parseData,
} from './catalog';

const ROW_HEIGHT = 28;

const KIND_ICON: Readonly<Record<RegKind, LucideIcon>> = {
  REG_SZ: TypeIcon,
  REG_DWORD: Hash,
  REG_NUMBER: Hash,
  REG_BOOL: Binary,
  REG_MULTI_SZ: List,
  REG_NONE: Minus,
};

export interface ValueGridProps {
  readonly rows: readonly RegistryEntry[];
  readonly loading: boolean;
  readonly selection: ReadonlySet<string>;
  readonly onSelectionChange: (keys: ReadonlySet<string>) => void;
  readonly onActivate: (entry: RegistryEntry) => void;
  readonly onContextMenu: DataGridProps<RegistryEntry>['onRowContextMenu'];
}

export function ValueGrid({ rows, loading, selection, onSelectionChange, onActivate, onContextMenu }: ValueGridProps) {
  const { t, tr, lang } = useApp().locale;

  const columns = useMemo<readonly Column<RegistryEntry>[]>(
    () => [
      {
        id: 'name',
        header: tr('الاسم', 'Nom', 'Name'),
        width: 232,
        sort: (a, b) => a.name.localeCompare(b.name),
        render: (entry) => {
          const Glyph = KIND_ICON[kindOf(entry.value)];
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Glyph size={13} style={{ flex: 'none', color: 'var(--fx-text-tertiary)' }} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontStyle: entry.name === DEFAULT_VALUE_NAME ? 'italic' : undefined,
                }}
              >
                {entry.name}
              </span>
            </span>
          );
        },
      },
      {
        id: 'kind',
        header: tr('النوع', 'Type', 'Type'),
        width: 132,
        mono: true,
        sort: (a, b) => KIND_LABEL[kindOf(a.value)].localeCompare(KIND_LABEL[kindOf(b.value)]),
        render: (entry) => KIND_LABEL[kindOf(entry.value)],
      },
      {
        id: 'data',
        header: tr('البيانات', 'Données', 'Data'),
        sort: (a, b) => (displayData(a.value) ?? '').localeCompare(displayData(b.value) ?? ''),
        render: (entry) => {
          const shown = displayData(entry.value);
          if (shown === null) {
            return (
              <span style={{ color: 'var(--fx-text-tertiary)' }}>
                {tr('(القيمة غير معيّنة)', '(valeur non définie)', '(value not set)')}
              </span>
            );
          }
          return (
            <span
              title={`${shown}\n${fmt.dateTime(entry.modifiedAt, lang)}`}
              style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {shown}
            </span>
          );
        },
      },
    ],
    [tr, lang],
  );

  return (
    <DataGrid<RegistryEntry>
      rows={rows}
      columns={columns}
      rowKey={(entry) => entry.name}
      selectedKeys={selection}
      onSelectionChange={onSelectionChange}
      onActivate={onActivate}
      onRowContextMenu={onContextMenu}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      loading={loading}
      empty={
        <EmptyState
          icon={Braces}
          title={tr('لا قيم في هذا المفتاح', 'Aucune valeur', 'This key holds no values')}
          description={t({
            ar: 'المفاتيح الوسيطة لا تحمل قيمًا — اختر مفتاحًا فرعيًا أو أنشئ قيمة جديدة.',
            fr: 'Une clé intermédiaire ne porte pas de valeurs — ouvrez une sous-clé ou créez une valeur.',
            en: 'Intermediate keys carry no values of their own — open a subkey, or create one here.',
          })}
        />
      }
    />
  );
}

/** What the dialog is working on. `mode` decides which fields are frozen. */
export interface EditorTarget {
  readonly mode: 'new' | 'edit';
  readonly key: string;
  readonly name: string;
  readonly kind: RegKind;
  readonly text: string;
}

export interface ValueEditorProps {
  readonly target: EditorTarget;
  /** Names already present in the key, so a new value cannot shadow one. */
  readonly taken: readonly string[];
  readonly busy: boolean;
  readonly onCommit: (name: string, value: RegistryValue) => void;
  readonly onClose: () => void;
}

export function ValueEditor({ target, taken, busy, onCommit, onClose }: ValueEditorProps) {
  const { t, tr } = useApp().locale;
  const [name, setName] = useState(target.name);
  const [kind, setKind] = useState<RegKind>(target.kind);
  const [text, setText] = useState(target.text);

  const creating = target.mode === 'new';
  const trimmed = name.trim();
  const collides = creating && taken.some((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
  const parsed = parseData(kind, text);
  const nameError = trimmed === ''
    ? tr('الاسم مطلوب', 'Le nom est requis', 'A name is required')
    : collides
      ? tr('يوجد اسم مطابق', 'Ce nom existe déjà', 'That name already exists here')
      : undefined;
  const dataError = parsed.ok
    ? undefined
    : kind === 'REG_DWORD'
      ? tr('عدد صحيح بين 0 و 4294967295', 'Entier entre 0 et 4294967295', 'A whole number from 0 to 4294967295')
      : tr('قيمة غير صالحة', 'Valeur invalide', 'Not a valid value');

  const commit = () => {
    if (nameError !== undefined || !parsed.ok) return;
    onCommit(trimmed, parsed.value);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={520}
      title={creating ? tr('قيمة جديدة', 'Nouvelle valeur', 'New value') : tr('تحرير القيمة', 'Modifier la valeur', 'Edit value')}
      secondaryLabel={tr('إلغاء', 'Annuler', 'Cancel')}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: commit,
        disabled: nameError !== undefined || !parsed.ok,
        busy,
      }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <InfoBar
          tone={isMachineKey(target.key) ? 'warning' : 'info'}
          icon={isMachineKey(target.key) ? ShieldAlert : undefined}
          title={target.key}
        >
          {isMachineKey(target.key)
            ? tr(
                'مفتاح على مستوى الجهاز — سيطلب النظام تأكيدًا قبل الكتابة.',
                'Clé au niveau machine — le système demandera votre accord avant d’écrire.',
                'A machine-wide key: the system asks for consent before this write lands.',
              )
            : tr(
                'مفتاح خاص بالمستخدم — يُكتب دون مطالبة.',
                'Clé propre à l’utilisateur — écrite sans invite.',
                'A per-user key: this write applies without a prompt.',
              )}
        </InfoBar>

        {isVolatileKey(target.key) ? (
          <InfoBar tone="warning">
            {tr(
              'يُعاد بناء فرع الخدمات عند كل إقلاع، فلن يبقى هذا التعديل بعد إعادة التشغيل.',
              'La branche des services est reconstruite à chaque démarrage : cette modification ne survivra pas au redémarrage.',
              'The services branch is rebuilt at every boot, so this change will not survive a restart.',
            )}
          </InfoBar>
        ) : null}

        <Field label={tr('اسم القيمة', 'Nom de la valeur', 'Value name')} error={creating ? nameError : undefined}>
          <Input
            value={name}
            onChange={setName}
            disabled={!creating}
            mono
            placeholder={DEFAULT_VALUE_NAME}
            onEnter={commit}
          />
        </Field>

        <Field
          label={tr('النوع', 'Type', 'Type')}
          hint={creating ? t(KIND_HINT[kind]) : tr('لا يمكن تغيير نوع قيمة قائمة', 'Le type d’une valeur existante est figé', 'An existing value keeps its type')}
        >
          <Select
            value={kind}
            onChange={(next) => setKind(next as RegKind)}
            disabled={!creating}
            options={NEW_KINDS.map((candidate) => ({ value: candidate, label: KIND_LABEL[candidate] }))}
          />
        </Field>

        <Field label={tr('البيانات', 'Données', 'Value data')} error={dataError} hint={hintFor(kind, tr)}>
          {kind === 'REG_MULTI_SZ' ? (
            <TextArea value={text} onChange={setText} rows={5} mono />
          ) : kind === 'REG_BOOL' ? (
            <Select
              value={text.trim().toLowerCase() === 'true' ? 'true' : 'false'}
              onChange={setText}
              options={[
                { value: 'true', label: 'true' },
                { value: 'false', label: 'false' },
              ]}
            />
          ) : (
            <Input value={text} onChange={setText} mono={kind !== 'REG_SZ'} onEnter={commit} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function hintFor(kind: RegKind, tr: (ar: string, fr: string, en: string) => string): string | undefined {
  if (kind === 'REG_MULTI_SZ') return tr('سطر لكل عنصر', 'Une chaîne par ligne', 'One string per line');
  if (kind === 'REG_DWORD') return tr('عشري أو ست عشري بالبادئة 0x', 'Décimal, ou hexadécimal préfixé 0x', 'Decimal, or hex with a 0x prefix');
  return undefined;
}
