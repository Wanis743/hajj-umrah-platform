/**
 * The landing tab: how much there is, what is quietly wrong with it, who is reading
 * it, and what this caller may do about any of it.
 *
 * All five panels come from one read. `get_bi_studio_overview` answers with a single
 * jsonb object, so there is no partial state to compose here — either the overview
 * landed and everything below is drawn from it, or it did not and the pane says so
 * once rather than five times.
 *
 * ## Why the panels are in this order
 *
 * Counts, then health, then usage, then the datasets people actually open. That is
 * descending certainty: a count is a fact, a health number is a *suspicion* worth
 * checking, usage is only visible to some callers, and the top list is the one panel
 * that can legitimately be empty on a working install because nobody has run a query
 * yet.
 *
 * Powers come last and read as a list of grants rather than a warning. Seven booleans
 * the server answered, shown because a reader who cannot publish should learn it from
 * a panel and not from a refused button.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  Activity,
  Boxes,
  Database,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Ruler,
  ScrollText,
  Sigma,
  Stethoscope,
  Table2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
  Badge,
  Card,
  EmptyState,
  fmt,
  InfoBar,
  KpiTile,
  Spinner,
  useLocale,
  type Tone,
} from '@/platform/sdk';

import { Stamp } from './cells';
import { int, latency } from './format';
import { STATUS_LABEL } from './labels';
import type { BiShell } from './shell';
import { breachTone, healthTone, STATUS_TONE } from './tones';
import type { BiCounts, BiHealth, BiPowers, BiTopDataset, BiUsage } from './types';

/* ------------------------------------------------------------------ *
 * Furniture
 * ------------------------------------------------------------------ */

const STACK: CSSProperties = { display: 'grid', gap: 16 };

/** Tiles wrap on their own rather than at a fixed column count, because this pane is
 *  the one place in the app that is a scroller inside a variable-width content well:
 *  the rail may be 248px or gone, and a hard `repeat(4, …)` would overflow at the
 *  manifest's floor. */
const TILES: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
  gap: 12,
};

const CAPTION: CSSProperties = { color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' };

const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 0',
  borderTop: '1px solid var(--fx-divider)',
  minWidth: 0,
  cursor: 'default',
};

/** A number and what it counts, laid out as one line of a health list. The count is
 *  tabular so a column of them lines up without a table around it. */
const TALLY: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 0',
  borderTop: '1px solid var(--fx-divider)',
};

/* ------------------------------------------------------------------ *
 * The five panels
 * ------------------------------------------------------------------ */

interface CountTile {
  readonly icon: LucideIcon;
  readonly label: ReactNode;
  readonly value: number;
  readonly secondary?: ReactNode;
  readonly tone?: Tone;
}

/**
 * Twelve numbers as seven tiles.
 *
 * Datasets, metrics and dashboards each carry their published figure as the tile's
 * secondary line rather than as a tile of their own, because "9 datasets" and "4
 * published datasets" side by side read as thirteen datasets. The four that stand
 * alone — sources, dimensions, reports, analyses — have no second number to fold.
 */
