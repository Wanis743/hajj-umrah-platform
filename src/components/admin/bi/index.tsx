/**
 * The BI workspace: the one door into the semantic layer.
 *
 * Until this file existed every panel in this folder was unreachable. Nine components,
 * a compiler, a chart engine and a query ledger were all written, typechecked and
 * uncalled -- which is the shape of the failure the tenth item on the platform's own gap
 * list names: a feature is not built because its tables and its components exist, it is
 * built when somebody can open it.
 *
 * The tab order is the life of an analysis rather than the order the panels were written:
 * what exists (studio), what may be read (catalog), what it means (define), what is being
 * asked (builder), what was written down (reports, dashboards), what depends on it
 * (lineage), and what was actually run (log). A reader who works left to right is doing
 * the steps in the order they depend on each other.
 *
 * Only `studio` is eager. It is the landing tab, it is the one screen that is always
 * paid for, and it is also the only panel that navigates -- its tiles and its health
 * panel hand back a tab key, which is why `onOpenTab` exists at all. Everything else is
 * `lazy()`, because the chart engine, the compiler's filter editor and the drag-and-drop
 * shelves are a large amount of code to download for a reader who came to check six
 * health counters.
 */
import { lazy, Suspense, useState } from 'react';
import { Spinner } from '@/components/admin/ui';
import { SubTabs } from './atoms';
import { useBiI18n } from './biFormat';
import { BiStudioPanel } from './BiStudioPanel';

const BiDatasetPanel = lazy(() => import('./BiDatasetPanel')
  .then((m) => ({ default: m.BiDatasetPanel })));
const BiDefinitionsPanel = lazy(() => import('./BiDefinitionsPanel')
  .then((m) => ({ default: m.BiDefinitionsPanel })));
const BiAnalysisBuilder = lazy(() => import('./BiAnalysisBuilder')
  .then((m) => ({ default: m.BiAnalysisBuilder })));
const BiReportsPanel = lazy(() => import('./BiReportsPanel')
  .then((m) => ({ default: m.BiReportsPanel })));
const BiDashboardsPanel = lazy(() => import('./BiDashboardsPanel')
  .then((m) => ({ default: m.BiDashboardsPanel })));
const BiLineagePanel = lazy(() => import('./BiLineagePanel')
  .then((m) => ({ default: m.BiLineagePanel })));
const BiQueryLogPanel = lazy(() => import('./BiQueryLogPanel')
  .then((m) => ({ default: m.BiQueryLogPanel })));

/** The keys `BiStudioPanel` hands back through `onOpenTab`, plus the ones only the tab
 *  strip reaches. Not exported: this file exports a component, and
 *  `react-refresh/only-export-components` refuses a second export beside it. */
const TAB_KEYS = [
  'studio', 'catalog', 'define', 'builder', 'reports', 'dashboards', 'lineage', 'log',
] as const;
type BiTabKey = typeof TAB_KEYS[number];

/** `onOpenTab` is typed to `string` because the panels that call it must not import this
 *  file -- that would be a cycle. So the string is checked here, at the one place it
 *  crosses back into a key, and an unknown key changes nothing rather than blanking the
 *  workspace. */
function isTabKey(value: string): value is BiTabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

/** `BiStudioPanel` says `datasets` where this shell says `catalog`: the tile means "take
 *  me to the datasets", and the tab is named for what the screen is. One alias, resolved
 *  here, rather than renaming a key inside a finished panel. */
const TAB_ALIASES: Readonly<Record<string, BiTabKey>> = { datasets: 'catalog' };

export function BiWorkspace() {
  const { t } = useBiI18n();
  const [tab, setTab] = useState<BiTabKey>('studio');

  const open = (key: string) => {
    const resolved = TAB_ALIASES[key] ?? key;
    if (isTabKey(resolved)) setTab(resolved);
  };

  const tabs = [
    { key: 'studio', label: t('الاستوديو', 'Studio', 'Studio') },
    { key: 'catalog', label: t('الفهرس', 'Catalogue', 'Catalog') },
    { key: 'define', label: t('التعريفات', 'Définitions', 'Definitions') },
    { key: 'builder', label: t('التحليل', 'Analyse', 'Analysis') },
    { key: 'reports', label: t('التقارير', 'Rapports', 'Reports') },
    { key: 'dashboards', label: t('اللوحات', 'Tableaux de bord', 'Dashboards') },
    { key: 'lineage', label: t('الأثر', 'Traçabilité', 'Lineage') },
    { key: 'log', label: t('السجل', 'Journal', 'Query log') },
  ];

  return (
    <div>
      <SubTabs tabs={tabs} active={tab} onChange={open} />
      <Suspense fallback={<Spinner className="p-10" />}>
        {tab === 'studio' && <BiStudioPanel onOpenTab={open} />}
        {tab === 'catalog' && <BiDatasetPanel />}
        {tab === 'define' && <BiDefinitionsPanel />}
        {tab === 'builder' && <BiAnalysisBuilder />}
        {tab === 'reports' && <BiReportsPanel />}
        {tab === 'dashboards' && <BiDashboardsPanel />}
        {tab === 'lineage' && <BiLineagePanel />}
        {tab === 'log' && <BiQueryLogPanel />}
      </Suspense>
    </div>
  );
}
