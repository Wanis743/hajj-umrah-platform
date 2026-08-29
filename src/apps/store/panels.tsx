/**
 * Store — the tiles, the detail pane and the install history.
 *
 * Every fact on screen comes from the inventory or from the event log. There are
 * no ratings, no download sizes, no screenshots and no "recommended for you",
 * because there is no network behind this image and inventing any of that would
 * make the one honest surface in the OS the one that lies. What is left turns out
 * to be more useful than a shopfront: what the app declares it can do, whether
 * that costs a consent prompt, which file types it claims, how often it has
 * actually been opened, and when it arrived.
 */
import type { ReactNode } from 'react';
import {
  CalendarClock,
  CircleSlash,
  Clock,
  FileType2,
  KeyRound,
  type LucideIcon,
  Package,
  PackageMinus,
  PackagePlus,
  Pin,
  PinOff,
  Play,
  Rocket,
  ShieldAlert,
  Tag,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  type Column,
  DataGrid,
  EmptyState,
  type EventRecord,
  InfoBar,
  PropertyRow,
  capabilityLabel,
  fmt,
  glyphFor,
  logoFor,
  useApp,
} from '@/platform/sdk';
import { categoryLabel } from '../shared/categories';
import { type StoreActions, type StoreEntry, canRemove, permissions } from './catalog';

/** The app glyph, in the tinted rounded square Windows 11 uses for a tile. */
function AppGlyph({ icon, size }: { icon: string; size: number }) {
  const logo = logoFor(icon);
  // A shipped logo replaces the plate here exactly as it does on a Start tile,
  // so the catalogue shows an app the way the desktop will.
  if (logo !== null) {
    return (
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ width: size, height: size, flex: 'none', objectFit: 'contain' }}
      />
    );
  }
  const Glyph = glyphFor(icon);
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--fx-radius-control)',
        background: 'var(--fx-card-secondary)',
        border: '1px solid var(--fx-stroke-card)',
        color: 'var(--fx-accent-text)',
      }}
    >
      <Glyph size={Math.round(size * 0.52)} strokeWidth={1.6} />
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The catalogue grid
 * ------------------------------------------------------------------ */

export interface AppTileProps {
  entry: StoreEntry;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

/**
 * One app as a card.
 *
 * A button rather than a div: the grid is navigable by keyboard and every tile is
 * the same single action — select. Double-click opens, the way Start's tiles and
 * Explorer's items already behave.
 */
export function AppTile({ entry, selected, onSelect, onOpen }: AppTileProps) {
  const { t, tr, lang } = useApp().locale;
  const { manifest, record } = entry;

  return (
    <button
      type="button"
      className="fx-card"
      onClick={onSelect}
      onDoubleClick={record === null ? undefined : onOpen}
      title={t(manifest.description)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        textAlign: 'start',
        cursor: 'pointer',
        borderColor: selected ? 'var(--fx-accent)' : undefined,
        boxShadow: selected ? 'var(--fx-shadow-card)' : undefined,
        opacity: record === null ? 0.72 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minWidth: 0 }}>
        <AppGlyph icon={manifest.icon} size={44} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: 'block',
              fontSize: 'var(--fx-body)',
              fontWeight: 600,
              color: 'var(--fx-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t(manifest.name)}
          </span>
          <span style={{ display: 'block', fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
            {manifest.publisher}
          </span>
        </span>
        {record?.pinned === true ? <Pin size={13} style={{ flex: 'none', color: 'var(--fx-accent-text)' }} /> : null}
      </div>

      <span
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          fontSize: 'var(--fx-caption)',
          color: 'var(--fx-text-secondary)',
          lineHeight: 1.5,
          minHeight: 34,
        }}
      >
        {t(manifest.description)}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', width: '100%' }}>
        <Badge tone="neutral">{t(categoryLabel(manifest.category))}</Badge>
        {record === null ? (
          <Badge tone="warning" icon={CircleSlash}>
            {tr('غير مثبّت', 'Non installée', 'Not installed')}
          </Badge>
        ) : record.launches > 0 ? (
          <Badge tone="info" icon={Rocket} title={tr('عدد مرات التشغيل', 'Nombre de lancements', 'Times launched')}>
            {fmt.integer(record.launches, lang)}
          </Badge>
        ) : null}
        {record !== null && !record.enabled ? (
          <Badge tone="danger">{tr('معطّل بسياسة', 'Désactivée par la stratégie', 'Disabled by policy')}</Badge>
        ) : null}
      </span>
    </button>
  );
}