function Counts({ counts }: { counts: BiCounts }): ReactElement {
  const { tr, lang } = useLocale();
  const published = (n: number): string =>
    tr(`${int(n, lang)} منشورة`, `${int(n, lang)} publiés`, `${int(n, lang)} published`);

  const tiles: readonly CountTile[] = [
    {
      icon: Table2,
      label: tr('المصادر', 'Sources', 'Sources'),
      value: counts.sources,
    },
    {
      icon: Database,
      label: tr('مجموعات البيانات', 'Jeux de données', 'Datasets'),
      value: counts.datasets,
      secondary: `${published(counts.publishedDatasets)} · ${int(counts.draftDatasets, lang)} ${
        tr('مسودة', 'brouillons', 'draft')}`,
    },
    {
      icon: Boxes,
      label: tr('الأبعاد', 'Dimensions', 'Dimensions'),
      value: counts.dimensions,
    },
    {
      icon: Ruler,
      label: tr('المقاييس', 'Mesures', 'Metrics'),
      value: counts.metrics,
      secondary: published(counts.publishedMetrics),
    },
    {
      icon: ScrollText,
      label: tr('التقارير', 'Rapports', 'Reports'),
      value: counts.reports,
    },
    {
      icon: Sigma,
      label: tr('التحليلات', 'Analyses', 'Analyses'),
      value: counts.visualizations,
    },
    {
      icon: LayoutDashboard,
      label: tr('اللوحات', 'Tableaux de bord', 'Dashboards'),
      value: counts.dashboards,
      secondary: published(counts.publishedDashboards),
    },
  ];

  return (
    <div style={TILES}>
      {tiles.map((tile, index) => (
        <KpiTile
          key={index}
          icon={tile.icon}
          label={tile.label}
          value={int(tile.value, lang)}
          secondary={tile.secondary}
          tone={tile.tone ?? 'accent'}
        />
      ))}
      {counts.deprecatedDatasets > 0 ? (
        <KpiTile
          icon={Database}
          label={tr('مهملة', 'Dépréciés', 'Deprecated')}
          value={int(counts.deprecatedDatasets, lang)}
          secondary={tr('مجموعات بيانات', 'jeux de données', 'datasets')}
          tone="warning"
        />
      ) : null}
    </div>
  );
}

/**
 * Six ways the semantic layer can be quietly wrong.
 *
 * Every one is a count of things that exist and should not, or should exist and do
 * not — so zero is the good answer everywhere and `healthTone` greys a zero out rather
 * than colouring it green. The exception is the last: a published dashboard standing
 * on a deprecated definition is the one somebody is still reading, so it gets
 * `breachTone` and sits at the bottom where a reader's eye stops.
 */
