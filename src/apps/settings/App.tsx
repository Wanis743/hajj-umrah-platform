/**
 * Settings — the shell.
 *
 * Seven pages behind a Windows 11 nav rail, and nothing more: each page owns its
 * own reads and writes, so leaving Storage stops the volume poll and arriving
 * there starts one. The only state this file keeps is which page is showing.
 *
 * The search box is a filter over the rail rather than an index. Windows finds a
 * setting by its name *and* by the words people actually type, so every entry
 * carries a few keywords in all three languages and the match is case-blind.
 */
import { Fragment, useState, type ComponentType } from 'react';
import { Globe, HardDrive, Info, type LucideIcon, Monitor, Package, Palette, UserRound } from 'lucide-react';
import {
  AppFrame,
  type AppEntryProps,
  Breadcrumb,
  type BreadcrumbSegment,
  type Localized,
  NavGroupLabel,
  NavItem,
  SearchBox,
  StatusItem,
  ToolbarSpacer,
  useAppCommands,
  usePolledSyscall,
  useWindowTitle,
} from '@/platform/sdk';
import { AccountPage, LanguagePage } from './account';
import { AppsPage } from './apps';
import { PersonalizationPage } from './personalization';
import { KEYS, entryText } from './prefs';
import { AboutPage, StoragePage, SystemPage } from './system';

/** Identity and machine name are read once: the rail shows a name, not a feed. */
const ONCE = 0;

type Page = 'system' | 'personalization' | 'language' | 'storage' | 'account' | 'apps' | 'about';

interface Entry {
  readonly page: Page;
  readonly icon: LucideIcon;
  readonly label: Localized;
  /** What the search box matches besides the label. */
  readonly keywords: string;
}

interface Group {
  readonly title: Localized;
  readonly entries: readonly Entry[];
}

const GROUPS: readonly Group[] = [
  {
    title: { ar: 'النظام', fr: 'Système', en: 'System' },
    entries: [
      {
        page: 'system',
        icon: Monitor,
        label: { ar: 'النظام', fr: 'Système', en: 'System' },
        keywords: 'cpu memory uptime power shutdown restart sleep lock معالج ذاكرة طاقة إيقاف قفل processeur mémoire alimentation arrêt verrouillage',
      },
      {
        page: 'storage',
        icon: HardDrive,
        label: { ar: 'التخزين', fr: 'Stockage', en: 'Storage' },
        keywords: 'disk drive volume quota free space قرص أقراص مساحة حصة disque volume espace',
      },
      {
        page: 'apps',
        icon: Package,
        label: { ar: 'التطبيقات', fr: 'Applications', en: 'Apps' },
        keywords: 'installed default programs association file type مثبّت افتراضي ارتباط نوع installées défaut association type',
      },
    ],
  },
  {
    title: { ar: 'التخصيص', fr: 'Personnalisation', en: 'Personalisation' },
    entries: [
      {
        page: 'personalization',
        icon: Palette,
        label: { ar: 'التخصيص', fr: 'Personnalisation', en: 'Personalisation' },
        keywords: 'theme dark light accent colour wallpaper taskbar start icons سمة داكن فاتح لون خلفية شريط المهام ابدأ أيقونات thème sombre clair couleur fond barre démarrer icônes',
      },
      {
        page: 'language',
        icon: Globe,
        label: { ar: 'اللغة والمنطقة', fr: 'Langue et région', en: 'Language & region' },
        keywords: 'language region format currency number date rtl لغة منطقة تنسيق عملة رقم تاريخ langue région format devise nombre date',
      },
    ],
  },
  {
    title: { ar: 'الحساب', fr: 'Compte', en: 'Account' },
    entries: [
      {
        page: 'account',
        icon: UserRound,
        label: { ar: 'الحساب', fr: 'Compte', en: 'Account' },
        keywords: 'user sid role agency branch elevation consent privilege مستخدم دور وكالة فرع صلاحية موافقة utilisateur rôle agence succursale privilège consentement',
      },
      {
        page: 'about',
        icon: Info,
        label: { ar: 'حول النظام', fr: 'À propos', en: 'About' },
        keywords: 'build version device name boot handles processes إصدار جهاز إقلاع مؤشرات عمليات version appareil démarrage descripteurs processus',
      },
    ],
  },
];

