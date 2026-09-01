/**
 * Lineage: what a definition reads, and what would notice if it changed.
 *
 * The subject is chosen in two steps -- a dataset, then the dataset itself or one of its
 * dimensions or metrics -- because `get_bi_lineage` is keyed on (kind, id) and there is no
 * global list of definitions to pick from. A definition only exists inside a dataset.
 *
 * A dataset the caller may not query is still selectable here, unlike in the builder.
 * Lineage is a question about definitions, not about data: "which column does this metric
 * read" and "which published dashboard draws it" are answerable, and worth answering, to
 * someone who would be refused the rows themselves. The source panel says plainly whether
 * this caller could read them.
 *
 * The four impact numbers are shown above the lists rather than below them. They are the
 * summary an editor actually acts on -- `set_bi_status_command` refuses a deprecation that
 * would blank a published dashboard, and this is the same count it would refuse on.
 */
import { useState } from 'react';
import { GitBranch, ShieldCheck, ShieldX } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import Select from '@/components/admin/GlassSelect';
import { biAnalytics } from '@/services/biAnalytics';
import type {
  BiCatalog, BiDatasetDetail, BiDatasetSummary, BiDrillPath, BiLineage,
} from '@/types/bi';
import { GroupLabel, Panel, Pill, StatusPill, Tile } from './atoms';
import { fmtDateTime, fmtInt, useBiI18n, useBiLabels, useBiRead } from './biFormat';
import {
  LineageAnalyses, LineageDashboards, LineageDependents, LineageDrillPath, LineageUpstream,
} from './BiLineageGraph';

/** One shared empty array, so an unloaded payload does not hand the derived values a
 *  fresh identity on every render. */
const NO_DATASETS: readonly BiDatasetSummary[] = [];

/** What the second picker resolved to. `dimensionKey` is non-null only for a dimension,
 *  and it is what `get_bi_drill_path` is keyed on -- an id would not do. */
interface Subject {
  kind: 'DATASET' | 'DIMENSION' | 'METRIC';
  id: string;
  label: string;
  dimensionKey: string | null;
}

/** The picker's value is `KIND:id`, resolved back into a subject against the dataset that
 *  is loaded. An unresolvable value falls back to the dataset itself rather than rendering
 *  nothing: the only way to get one is to switch datasets, and the dataset is the answer
 *  the reader was already looking at. */
function resolveSubject(choice: string, detail: BiDatasetDetail, isAr: boolean): Subject {
  const wholeDataset: Subject = {
    kind: 'DATASET',
    id: detail.dataset.id,
    label: (isAr && detail.dataset.name_ar) ? detail.dataset.name_ar : detail.dataset.name,
    dimensionKey: null,
  };
  const colon = choice.indexOf(':');
  if (colon < 0) return wholeDataset;
  const kind = choice.slice(0, colon);
  const id = choice.slice(colon + 1);

  if (kind === 'DIMENSION') {
    const dimension = detail.dimensions.find((d) => d.id === id);
    if (dimension === undefined) return wholeDataset;
    return {
      kind: 'DIMENSION',
      id,
      label: (isAr && dimension.display_name_ar) ? dimension.display_name_ar : dimension.display_name,
      dimensionKey: dimension.key,
    };
  }
  if (kind === 'METRIC') {
    const metric = detail.metrics.find((m) => m.id === id);
    if (metric === undefined) return wholeDataset;
    return {
      kind: 'METRIC',
      id,
      label: (isAr && metric.display_name_ar) ? metric.display_name_ar : metric.display_name,
      dimensionKey: null,
    };
  }
  return wholeDataset;
}

export function BiLineagePanel() {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const { data, loading, error, reload } = useBiRead<BiCatalog>(() => biAnalytics.catalog(), []);
  const [datasetId, setDatasetId] = useState<string | null>(null);

  const datasets = data?.datasets ?? NO_DATASETS;

  if (loading && !data) return <Spinner className="p-10" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}

      <Panel
        title={t('النَسَب', 'Lignage', 'Lineage')}
        subtitle={t('ما يقرأه التعريف، ومن يتأثر إن تغيّر',
          'Ce que la définition lit, et qui serait touché si elle changeait',
          'What the definition reads, and who would notice if it changed')}
      >
        <div className="max-w-xl">
          <GroupLabel>{t('اختر مجموعة', 'Choisir un jeu', 'Choose a dataset')}</GroupLabel>
          <Select
            value={datasetId ?? ''}
            onChange={(e) => setDatasetId(e.target.value === '' ? null : e.target.value)}
            className="input"
            aria-label={t('مجموعة البيانات', 'Jeu de données', 'Dataset')}
          >
            <option value="">{t('— اختر —', '— Choisir —', '— Choose —')}</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {`${(isAr && dataset.name_ar) ? dataset.name_ar : dataset.name}`
                  + ` · ${labels.status[dataset.status]}`
                  + ` · ${fmtInt(dataset.dimension_count)}d / ${fmtInt(dataset.metric_count)}m`}
              </option>
            ))}
          </Select>
        </div>
      </Panel>

      {datasetId === null ? (
        <p className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-10 text-center text-[13px] text-[var(--text-muted)]">
          <GitBranch className="h-5 w-5" aria-hidden="true" />
          {t('اختر مجموعة لتتبّع نَسَب تعريفاتها',
            'Choisissez un jeu pour suivre le lignage de ses définitions',
            'Choose a dataset to trace the lineage of its definitions')}
        </p>
      ) : (
        <SubjectPicker key={datasetId} datasetId={datasetId} />
      )}
    </div>
  );
}

