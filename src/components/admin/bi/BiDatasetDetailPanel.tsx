/**
 * One dataset, in full: the definition, the source under it, and every dimension and metric
 * it publishes.
 *
 * This is the screen that answers "where does this number come from", so nothing on it is
 * summarized away. Every dimension shows the row-level expression it compiles to and every
 * metric shows its inner formula next to the aggregate that folds it, because "Revenue" over
 * `SUM(total_amount)` and "Revenue" over `SUM(total_amount - refunds)` are different numbers
 * with one name, and the only way a reader can tell them apart is to be shown the text.
 *
 * The dataset-level row filter gets its own block for the same reason. It shapes every result
 * this dataset ever produces and appears in none of them, so a dataset that quietly excludes
 * cancelled bookings has to say so somewhere, and this is that somewhere.
 */
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import type {
  BiDatasetDetail, BiDimension, BiFilter, BiMetric, BiSourceColumn,
} from '@/types/bi';
import { GroupLabel, InlineNote, KeyValue, Panel, Pill, StatusPill } from './atoms';
import {
  DASH, filterText, fmtDateTime, fmtInt, useBiI18n, useBiLabels, useBiRead,
} from './biFormat';

export function BiDatasetDetailPanel({ datasetId }: { datasetId: string }) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const { data, loading, error, reload } = useBiRead<BiDatasetDetail>(
    () => biAnalytics.datasetDetail(datasetId), [datasetId],
  );

  if (loading && !data) return <Spinner className="p-10" />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return null;

  const { dataset } = data;
  const name = (isAr && dataset.name_ar) ? dataset.name_ar : dataset.name;

  return (
    <div className="space-y-4">
      <Panel
        title={name}
        subtitle={dataset.description ?? undefined}
        actions={(
          <>
            <StatusPill status={dataset.status} label={labels.status[dataset.status]} />
            <Pill tone="neutral" title={t('نسخة التعريف', 'Version de la définition', 'Definition version')}>
              {`v${dataset.version}`}
            </Pill>
          </>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue
            label={t('المفتاح', 'Clé', 'Key')}
            value={<span className="font-mono text-[12px]" dir="ltr">{dataset.key}</span>}
          />
          <KeyValue
            label={t('عمود الزمن', 'Colonne temps', 'Time column')}
            value={dataset.default_time_column ?? DASH}
            mono
          />
          <KeyValue label={t('استعلامات', 'Requêtes', 'Queries')} value={fmtInt(dataset.query_count)} mono />
          <KeyValue
            label={t('آخر استعلام', 'Dernière requête', 'Last queried')}
            value={fmtDateTime(dataset.last_queried_at)}
          />
          <KeyValue label={t('نُشر', 'Publié', 'Published')} value={fmtDateTime(dataset.published_at)} />
          <KeyValue label={t('أُهمل', 'Déprécié', 'Deprecated')} value={fmtDateTime(dataset.deprecated_at)} />
          <KeyValue label={t('أُنشئ', 'Créé', 'Created')} value={fmtDateTime(dataset.created_at)} />
          <KeyValue label={t('آخر تعديل', 'Modifié', 'Updated')} value={fmtDateTime(dataset.updated_at)} />
        </div>
        <RowFilterBlock filters={dataset.row_filter_json} />
      </Panel>

      <SourceCard source={data.source} columns={data.source_columns} />
      <DimensionsTable dimensions={data.dimensions} />
      <MetricsTable metrics={data.metrics} />

      <p className="px-1 text-[11px] text-[var(--text-muted)]">
        {t(`قُرئ في ${fmtDateTime(data.generated_at)}`,
          `Lu le ${fmtDateTime(data.generated_at)}`,
          `Read at ${fmtDateTime(data.generated_at)}`)}
      </p>
    </div>
  );
}

/**
 * The dataset's own filter, printed as the tokens it compiles to.
 *
 * A filter at this level is applied to every query over the dataset and shows up in no
 * result, which makes it the easiest thing in a semantic layer to forget and the hardest to
 * argue with later. Silence here would be a claim that there is no filter, so an empty list
 * says that in words instead.
 */
function RowFilterBlock({ filters }: { filters: readonly BiFilter[] }) {
  const { t } = useBiI18n();

  if (filters.length === 0) {
    return (
      <p className="mt-4 text-[11px] text-[var(--text-muted)]">
        {t('بلا مرشِّح على مستوى المجموعة: كل صفوف المصدر داخلة',
          'Aucun filtre au niveau du jeu : toutes les lignes de la source sont incluses',
          'No dataset-level filter: every row of the source is in scope')}
      </p>
    );
  }

  return (
    <div className="mt-4">
      <GroupLabel>
        {t('مرشِّح المجموعة — يُطبَّق على كل استعلام',
          'Filtre du jeu — appliqué à chaque requête',
          'Dataset filter — applied to every query')}
      </GroupLabel>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((filter, i) => (
          <code
            key={`${filter.field}-${filter.op}-${i}`}
            dir="ltr"
            className="rounded border border-[var(--border)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
          >
            {filterText(filter)}
          </code>
        ))}
      </div>
    </div>
  );
}