/** One page per rail entry; the map keeps the render a lookup instead of a ladder. */
const PANELS: Readonly<Record<Page, ComponentType>> = {
  system: SystemPage,
  personalization: PersonalizationPage,
  language: LanguagePage,
  storage: StoragePage,
  account: AccountPage,
  apps: AppsPage,
  about: AboutPage,
};

const ALL: readonly Entry[] = GROUPS.flatMap((group) => group.entries);

/** The account tile has to truncate: a display name is not a fixed width. */
const CLIP = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export default function SettingsApp({ runtime }: AppEntryProps) {
  const { t, tr } = runtime.locale;
  const [page, setPage] = useState<Page>('system');
  const [query, setQuery] = useState('');
  const principal = usePolledSyscall('security.principal', {}, ONCE).data;
  const policy = usePolledSyscall('registry.enumValues', { key: KEYS.policy }, ONCE).data;

  useWindowTitle(tr('الإعدادات', 'Paramètres', 'Settings'));

  // Jump-list and palette entries arrive as `page:<name>`, warm or cold.
  useAppCommands((command) => {
    const requested = ALL.find((entry) => command === `page:${entry.page}`);
    if (requested !== undefined) setPage(requested.page);
  });

  const needle = query.trim().toLowerCase();
  const matches = ALL.filter((entry) => `${t(entry.label)} ${entry.keywords}`.toLowerCase().includes(needle));
  const active = ALL.find((entry) => entry.page === page);
  const activeLabel = active === undefined ? '' : t(active.label);

  const railItem = (entry: Entry) => (
    <NavItem
      key={entry.page}
      icon={entry.icon}
      label={t(entry.label)}
      selected={page === entry.page}
      onClick={() => setPage(entry.page)}
    />
  );

  const nav = (
    <>
      <div style={{ padding: '2px 2px 8px' }}>
        <SearchBox
          value={query}
          onChange={setQuery}
          width="100%"
          placeholder={tr('ابحث في الإعدادات', 'Rechercher un paramètre', 'Find a setting')}
        />
      </div>
      {principal === null ? null : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 8px 10px' }}>
          <div
            style={{
              width: 32,
              height: 32,
              flex: 'none',
              borderRadius: 999,
              background: 'var(--fx-accent)',
              color: 'var(--fx-on-accent)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 600,
            }}
          >
            {principal.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fx-body)', ...CLIP }}>{principal.displayName}</div>
            <div style={{ fontSize: 11, color: 'var(--fx-text-tertiary)', ...CLIP }}>
              {principal.email ?? String(principal.sid)}
            </div>
          </div>
        </div>
      )}
      {needle === '' ? (
        GROUPS.map((group) => (
          <Fragment key={group.title.en}>
            <NavGroupLabel>{t(group.title)}</NavGroupLabel>
            {group.entries.map(railItem)}
          </Fragment>
        ))
      ) : (
        <>
          <NavGroupLabel>{tr('النتائج', 'Résultats', 'Results')}</NavGroupLabel>
          {matches.length === 0 ? (
            <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--fx-text-tertiary)' }}>
              {tr('لا نتائج', 'Aucun résultat', 'No matches')}
            </div>
          ) : (
            matches.map(railItem)
          )}
        </>
      )}
    </>
  );

  // The home crumb *is* the System page, so it collapses to one segment there
  // rather than repeating itself.
  const home: BreadcrumbSegment = { label: tr('الإعدادات', 'Paramètres', 'Settings'), value: 'system' };
  const crumbs: readonly BreadcrumbSegment[] =
    page === 'system' ? [home] : [home, { label: activeLabel, value: page }];

  const commands = (
    <Breadcrumb
      segments={crumbs}
      onNavigate={(value) => {
        const target = ALL.find((entry) => entry.page === value);
        if (target !== undefined) setPage(target.page);
      }}
    />
  );

  const status = (
    <>
      <StatusItem icon={Monitor} title={tr('اسم الجهاز', 'Nom de l’appareil', 'Device name')}>
        {entryText(policy, 'MachineName', 'FINANCE-OS')}
      </StatusItem>
      <StatusItem>
        {`${entryText(policy, 'ProductName', 'FinanceOS 11')} · ${entryText(policy, 'Build', '—')}`}
      </StatusItem>
      <ToolbarSpacer />
      <StatusItem>{activeLabel}</StatusItem>
    </>
  );

  const Panel = PANELS[page];
  return (
    <AppFrame commands={commands} nav={nav} navWidth={252} status={status} padded>
      <Panel />
    </AppFrame>
  );
}