/** A definition's own name, in the reader's language when it has one. */
const nameOf = (
  row: { display_name: string; display_name_ar: string | null }, isAr: boolean,
): string => (isAr && row.display_name_ar ? row.display_name_ar : row.display_name);

/**
 * The second step: the dataset itself, or one thing defined inside it.
 *
 * Mounted with the dataset id as its `key`, so switching datasets resets the subject
 * rather than leaving a dimension selected that the new dataset does not define. The group
 * word is baked into each option's label because `GlassSelect` collects `option` elements
 * only and drops `optgroup` labels silently.
 */
function SubjectPicker({ datasetId }: { datasetId: string }) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const { data, loading, error, reload } = useBiRead<BiDatasetDetail>(
    () => biAnalytics.datasetDetail(datasetId), [datasetId],
  );
  const [choice, setChoice] = useState(() => `DATASET:${datasetId}`);

  if (loading && !data) return <Spinner className="p-10" />;
  if (!data) {
    return (
      <ErrorBanner
        message={error ?? t('لم تُحمَّل المجموعة', 'Jeu non chargé', 'Dataset did not load')}
        onRetry={reload}
      />
    );
  }

  const subject = resolveSubject(choice, data, isAr);
  const datasetName = (isAr && data.dataset.name_ar) ? data.dataset.name_ar : data.dataset.name;

  return (
    <div className="space-y-4">
      <Panel title={t('الموضوع', 'Sujet', 'Subject')}>
        <div className="max-w-xl">
          <GroupLabel>
            {t('تعريف داخل هذه المجموعة', 'Une définition de ce jeu',
              'A definition inside this dataset')}
          </GroupLabel>
          <Select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="input"
            aria-label={t('الموضوع', 'Sujet', 'Subject')}
          >
            <option value={`DATASET:${data.dataset.id}`}>
              {`${t('المجموعة كاملة', 'Le jeu entier', 'The whole dataset')} · ${datasetName}`}
            </option>
            {data.dimensions.map((dimension) => (
              <option key={dimension.id} value={`DIMENSION:${dimension.id}`}>
                {`${t('بعد', 'Dimension', 'Dimension')} · ${nameOf(dimension, isAr)}`}
              </option>
            ))}
            {data.metrics.map((metric) => (
              <option key={metric.id} value={`METRIC:${metric.id}`}>
                {`${t('مقياس', 'Mesure', 'Metric')} · ${nameOf(metric, isAr)}`
                  + ` · ${labels.status[metric.status]}`}
              </option>
            ))}
          </Select>
        </div>
      </Panel>

      <LineageAnswer subject={subject} datasetId={datasetId} />
    </div>
  );
}

/** The answer for one subject. The read is keyed on (kind, id) rather than on the whole
 *  subject object, so re-resolving the same choice does not refetch. */