/**
 * The physical source, and what it exposes.
 *
 * Three of these fields are refusals waiting to happen, so they are stated before they can
 * become a support question: a source withdrawn from the allowlist (`is_active`), a source
 * whose permission this caller lacks (`readable_by_me`), and a dataset with no source at all,
 * which cannot compile into a statement at any point.
 */
function SourceCard({ source, columns }: {
  source: BiDatasetDetail['source'];
  columns: readonly BiSourceColumn[];
}) {
  const { t, isAr } = useBiI18n();

  if (!source) {
    return (
      <Panel title={t('المصدر', 'Source', 'Source')}>
        <InlineNote tone="bad">
          {t('لا مصدر لهذه المجموعة، فلا يمكن تصريفها إلى استعلام',
            'Ce jeu n’a pas de source : il ne peut pas être compilé en requête',
            'This dataset has no source, so it cannot compile into a query at all')}
        </InlineNote>
      </Panel>
    );
  }

  return (
    <Panel
      title={(isAr && source.display_name_ar) ? source.display_name_ar : source.display_name}
      subtitle={t('الجدول المسموح به تحت هذه المجموعة',
        'La table autorisée sous ce jeu', 'The allow-listed table under this dataset')}
      actions={(
        <>
          {source.is_branch_scoped && (
            <Pill tone="info">{t('نطاق الفرع', 'Par agence', 'Branch scoped')}</Pill>
          )}
          <Pill tone={source.is_active ? 'good' : 'bad'}>
            {source.is_active
              ? t('نشط', 'Active', 'Active')
              : t('مسحوب من القائمة', 'Retirée', 'Withdrawn')}
          </Pill>
        </>
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue
          label={t('العلاقة', 'Relation', 'Relation')}
          value={<span className="font-mono text-[12px]" dir="ltr">{source.relation}</span>}
        />
        <KeyValue
          label={t('الصلاحية المطلوبة', 'Permission requise', 'Required permission')}
          value={<span className="font-mono text-[12px]" dir="ltr">{source.required_permission}</span>}
        />
        <KeyValue
          label={t('عمود الزمن', 'Colonne temps', 'Time column')}
          value={source.default_time_column ?? DASH}
          mono
        />
        <KeyValue label={t('أعمدة', 'Colonnes', 'Columns')} value={fmtInt(source.column_count)} mono />
      </div>
      {!source.readable_by_me && (
        <InlineNote>
          {t('يمكنك قراءة هذا التعريف، لا صفوفه: صلاحية المصدر تُفحص عند التنفيذ',
            'Vous pouvez lire cette définition, pas ses lignes : la permission de la source est vérifiée à l’exécution',
            'You may read this definition but not its rows: the source permission is checked again at run time')}
        </InlineNote>
      )}
      <ColumnChips columns={columns} />
    </Panel>
  );
}

/**
 * Which of the source's columns can become what.
 *
 * Split by role rather than listed once, because the question an author actually has is "what
 * can I group by" or "what can I aggregate", and a text column in the measure list is a
 * definition that will be refused at write time.
 */
function ColumnChips({ columns }: { columns: readonly BiSourceColumn[] }) {
  const { t } = useBiI18n();
  const dimensions = columns.filter((c) => c.is_dimension);
  const measures = columns.filter((c) => c.is_measure);

  if (columns.length === 0) return null;

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <ChipGroup
        label={t('صالحة كبعد', 'Utilisables en dimension', 'Available as a dimension')}
        columns={dimensions}
      />
      <ChipGroup
        label={t('صالحة كقياس', 'Utilisables en mesure', 'Available as a measure')}
        columns={measures}
      />
    </div>
  );
}

/** One group of column chips, with the data type in the title so the chip stays short. */
function ChipGroup({ label, columns }: { label: string; columns: readonly BiSourceColumn[] }) {
  const { t } = useBiI18n();
  return (
    <div>
      <GroupLabel>{`${label} · ${columns.length}`}</GroupLabel>
      {columns.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">
          {t('لا شيء', 'Aucune', 'None')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {columns.map((column) => (
            <code
              key={column.column_name}
              dir="ltr"
              title={`${column.display_name} · ${column.data_type}`}
              className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
            >
              {column.column_name}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Every dimension, with the expression it compiles to.
 *
 * The expression is shown rather than described because a dimension is a rename of an
 * expression and nothing else: two datasets can both publish "Branch" and mean different
 * columns, and the only way to tell is to read the text. The hierarchy column is the second
 * half of the same honesty -- a dimension that says it drills to `city` when no `city`
 * dimension exists is authored top-down and legal, but a reader should see the dangling name
 * rather than discover it by clicking.
 */
function DimensionsTable({ dimensions }: { dimensions: readonly BiDimension[] }) {
  const { t } = useBiI18n();
  const hasDefault = dimensions.some((d) => d.is_default);

  return (
    <Panel
      title={t('الأبعاد', 'Dimensions', 'Dimensions')}
      subtitle={t('أعمدة التجميع، وكل واحد هو تعبير على المصدر',
        'Les colonnes de regroupement, chacune une expression sur la source',
        'The grouping columns, each one an expression over the source')}
      actions={<Pill tone="neutral">{fmtInt(dimensions.length)}</Pill>}
    >
      {dimensions.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا أبعاد بعد', 'Aucune dimension', 'No dimensions yet')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>{t('البعد', 'Dimension', 'Dimension')}</th>
                <th>{t('النوع', 'Type', 'Type')}</th>
                <th>{t('التعبير', 'Expression', 'Expression')}</th>
                <th>{t('يفصّل إلى', 'Descend vers', 'Drills to')}</th>
                <th>{t('يفتح', 'Ouvre', 'Opens')}</th>
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dimension) => (
                <DimensionRow key={dimension.id} dimension={dimension} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dimensions.length > 0 && !hasDefault && (
        <InlineNote>
          {t('لا بعد افتراضي: يفتح المُنشئ بلا تجميع',
            'Aucune dimension par défaut : le constructeur ouvre sans regroupement',
            'No default dimension: the builder opens with nothing grouped')}
        </InlineNote>
      )}
    </Panel>
  );
}

/** One dimension. A `drill_through_kind` with no expression behind it is called out, because
 *  the RPC has nothing to resolve and the cell would offer to open records it cannot find. */
function DimensionRow({ dimension }: { dimension: BiDimension }) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const name = (isAr && dimension.display_name_ar) ? dimension.display_name_ar : dimension.display_name;
  const kind = dimension.drill_through_kind;
  const openable = kind !== null && dimension.drill_through_expression !== null;

  return (
    <tr>
      <td>
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
        {dimension.is_default && (
          <Pill tone="info">{t('افتراضي', 'Défaut', 'Default')}</Pill>
        )}
        <span className="block font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
          {dimension.key}
        </span>
      </td>
      <td className="font-mono text-[11px] text-[var(--text-secondary)]" dir="ltr">
        {dimension.data_type}
      </td>
      <td className="max-w-[18rem]">
        <code
          dir="ltr"
          title={dimension.expression}
          className="block truncate font-mono text-[11px] text-[var(--text-secondary)]"
        >
          {dimension.expression}
        </code>
      </td>
      <td className="font-mono text-[11px] text-[var(--text-secondary)]" dir="ltr">
        {dimension.drill_to_key ?? DASH}
      </td>
      <td>
        {kind === null ? (
          <span className="text-[11px] text-[var(--text-muted)]">{DASH}</span>
        ) : (
          <Pill tone={openable ? 'info' : 'warn'} title={openable ? undefined : t(
            'نوع بلا تعبير: لا سجلات لتُفتح',
            'Type sans expression : rien à ouvrir',
            'A kind with no expression: nothing to open',
          )}>
            {labels.drillThrough[kind]}
          </Pill>
        )}
      </td>
    </tr>
  );
}

/**
 * Every metric, with the formula and the fold shown side by side.
 *
 * They are two different facts and a registry that prints only one of them is unusable: the
 * formula is what each row contributes and the aggregate is how the rows combine, so `AVG` over
 * `total_amount` and `SUM` over the same column are the same formula and different numbers.
 *
 * A metric-local filter is printed on the row too. It is how one dataset carries both "revenue"
 * and "confirmed revenue" without a second dataset, which is only safe if the difference is
 * visible where the two names sit next to each other.
 */
function MetricsTable({ metrics }: { metrics: readonly BiMetric[] }) {
  const { t } = useBiI18n();
  const nonAdditive = metrics.filter((m) => !m.is_additive).length;

  return (
    <Panel
      title={t('المقاييس', 'Mesures', 'Metrics')}
      subtitle={t('التعبير هو مساهمة الصف، والتجميع هو كيف تُضمّ الصفوف',
        'La formule est la contribution de la ligne, l’agrégat dit comment elles se combinent',
        'The formula is what a row contributes; the aggregate is how the rows combine')}
      actions={<Pill tone="neutral">{fmtInt(metrics.length)}</Pill>}
    >
      {metrics.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
          {t('لا مقاييس بعد', 'Aucune mesure', 'No metrics yet')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead>
              <tr>
                <th>{t('المقياس', 'Mesure', 'Metric')}</th>
                <th>{t('التجميع', 'Agrégat', 'Aggregate')}</th>
                <th>{t('التعبير', 'Formule', 'Formula')}</th>
                <th>{t('العرض', 'Affichage', 'Display')}</th>
                <th>{t('الحالة', 'Statut', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => <MetricRow key={metric.id} metric={metric} />)}
            </tbody>
          </table>
        </div>
      )}
      {nonAdditive > 0 && (
        <InlineNote>
          {t(`${nonAdditive} مقياس غير قابل للجمع: لا يُكدَّس ولا يُجمَع في سطر إجمالي`,
            `${nonAdditive} mesure(s) non additive(s) : ni empilées ni totalisées`,
            `${nonAdditive} metric(s) are not additive: they must not be stacked or totalled`)}
        </InlineNote>
      )}
    </Panel>
  );
}

/** One metric. Format, unit and decimals travel together in the display cell because they are
 *  one decision: 2 decimals on a PERCENT and 2 on a CURRENCY print different-looking numbers,
 *  and a registry that lists the format without the digits invites a mismatch between screens. */
function MetricRow({ metric }: { metric: BiMetric }) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();
  const name = (isAr && metric.display_name_ar) ? metric.display_name_ar : metric.display_name;
  const unit = metric.unit ? ` ${metric.unit}` : '';

  return (
    <tr>
      <td>
        <span className="font-medium text-[var(--text-primary)]">{name}</span>
        {!metric.is_additive && (
          <Pill tone="warn" title={t('لا يُجمع', 'Non additive', 'Not additive')}>
            {t('لا يُجمع', 'Non add.', 'No sum')}
          </Pill>
        )}
        <span className="block font-mono text-[11px] text-[var(--text-muted)]" dir="ltr">
          {metric.key}
        </span>
      </td>
      <td className="whitespace-nowrap text-[12px] text-[var(--text-secondary)]">
        {labels.aggregate[metric.aggregate]}
      </td>
      <td className="max-w-[20rem]"><FormulaCell metric={metric} /></td>
      <td className="whitespace-nowrap text-[12px] text-[var(--text-secondary)]">
        {`${labels.metricFormat[metric.format]}${unit}`}
        <span className="block text-[11px] tabular text-[var(--text-muted)]">
          {t(`${metric.decimals} منزلة`, `${metric.decimals} déc.`, `${metric.decimals} dp`)}
        </span>
      </td>
      <td className="whitespace-nowrap">
        <StatusPill status={metric.status} label={labels.status[metric.status]} />
        <span className="ms-1.5 text-[11px] tabular text-[var(--text-muted)]">{`v${metric.version}`}</span>
      </td>
    </tr>
  );
}

/**
 * What one metric actually computes.
 *
 * A RATIO has no formula of its own -- the trigger blanks it -- and is defined by the two
 * metrics it divides, so printing an empty cell for one would hide the only interesting thing
 * about it. The division is shown as `numerator / denominator` over the metric keys, which is
 * also how the compiler emits it, with a nullif on the denominator that is not this cell's to
 * restate.
 */
function FormulaCell({ metric }: { metric: BiMetric }) {
  const { t } = useBiI18n();
  const ratio = metric.aggregate === 'RATIO';
  const text = ratio
    ? `${metric.numerator_metric_key ?? DASH} / ${metric.denominator_metric_key ?? DASH}`
    : metric.formula;

  return (
    <>
      <code
        dir="ltr"
        title={text}
        className="block truncate font-mono text-[11px] text-[var(--text-secondary)]"
      >
        {text || DASH}
      </code>
      {metric.filter_json.length > 0 && (
        <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]" dir="ltr">
          {`FILTER ${metric.filter_json.map(filterText).join(' AND ')}`}
        </span>
      )}
      {ratio && (metric.numerator_metric_key === null || metric.denominator_metric_key === null) && (
        <span className="mt-0.5 block text-[10px] text-[var(--warning)]">
          {t('نسبة بلا طرفين', 'Ratio incomplet', 'A ratio missing an operand')}
        </span>
      )}
    </>
  );
}