function Health({ health }: { health: BiHealth }): ReactElement {
  const { tr, lang } = useLocale();
  const lines: readonly { label: ReactNode; value: number; tone: Tone }[] = [
    {
      label: tr('مجموعات بلا مصدر', 'Jeux sans source', 'Datasets with no source'),
      value: health.datasetsWithoutSource,
      tone: healthTone(health.datasetsWithoutSource),
    },
    {
      label: tr('مجموعات بلا مقياس', 'Jeux sans mesure', 'Datasets with no metric'),
      value: health.datasetsWithoutMetric,
      tone: healthTone(health.datasetsWithoutMetric),
    },
    {
      label: tr('لم تُستعلم قط', 'Jamais interrogés', 'Never queried'),
      value: health.datasetsNeverQueried,
      tone: healthTone(health.datasetsNeverQueried),
    },
    {
      label: tr('راكدة ٣٠ يومًا', 'Inactifs depuis 30 jours', 'Stale for 30 days'),
      value: health.datasetsStale30d,
      tone: healthTone(health.datasetsStale30d),
    },
    {
      label: tr('تحليلات يتيمة', 'Analyses orphelines', 'Orphan analyses'),
      value: health.orphanVisualizations,
      tone: healthTone(health.orphanVisualizations),
    },
    {
      label: tr('منشور على مهمَل', 'Publié sur du déprécié', 'Published on deprecated'),
      value: health.publishedOnDeprecated,
      tone: breachTone(health.publishedOnDeprecated),
    },
  ];

  return (
    <Card
      icon={Stethoscope}
      title={tr('الصحة', 'Santé', 'Health')}
      subtitle={tr(
        'أشياء موجودة ولا ينبغي أن تكون، أو ينبغي أن تكون وليست.',
        'Des choses qui existent et ne devraient pas, ou qui devraient et n’existent pas.',
        'Things that exist and should not, or should exist and do not.',
      )}
    >
      <div>
        {lines.map((line, index) => (
          <div key={index} style={index === 0 ? { ...TALLY, borderTop: 'none' } : TALLY}>
            <span style={{ minWidth: 0 }}>{line.label}</span>
            <Badge tone={line.tone}>{int(line.value, lang)}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Seven days of the query log, or a stated absence of it.
 *
 * `visible: false` is not "zero queries" — it is "you may not read the log", which is
 * the ordinary answer for everyone without `canReadQueryLog`. Printing zeroes there
 * would be a lie the type was deliberately shaped to prevent, so the false arm says
 * the thing out loud instead.
 */
function Usage({ usage }: { usage: BiUsage }): ReactElement {
  const { tr, lang } = useLocale();

  if (!usage.visible) {
    return (
      <Card icon={Activity} title={tr('الاستخدام', 'Utilisation', 'Usage')}>
        <InfoBar tone="info">
          {tr(
            'سجل الاستعلامات غير متاح لهذا الحساب، فلا شيء يُقال عن الأيام السبعة الماضية.',
            'Le journal des requêtes n’est pas lisible par ce compte : rien ne peut être dit des sept derniers jours.',
            'The query log is not readable by this account, so nothing can be said about the last seven days.',
          )}
        </InfoBar>
      </Card>
    );
  }

  return (
    <Card
      icon={Activity}
      title={tr('الاستخدام', 'Utilisation', 'Usage')}
      subtitle={tr('آخر سبعة أيام', 'Sept derniers jours', 'Last seven days')}
    >
      <div style={TILES}>
        <KpiTile
          icon={Activity}
          label={tr('استعلامات', 'Requêtes', 'Queries')}
          value={int(usage.queries7d, lang)}
        />
        <KpiTile
          icon={Gauge}
          label={tr('الشريحة ٩٥', 'p95', 'p95 latency')}
          value={latency(usage.p95DurationMs, lang)}
          secondary={tr(
            `الأبطأ ${latency(usage.slowestMs, lang)}`,
            `la plus lente ${latency(usage.slowestMs, lang)}`,
            `slowest ${latency(usage.slowestMs, lang)}`,
          )}
          tone="info"
        />
        <KpiTile
          icon={Activity}
          label={tr('أخطاء', 'Erreurs', 'Errors')}
          value={int(usage.errors7d, lang)}
          tone={healthTone(usage.errors7d)}
        />
        <KpiTile
          icon={KeyRound}
          label={tr('مرفوضة', 'Refusées', 'Denied')}
          value={int(usage.denied7d, lang)}
          tone={healthTone(usage.denied7d)}
        />
        <KpiTile
          icon={Table2}
          label={tr('مبتورة', 'Tronquées', 'Truncated')}
          value={int(usage.truncated7d, lang)}
          secondary={tr(
            'بلغت حد الصفوف',
            'ont atteint la limite de lignes',
            'hit the row limit',
          )}
          tone={healthTone(usage.truncated7d)}
        />
      </div>
    </Card>
  );
}

/**
 * The datasets people actually open.
 *
 * Each row goes to the catalog with that dataset lit, through `focus` rather than
 * `changeView` plus `pickRow` — the pair would file the id under the tab being left.
 * Legitimately empty on a working install, so the empty state says why rather than
 * suggesting something is broken.
 */
function TopDatasets({ rows, shell }: { rows: readonly BiTopDataset[]; shell: BiShell }): ReactElement {
  const { t, tr, lang } = useLocale();

  return (
    <Card
      icon={Database}
      title={tr('الأكثر استعلامًا', 'Les plus interrogés', 'Most queried')}
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Database}
          title={tr('لا استعلامات بعد', 'Aucune requête pour l’instant', 'No queries yet')}
          description={tr(
            'ستظهر هنا مجموعات البيانات بمجرد أن يبدأ أحد في قراءتها.',
            'Les jeux de données apparaîtront ici dès que quelqu’un commencera à les lire.',
            'Datasets appear here as soon as someone starts reading them.',
          )}
        />
      ) : (
        <div>
          {rows.map((row, index) => (
            <div
              key={row.datasetId}
              role="button"
              tabIndex={0}
              style={index === 0 ? { ...ROW, borderTop: 'none' } : ROW}
              onClick={() => shell.focus({ view: 'catalog', id: row.datasetId })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  shell.focus({ view: 'catalog', id: row.datasetId });
                }
              }}
            >
              <span className="fx-title-ellipsis" style={{ flex: 1, minWidth: 0 }}>{row.name}</span>
              <Badge tone={STATUS_TONE[row.status]}>{t(STATUS_LABEL[row.status])}</Badge>
              <span style={{ ...CAPTION, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
                {int(row.queryCount, lang)}
              </span>
              <span style={{ ...CAPTION, flex: 'none' }}>
                <Stamp at={row.lastQueriedAt} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * What this caller may do, as the server answered it.
 *
 * Seven grants rather than a role name, because the seed grants publish on datasets
 * and metrics to no role at all — so a client-side role check would offer a button
 * nobody can press. A power not held is shown greyed rather than hidden: knowing a
 * door exists and is locked is more use than not knowing about the door.
 */
function Powers({ powers }: { powers: BiPowers }): ReactElement {
  const { tr } = useLocale();
  const grants: readonly { label: ReactNode; held: boolean }[] = [
    { label: tr('تعريف', 'Définir', 'Define'), held: powers.canDefine },
    { label: tr('نشر التعريفات', 'Publier les définitions', 'Publish definitions'), held: powers.canPublishDefinitions },
    { label: tr('حفظ التحليلات', 'Enregistrer des analyses', 'Save analyses'), held: powers.canSaveAnalysis },
    { label: tr('بناء اللوحات', 'Construire des tableaux', 'Build dashboards'), held: powers.canBuildDashboards },
    { label: tr('نشر اللوحات', 'Publier des tableaux', 'Publish dashboards'), held: powers.canPublishDashboards },
    { label: tr('قراءة السجل', 'Lire le journal', 'Read the log'), held: powers.canReadQueryLog },
    { label: tr('مزامنة المصادر', 'Synchroniser les sources', 'Sync sources'), held: powers.canSyncSources },
  ];

  return (
    <Card icon={KeyRound} title={tr('الصلاحيات', 'Permissions', 'Permissions')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {grants.map((grant, index) => (
          <Badge key={index} tone={grant.held ? 'success' : 'neutral'}>{grant.label}</Badge>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * The pane
 * ------------------------------------------------------------------ */

export interface BiOverviewPaneProps {
  readonly shell: BiShell;
}

/**
 * One read, five panels, three states before them.
 *
 * `Report<T>` is null while loading, null on error, and null when the mapper refused
 * the payload, which is why those three are told apart here rather than folded into a
 * single "nothing to show": a pane that renders an empty state during a fetch is lying,
 * and one that renders it after a failure is lying twice.
 */
export function BiOverviewPane({ shell }: BiOverviewPaneProps): ReactElement {
  const { tr, lang } = useLocale();
  const { loading, error, value } = shell.model.overview;

  if (error !== null) return <InfoBar tone="danger">{error}</InfoBar>;

  if (value === null) {
    return loading ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...CAPTION }}>
        <Spinner size={14} />
        {tr('جارٍ القراءة…', 'Lecture…', 'Reading…')}
      </div>
    ) : (
      <EmptyState
        icon={Database}
        title={tr('لا نظرة عامة', 'Aucune vue d’ensemble', 'No overview')}
        description={tr(
          'لم يُرجع الخادم ملخصًا يمكن قراءته.',
          'Le serveur n’a pas renvoyé de résumé lisible.',
          'The server returned no summary that could be read.',
        )}
      />
    );
  }

  return (
    <div style={STACK}>
      <Counts counts={value.counts} />
      <Health health={value.health} />
      <Usage usage={value.usage} />
      <TopDatasets rows={value.topDatasets} shell={shell} />
      <Powers powers={value.powers} />
      {value.generatedAt === null ? null : (
        <div style={CAPTION}>
          {tr('حُسبت في ', 'Calculée le ', 'Computed ')}
          {fmt.dateTime(value.generatedAt, lang)}
        </div>
      )}
    </div>
  );
}