export interface AppGridProps {
  entries: readonly StoreEntry[];
  selectedId: string | null;
  onSelect: (entry: StoreEntry) => void;
  onOpen: (entry: StoreEntry) => void;
  empty: ReactNode;
}

export function AppGrid({ entries, selectedId, onSelect, onOpen, empty }: AppGridProps) {
  if (entries.length === 0) return <>{empty}</>;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))',
        gap: 12,
        alignContent: 'start',
      }}
    >
      {entries.map((entry) => (
        <AppTile
          key={String(entry.manifest.id)}
          entry={entry}
          selected={String(entry.manifest.id) === selectedId}
          onSelect={() => onSelect(entry)}
          onOpen={() => onOpen(entry)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The detail pane
 * ------------------------------------------------------------------ */

/** A labelled block inside the pane — quieter than `Section`, which is page-scale. */
function Group({ icon: Glyph, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--fx-text-tertiary)',
        }}
      >
        <Glyph size={12} />
        {title}
      </div>
      {children}
    </div>
  );
}

/** Caption-weight text for the pane — used for "none", hints and consequences. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)', lineHeight: 1.5 }}>{children}</div>
  );
}

/**
 * The capability disclosure.
 *
 * The privileged ones are marked because they behave differently: the kernel
 * stops the syscall and asks the user before it runs. That is the only permission
 * distinction the OS actually makes, so it is the only one shown.
 */
function PermissionList({ entry }: { entry: StoreEntry }) {
  const { t, tr } = useApp().locale;
  const rows = permissions(entry.manifest);
  if (rows.length === 0) {
    return <Hint>{tr('لا أذونات مطلوبة.', 'Aucune autorisation requise.', 'No permissions requested.')}</Hint>;
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((row) => (
        <div key={row.capability} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge
            tone={row.privileged ? 'warning' : 'neutral'}
            icon={row.privileged ? ShieldAlert : KeyRound}
            title={row.capability}
          >
            {t(capabilityLabel(row.capability))}
          </Badge>
          {row.privileged ? (
            <span style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
              {tr('يطلب موافقتك', 'Demande votre accord', 'Asks your approval')}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function FileTypeList({ entry }: { entry: StoreEntry }) {
  const { tr } = useApp().locale;
  const associations = entry.manifest.fileAssociations ?? [];
  if (associations.length === 0) {
    return <Hint>{tr('لا يفتح أي نوع ملف.', 'N’ouvre aucun type de fichier.', 'Opens no file types.')}</Hint>;
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {associations.map((association) => (
        <div key={association.contentType} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {association.extensions.map((extension) => (
            <Badge key={extension} tone="info">
              {extension}
            </Badge>
          ))}
          <span className="fx-mono" style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
            {association.contentType}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The jump list, which is what the taskbar shows on right-click. */
function CommandList({ entry }: { entry: StoreEntry }) {
  const { t, tr } = useApp().locale;
  const commands = entry.manifest.jumpList ?? entry.manifest.commands ?? [];
  if (commands.length === 0) {
    return <Hint>{tr('لا أوامر معلنة.', 'Aucune commande déclarée.', 'No declared commands.')}</Hint>;
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {commands.map((command) => (
        <div
          key={command.id}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fx-caption)' }}
        >
          <span style={{ flex: 1, minWidth: 0, color: 'var(--fx-text-secondary)' }}>{t(command.title)}</span>
          {command.accelerator === undefined ? null : <span className="fx-kbd">{command.accelerator}</span>}
        </div>
      ))}
    </div>
  );
}

export interface AppDetailsProps {
  entry: StoreEntry | null;
  actions: StoreActions;
  /** The principal may rewrite the machine hive — install and remove. */
  canManage: boolean;
  /** …and doing so raises a consent prompt first. */
  managePrompts: boolean;
  /** The principal may save per-user settings — taskbar pins. */
  canPin: boolean;
}

function DetailHeader({ entry }: { entry: StoreEntry }) {
  const { t } = useApp().locale;
  const { manifest } = entry;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <AppGlyph icon={manifest.icon} size={56} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--fx-font-display)', fontSize: 'var(--fx-subtitle)', fontWeight: 600 }}>
          {t(manifest.name)}
        </div>
        <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>
          {manifest.publisher} · {manifest.version}
        </div>
      </div>
    </div>
  );
}

function DetailActions({ entry, actions, canManage, canPin }: Omit<AppDetailsProps, 'entry' | 'managePrompts'> & { entry: StoreEntry }) {
  const { tr } = useApp().locale;
  const { busy } = actions;
  const installed = entry.record !== null;
  const pinned = entry.record?.pinned === true;
  const running = (kind: string) => busy !== null && busy.appId === entry.manifest.id && busy.kind === kind;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {installed ? (
        <Button variant="accent" icon={Play} busy={running('open')} onClick={() => actions.open(entry)}>
          {tr('تشغيل', 'Ouvrir', 'Open')}
        </Button>
      ) : (
        <Button
          variant="accent"
          icon={PackagePlus}
          busy={running('install')}
          disabled={!canManage}
          onClick={() => actions.install(entry)}
        >
          {tr('تثبيت', 'Installer', 'Install')}
        </Button>
      )}
      {installed ? (
        <Button
          icon={pinned ? PinOff : Pin}
          busy={running('pin')}
          disabled={!canPin}
          onClick={() => actions.togglePin(entry)}
        >
          {pinned ? tr('إلغاء التثبيت', 'Détacher', 'Unpin') : tr('تثبيت بالشريط', 'Épingler', 'Pin')}
        </Button>
      ) : null}
      {installed ? (
        <Button
          variant="subtle"
          icon={PackageMinus}
          busy={running('remove')}
          disabled={!canRemove(entry) || !canManage}
          onClick={() => actions.remove(entry)}
        >
          {tr('إزالة', 'Supprimer', 'Remove')}
        </Button>
      ) : null}
    </div>
  );
}

/** What the buttons above will and will not do, said before they are pressed. */
function DetailNotices({ entry, canManage, managePrompts }: { entry: StoreEntry; canManage: boolean; managePrompts: boolean }) {
  const { tr } = useApp().locale;
  const { manifest, record } = entry;
  return (
    <>
      {record === null ? (
        <InfoBar tone="info" icon={Package} title={tr('في مكتبتك', 'Dans votre bibliothèque', 'In your library')}>
          {tr(
            'حزمة التثبيت تُشحن مع النظام، فإعادة التثبيت فورية ولا تحتاج أي تنزيل.',
            'Le paquet d’installation est fourni avec le système : la réinstallation est immédiate, sans téléchargement.',
            'The installation package ships with the system, so installing it again is immediate and downloads nothing.',
          )}
        </InfoBar>
      ) : null}
      {record !== null && manifest.systemComponent ? (
        <InfoBar tone="info" icon={ShieldAlert} title={tr('مكوّن نظام', 'Composant système', 'System component')}>
          {tr(
            'يُشحن هذا التطبيق مع صورة النظام ولا يمكن إزالته.',
            'Cette application fait partie de l’image système et ne peut pas être supprimée.',
            'This app ships with the system image and cannot be removed.',
          )}
        </InfoBar>
      ) : null}
      {record !== null && !record.enabled ? (
        <InfoBar tone="danger" icon={CircleSlash} title={tr('معطّل بسياسة', 'Désactivée par la stratégie', 'Disabled by policy')}>
          {tr(
            'يبقى مثبّتًا لكنه لا يعمل حتى تُزال السياسة.',
            'Elle reste installée mais ne démarre pas tant que la stratégie s’applique.',
            'It stays installed but will not launch while the policy applies.',
          )}
        </InfoBar>
      ) : null}
      {!canManage ? (
        <InfoBar tone="warning" title={tr('صلاحية غير متوفرة', 'Autorisation manquante', 'Permission unavailable')}>
          {tr(
            'دورك الحالي لا يسمح بتعديل البرامج المثبّتة.',
            'Votre rôle actuel ne permet pas de modifier les logiciels installés.',
            'Your current role cannot change installed software.',
          )}
        </InfoBar>
      ) : managePrompts ? (
        <Hint>
          {tr(
            'التثبيت والإزالة يكتبان في سجل النظام، فيطلب النظام موافقتك أولًا.',
            'Installer ou supprimer écrit dans le registre système : le système demandera d’abord votre accord.',
            'Installing or removing writes to the system registry, so the system asks for your approval first.',
          )}
        </Hint>
      ) : null}
    </>
  );
}

/**
 * Everything the OS knows about one app.
 *
 * Read top to bottom this is: what it is, what you can do with it, what the OS
 * will interrupt you for, what it declares, and how you have actually used it.
 * The "usage" block is the part a real store cannot show and this one can — the
 * launch count is the kernel's, not a publisher's claim.
 */
export function AppDetails({ entry, actions, canManage, managePrompts, canPin }: AppDetailsProps) {
  const { t, tr, lang } = useApp().locale;

  if (entry === null) {
    return (
      <EmptyState
        compact
        icon={Package}
        title={tr('لم يُحدَّد تطبيق', 'Aucune application sélectionnée', 'No app selected')}
        description={tr(
          'اختر تطبيقًا لعرض أذوناته وتفاصيله.',
          'Choisissez une application pour voir ses autorisations et ses détails.',
          'Pick an app to see its permissions and details.',
        )}
      />
    );
  }

  const { manifest, record } = entry;

  return (
    <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
      <DetailHeader entry={entry} />
      <DetailActions entry={entry} actions={actions} canManage={canManage} canPin={canPin} />
      <DetailNotices entry={entry} canManage={canManage} managePrompts={managePrompts} />

      <Group icon={Tag} title={tr('حول', 'À propos', 'About')}>
        <div>
          <PropertyRow label={tr('الإصدار', 'Version', 'Version')} mono>
            {manifest.version}
          </PropertyRow>
          <PropertyRow label={tr('الناشر', 'Éditeur', 'Publisher')}>{manifest.publisher}</PropertyRow>
          <PropertyRow label={tr('الفئة', 'Catégorie', 'Category')}>
            {t(categoryLabel(manifest.category))}
          </PropertyRow>
          <PropertyRow label={tr('المعرّف', 'Identifiant', 'App id')} mono>
            {String(manifest.id)}
          </PropertyRow>
          <PropertyRow label={tr('حجم النافذة', 'Taille de fenêtre', 'Window size')} mono>
            {manifest.defaultSize.w} × {manifest.defaultSize.h}
          </PropertyRow>
          <PropertyRow label={tr('نسخة واحدة', 'Instance unique', 'Single instance')}>
            {manifest.singleInstance ? tr('نعم', 'Oui', 'Yes') : tr('لا', 'Non', 'No')}
          </PropertyRow>
        </div>
      </Group>

      <Group icon={Clock} title={tr('الاستخدام', 'Utilisation', 'Usage')}>
        {record === null ? (
          <Hint>
            {tr(
              'غير مثبّت حاليًا، فلا يوجد استخدام مسجّل.',
              'Non installée : aucun usage enregistré.',
              'Not installed, so there is no recorded usage.',
            )}
          </Hint>
        ) : (
          <div>
            <PropertyRow label={tr('تاريخ التثبيت', 'Installée le', 'Installed')}>
              {fmt.dateTime(record.installedAt, lang)}
            </PropertyRow>
            <PropertyRow label={tr('آخر تشغيل', 'Dernier lancement', 'Last used')}>
              {record.lastLaunchedAt === null
                ? tr('لم يُشغَّل بعد', 'Jamais lancée', 'Never')
                : fmt.relativeTime(record.lastLaunchedAt, lang)}
            </PropertyRow>
            <PropertyRow label={tr('عدد مرات التشغيل', 'Lancements', 'Times launched')}>
              {fmt.integer(record.launches, lang)}
            </PropertyRow>
            <PropertyRow label={tr('على شريط المهام', 'Épinglée', 'Pinned')}>
              {record.pinned ? tr('نعم', 'Oui', 'Yes') : tr('لا', 'Non', 'No')}
            </PropertyRow>
          </div>
        )}
      </Group>

      <Group icon={ShieldAlert} title={tr('الأذونات', 'Autorisations', 'Permissions')}>
        <PermissionList entry={entry} />
      </Group>

      <Group icon={FileType2} title={tr('أنواع الملفات', 'Types de fichiers', 'File types')}>
        <FileTypeList entry={entry} />
      </Group>

      <Group icon={Play} title={tr('الأوامر', 'Commandes', 'Commands')}>
        <CommandList entry={entry} />
      </Group>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Nothing to show
 * ------------------------------------------------------------------ */

export interface GridEmptyProps {
  /** Which rail item is active — its glyph is the one that belongs here. */
  icon: LucideIcon;
  /** The live search text, so the message can say what found nothing. */
  needle: string;
  onClear: () => void;
}

/**
 * The two different kinds of nothing.
 *
 * An empty Library means every app is installed, which is good news and should
 * not read like a failure. An empty search means the needle is wrong, and the
 * only useful button is the one that removes it.
 */
export function GridEmpty({ icon, needle, onClear }: GridEmptyProps) {
  const { tr } = useApp().locale;
  const searching = needle.trim() !== '';

  if (!searching) {
    return (
      <EmptyState
        icon={icon}
        title={tr('لا شيء هنا', 'Rien ici', 'Nothing here')}
        description={tr(
          'كل تطبيق في هذا العرض في مكانه بالفعل.',
          'Toutes les applications de cette vue sont déjà à leur place.',
          'Every app in this view is already where you want it.',
        )}
      />
    );
  }

  return (
    <EmptyState
      icon={icon}
      title={tr('لا نتائج', 'Aucun résultat', 'No matches')}
      description={tr(
        `لا تطبيق يطابق «${needle}».`,
        `Aucune application ne correspond à « ${needle} ».`,
        `No app matches “${needle}”.`,
      )}
      action={
        <Button variant="subtle" onClick={onClear}>
          {tr('مسح البحث', 'Effacer la recherche', 'Clear search')}
        </Button>
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * Install history
 * ------------------------------------------------------------------ */

const INSTALLED_EVENT = 1033;

export interface InstallHistoryProps {
  rows: readonly EventRecord[];
  loading: boolean;
}

/**
 * The Setup channel, as a grid.
 *
 * This is not a synthesised "activity feed": these are the same records Event
 * Viewer shows, filtered to the two ids the app registry writes. If a row is
 * here, a hive key changed; if a change is missing, it never happened.
 */
export function InstallHistory({ rows, loading }: InstallHistoryProps) {
  const { tr, lang } = useApp().locale;

  const text = (value: string | number | boolean | null | undefined): string =>
    value === undefined || value === null ? '—' : String(value);

  const columns: readonly Column<EventRecord>[] = [
    {
      id: 'at',
      header: tr('الوقت', 'Horodatage', 'When'),
      width: 190,
      render: (row) => fmt.dateTime(row.at, lang),
      sort: (a, b) => Date.parse(a.at) - Date.parse(b.at),
    },
    {
      id: 'event',
      header: tr('الحدث', 'Évènement', 'Event'),
      width: 150,
      render: (row) =>
        row.eventId === INSTALLED_EVENT ? (
          <Badge tone="success" icon={PackagePlus}>
            {tr('تثبيت', 'Installation', 'Installed')}
          </Badge>
        ) : (
          <Badge tone="neutral" icon={PackageMinus}>
            {tr('إزالة', 'Suppression', 'Removed')}
          </Badge>
        ),
      sort: (a, b) => a.eventId - b.eventId,
    },
    {
      id: 'app',
      header: tr('التطبيق', 'Application', 'App'),
      mono: true,
      render: (row) => text(row.data?.appId),
      sort: (a, b) => text(a.data?.appId).localeCompare(text(b.data?.appId)),
    },
    {
      id: 'version',
      header: tr('الإصدار', 'Version', 'Version'),
      width: 110,
      mono: true,
      render: (row) => text(row.data?.version),
    },
  ];

  return (
    <Card
      padded={false}
      icon={CalendarClock}
      title={tr('سجل التثبيت', 'Historique d’installation', 'Install history')}
      subtitle={tr(
        'من قناة Setup في سجل الأحداث.',
        'Depuis le canal Setup du journal d’évènements.',
        'From the Setup channel of the event log.',
      )}
    >
      <DataGrid<EventRecord>
        rows={rows}
        columns={columns}
        rowKey={(row) => String(row.id)}
        loading={loading}
        density="compact"
        initialSort={{ columnId: 'at', direction: 'desc' }}
        empty={
          <EmptyState
            compact
            icon={CalendarClock}
            title={tr('لا سجل بعد', 'Aucun historique', 'No history yet')}
            description={tr(
              'لم يُثبّت أو يُزل أي تطبيق منذ إقلاع النظام.',
              'Aucune application installée ou supprimée depuis le démarrage.',
              'Nothing has been installed or removed since the system booted.',
            )}
          />
        }
      />
    </Card>
  );
}