function LineageAnswer({ subject, datasetId }: { subject: Subject; datasetId: string }) {
  const { t } = useBiI18n();
  const { data, loading, error, reload } = useBiRead<BiLineage>(
    () => biAnalytics.lineage(subject.kind, subject.id), [subject.kind, subject.id],
  );

  if (loading && !data) return <Spinner className="p-10" />;
  if (!data) {
    return (
      <ErrorBanner
        message={error ?? t('لم يُقاس النَسَب', 'Lignage non mesuré', 'Lineage was not measured')}
        onRetry={reload}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SubjectHeader lineage={data} />
      <ImpactRow impact={data.impact} />
      <LineageUpstream columns={data.upstream_columns} />
      {subject.dimensionKey !== null && (
        <DimensionHierarchy datasetId={datasetId} dimensionKey={subject.dimensionKey} />
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <LineageAnalyses analyses={data.downstream_analyses} />
        <LineageDashboards dashboards={data.downstream_dashboards} />
      </div>
      <LineageDependents dependents={data.dependent_definitions} />
    </div>
  );
}

/**
 * What the subject is, and whether this caller could read the rows behind it.
 *
 * The source's `readable_by_me` is stated even though nothing on this screen queries: a
 * reader tracing a metric they cannot see the numbers of should be told that plainly here
 * rather than infer it from an empty chart somewhere else.
 */
function SubjectHeader({ lineage }: { lineage: BiLineage }) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const kindLabel: Record<BiLineage['kind'], string> = {
    DATASET: t('مجموعة', 'Jeu', 'Dataset'),
    DIMENSION: t('بعد', 'Dimension', 'Dimension'),
    METRIC: t('مقياس', 'Mesure', 'Metric'),
  };

  return (
    <Panel
      title={lineage.label}
      actions={
        <StatusPill
          status={lineage.status}
          label={lineage.status === 'N/A'
            ? t('حالة المجموعة', 'Statut du jeu', 'Dataset’s status')
            : labels.status[lineage.status]}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        <Pill tone="neutral">{kindLabel[lineage.kind]}</Pill>
        <span className="font-mono" dir="ltr">{lineage.key}</span>
        {lineage.source !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono" dir="ltr">{lineage.source.relation}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono" dir="ltr">{lineage.source.required_permission}</span>
            {lineage.source.readable_by_me ? (
              <Pill tone="good">
                <ShieldCheck className="me-1 inline h-3 w-3" aria-hidden="true" />
                {t('قابل للقراءة لك', 'Lisible par vous', 'Readable by you')}
              </Pill>
            ) : (
              <Pill tone="warn">
                <ShieldX className="me-1 inline h-3 w-3" aria-hidden="true" />
                {t('غير قابل للقراءة لك', 'Non lisible par vous', 'Not readable by you')}
              </Pill>
            )}
          </>
        )}
        {lineage.measured_at !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {t(`قيس ${fmtDateTime(lineage.measured_at)}`,
                `Mesuré le ${fmtDateTime(lineage.measured_at)}`,
                `Measured ${fmtDateTime(lineage.measured_at)}`)}
            </span>
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * The blast radius, in four numbers.
 *
 * `published_dashboards` is a subset of `dashboards` and is given its own tile anyway,
 * because it is the only one of the four that turns a save into a refusal: deprecating a
 * definition a published dashboard still draws raises 22023 rather than proceeding.
 */
function ImpactRow({ impact }: { impact: BiLineage['impact'] }) {
  const { t } = useBiI18n();

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label={t('تحليلات', 'Analyses', 'Analyses')}
        value={fmtInt(impact.analyses)}
        hint={t('تحليل محفوظ يستخدم هذا', 'analyses enregistrées qui l’utilisent',
          'saved analyses that use it')}
      />
      <Tile
        label={t('لوحات', 'Tableaux', 'Dashboards')}
        value={fmtInt(impact.dashboards)}
        hint={t('لوحة ترسمه', 'tableaux qui le dessinent', 'dashboards that draw it')}
      />
      <Tile
        label={t('لوحات منشورة', 'Tableaux publiés', 'Published dashboards')}
        value={fmtInt(impact.published_dashboards)}
        tone={impact.published_dashboards > 0 ? 'warn' : 'neutral'}
        hint={t('الإهمال يُرفض بسببها', 'la dépréciation est refusée à cause d’eux',
          'a deprecation is refused because of these')}
      />
      <Tile
        label={t('تعريفات تابعة', 'Définitions dépendantes', 'Dependent definitions')}
        value={fmtInt(impact.dependent_definitions)}
        tone={impact.dependent_definitions > 0 ? 'warn' : 'neutral'}
        hint={t('نسبة أو تسلسل يعتمد عليه', 'un ratio ou une hiérarchie en dépend',
          'a ratio or a hierarchy depends on it')}
      />
    </div>
  );
}

/** The hierarchy read, in its own component so the hook is never called with a key that
 *  is not a dimension's. */
function DimensionHierarchy({ datasetId, dimensionKey }: {
  datasetId: string;
  dimensionKey: string;
}) {
  const { t } = useBiI18n();
  const { data, loading, error, reload } = useBiRead<BiDrillPath>(
    () => biAnalytics.drillPath(datasetId, dimensionKey), [datasetId, dimensionKey],
  );

  if (loading && !data) return <Spinner className="py-8" />;
  if (!data) {
    return (
      <ErrorBanner
        message={error ?? t('لم يُقرأ التسلسل', 'Hiérarchie non lue',
          'The hierarchy was not read')}
        onRetry={reload}
      />
    );
  }

  return <LineageDrillPath path={data} />;
}
