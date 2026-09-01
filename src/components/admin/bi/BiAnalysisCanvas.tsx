/**
 * The canvas: one dataset, two shelves, a run, a chart, and the statement that produced
 * it.
 *
 * Split from the builder shell because the dataset detail read needs a non-null id, and
 * a hook written to tolerate a null argument is a hook that will one day be called with
 * one. The shell chooses; this component renders only once something has been chosen, so
 * `datasetId` here is always a real dataset.
 *
 * Three decisions are worth naming, because each of them is a refusal moved earlier:
 *
 * 1. The run is manual. `run_bi_query_command` writes a `bi_query_log` row on every
 *    call, including the ones it refuses, so a canvas that ran as you dragged would
 *    spend an audit row per gesture. The button is the only thing that runs a query.
 * 2. The run button is disabled for exactly the issues `bi_compile_query` would raise
 *    22023 on -- an empty request, an incomplete filter, a sort on a column that is not
 *    selected, a deprecated metric. The two chart-shape shortfalls do not disable it,
 *    because the result is still a valid result and `BiChart` already names the frame it
 *    could not draw.
 * 3. A result carries the signature of the request that produced it. Editing the request
 *    without re-running says so on the chart rather than letting yesterday's numbers sit
 *    under today's question.
 */
import { type Dispatch, useMemo } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import { BI_PERIOD_KEY } from '@/types/bi';
import type {
  BiDatasetDetail, BiDimension, BiMetric, BiQueryRequest, BiQuerySuccess,
} from '@/types/bi';
import { BiChart } from './BiChart';
import type { BiChartSelection } from './biChartData';
import { InlineNote, Panel, Pill, SqlBlock } from './atoms';
import {
  blocksRun, drillStepFor, orderOptions, orderedByKeys, readiness, requestSignature,
  toQueryRequest, type BuilderAction, type BuilderIssue, type BuilderState,
} from './biBuilderState';
import { BiFilterEditor } from './BiFilterEditor';
import { ChartPicker, FieldPalette, FieldShelf, QueryOptions } from './BiBuilderShelves';
import { BiSaveAnalysis } from './BiSaveAnalysis';
import { fmtInt, fmtMs, useBiI18n, useBiLabels, useBiRead } from './biFormat';
import { useBiRunQuery, useBuilderIssueText, type BiRunState } from './useBiBuilder';

/** A definition's own name, in the reader's language when it has one. Arabic is stored
 *  per definition and may be absent, in which case the base name is the honest label
 *  rather than a transliteration this layer would have to invent. */
const nameOf = (
  row: { display_name: string; display_name_ar: string | null }, isAr: boolean,
): string => (isAr && row.display_name_ar ? row.display_name_ar : row.display_name);

/**
 * Where a number comes from, in one line.
 *
 * A RATIO ignores its own formula -- the trigger blanks it -- and composes two other
 * metrics, so printing `formula` for one would show an empty string next to a metric
 * that plainly computes something.
 */
const metricHint = (metric: BiMetric): string => (metric.aggregate === 'RATIO'
  ? `${metric.numerator_metric_key ?? '?'} / ${metric.denominator_metric_key ?? '?'}`
  : `${metric.aggregate}(${metric.formula})`);

const dimensionChip = (dimension: BiDimension, isAr: boolean) => ({
  key: dimension.key,
  label: nameOf(dimension, isAr),
  hint: dimension.expression,
});

const metricChip = (metric: BiMetric, isAr: boolean, deprecatedNote: string) => ({
  key: metric.key,
  label: nameOf(metric, isAr),
  hint: metricHint(metric),
  blocked: metric.status === 'DEPRECATED',
  blockedNote: metric.status === 'DEPRECATED' ? deprecatedNote : undefined,
});

/** A stable React key for an issue. Two issues of the same kind differ by the thing they
 *  name, and a list keyed by index would reorder notes as earlier ones are fixed. */
function issueKey(issue: BuilderIssue): string {
  if (issue.kind === 'FILTER_INCOMPLETE') return `${issue.kind}:${issue.index}`;
  if (issue.kind === 'DEPRECATED_METRIC' || issue.kind === 'ORDER_UNSELECTED') {
    return `${issue.kind}:${issue.key}`;
  }
  return issue.kind;
}

export function BiAnalysisCanvas({ datasetId, state, dispatch }: {
  datasetId: string;
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
}) {
  const { t } = useBiI18n();
  const issueText = useBuilderIssueText();
  const { data, loading, error, reload } = useBiRead<BiDatasetDetail>(
    () => biAnalytics.datasetDetail(datasetId), [datasetId],
  );
  // The request is memoized on the whole state, so its identity changes exactly when
  // something the compiler reads changes -- which is what the run hook's latest-ref
  // reads and what the signature is taken from.
  const request = useMemo(() => toQueryRequest(state), [state]);
  const run = useBiRunQuery(request);

  if (loading && !data) return <Spinner className="p-10" />;
  if (!data) {
    return (
      <ErrorBanner
        message={error ?? t('لم تُحمَّل المجموعة', 'Jeu non chargé', 'Dataset did not load')}
        onRetry={reload}
      />
    );
  }

  const deprecatedNote = t('مُهمل — المُصرّف يرفضه', 'Déprécié — le compilateur le refuse',
    'Deprecated — the compiler refuses it');
  // What is on a shelf is off the palette. Both shelves are checked against both lists,
  // so a key can never sit in two places and be grouped against itself.
  const onShelf = new Set([...state.dimensions, ...state.metrics]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <BuilderRail detail={data} state={state} dispatch={dispatch} onShelf={onShelf}
        deprecatedNote={deprecatedNote} />
      <ResultPane detail={data} state={state} dispatch={dispatch} request={request} run={run}
        issues={readiness(state, data.metrics)} issueText={issueText} datasetId={datasetId} />
    </div>
  );
}

/**
 * The left rail: what the dataset offers, what is selected, and how the request is
 * shaped.
 *
 * Every dispatch here is one `BuilderAction`, and the reducer -- not this component --
 * keeps the invariants: removing the field a sort was on clears the sort, dropping the
 * grain clears a sort on the period column, and any manual edit clears the drill trail.
 */
function BuilderRail({ detail, state, dispatch, onShelf, deprecatedNote }: {
  detail: BiDatasetDetail;
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  onShelf: ReadonlySet<string>;
  deprecatedNote: string;
}) {
  const { t, isAr } = useBiI18n();
  const labels = useBiLabels();

  const paletteDims = detail.dimensions
    .filter((d) => !onShelf.has(d.key))
    .map((d) => dimensionChip(d, isAr));
  const paletteMets = detail.metrics
    .filter((m) => !onShelf.has(m.key))
    .map((m) => metricChip(m, isAr, deprecatedNote));

  // Shelf order is the group-by order, so the rows are fetched in the shelf's order
  // rather than the dataset's.
  const shelfDims = orderedByKeys(detail.dimensions, state.dimensions)
    .map((d) => dimensionChip(d, isAr));
  const shelfMets = orderedByKeys(detail.metrics, state.metrics)
    .map((m) => metricChip(m, isAr, deprecatedNote));

  // The sort choices are the columns the compiler will build, named as the reader sees
  // them. The period column is the compiler's own and is labelled by its grain.
  const orderChoices = orderOptions(state).map((key) => {
    if (key === BI_PERIOD_KEY) {
      return { key, label: state.timeGrain === null ? key : labels.grain[state.timeGrain] };
    }
    const dimension = detail.dimensions.find((d) => d.key === key);
    if (dimension) return { key, label: nameOf(dimension, isAr) };
    const metric = detail.metrics.find((m) => m.key === key);
    return { key, label: metric ? nameOf(metric, isAr) : key };
  });

  return (
    <div className="space-y-4">
      <FieldPalette
        dimensions={paletteDims}
        metrics={paletteMets}
        onAdd={(shelf, key) => dispatch({ type: 'ADD_FIELD', shelf, key })}
      />

      <Panel
        title={t('الرسم', 'Graphique', 'Chart')}
        subtitle={t('يمكن تغييره دون إعادة التشغيل', 'Modifiable sans réexécuter',
          'Changing it does not need a re-run')}
      >
        <ChartPicker
          value={state.chartType}
          onChange={(chartType) => dispatch({ type: 'CHART', chartType })}
        />
      </Panel>

      <FieldShelf
        shelf="DIMENSION"
        title={t('الأبعاد', 'Dimensions', 'Dimensions')}
        hint={t('الترتيب هو ترتيب التجميع', 'L’ordre est celui du regroupement',
          'The order here is the grouping order')}
        fields={shelfDims}
        empty={t('اسحب بعدًا إلى هنا', 'Glissez une dimension ici', 'Drag a dimension here')}
        onAdd={(shelf, key, at) => dispatch({ type: 'ADD_FIELD', shelf, key, at })}
        onMove={(shelf, from, to) => dispatch({ type: 'MOVE_FIELD', shelf, from, to })}
        onRemove={(shelf, key) => dispatch({ type: 'REMOVE_FIELD', shelf, key })}
      />

      <FieldShelf
        shelf="METRIC"
        title={t('المقاييس', 'Mesures', 'Metrics')}
        hint={t('كل مقياس عمود واحد', 'Chaque mesure est une colonne',
          'Each metric is one column')}
        fields={shelfMets}
        empty={t('اسحب مقياسًا إلى هنا', 'Glissez une mesure ici', 'Drag a metric here')}
        onAdd={(shelf, key, at) => dispatch({ type: 'ADD_FIELD', shelf, key, at })}
        onMove={(shelf, from, to) => dispatch({ type: 'MOVE_FIELD', shelf, from, to })}
        onRemove={(shelf, key) => dispatch({ type: 'REMOVE_FIELD', shelf, key })}
      />

      <QueryOptions
        timeGrain={state.timeGrain}
        orderBy={state.orderBy}
        orderDesc={state.orderDesc}
        limit={state.limit}
        orderChoices={orderChoices}
        onGrain={(timeGrain) => dispatch({ type: 'GRAIN', timeGrain })}
        onOrder={(orderBy, orderDesc) => dispatch({ type: 'ORDER', orderBy, orderDesc })}
        onLimit={(limit) => dispatch({ type: 'LIMIT', limit })}
      />
    </div>
  );
}

/**
 * The right column: the run, what would stop it, the filters, the trail, the chart, and
 * the statement.
 *
 * A drill dispatches and re-runs in the same handler. That is safe rather than lucky:
 * `useBiRunQuery` reads the request through a ref assigned during render, so the effect
 * it schedules sees the regrouped request and not the one this click started from.
 */
function ResultPane({
  detail, state, dispatch, request, run, issues, issueText, datasetId,
}: {
  detail: BiDatasetDetail;
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  request: BiQueryRequest | null;
  run: BiRunState;
  issues: readonly BuilderIssue[];
  issueText: (issue: BuilderIssue) => string;
  datasetId: string;
}) {
  const { t, isAr } = useBiI18n();
  const blocked = issues.some(blocksRun);
  const dimensionKeys = detail.dimensions.map((d) => d.key);

  // Whether the result on screen still answers the request on screen. Read twice -- by the
  // meta pill, which says so, and by the save panel, which refuses on it -- and computed
  // once so the two cannot disagree.
  const stale = run.signature !== requestSignature(request);

  // Filterable things: the dataset's dimensions first, then source columns that no
  // dimension already claims. The compiler resolves a name against dimensions first, so
  // a column shadowed by a dimension is not offered twice under one meaning.
  const claimed = new Set(dimensionKeys);
  const filterFields = [
    ...detail.dimensions.map((d) => ({
      key: d.key,
      label: nameOf(d, isAr),
      dataType: d.data_type,
      group: t('بعد', 'Dimension', 'Dimension'),
    })),
    ...detail.source_columns.filter((c) => !claimed.has(c.column_name)).map((c) => ({
      key: c.column_name,
      label: c.display_name || c.column_name,
      dataType: c.data_type,
      group: t('عمود المصدر', 'Colonne source', 'Source column'),
    })),
  ];

  const rerun = (action: BuilderAction) => {
    dispatch(action);
    run.run();
  };

  const select = (selection: BiChartSelection) => {
    const step = drillStepFor(state, selection.column, selection.value, selection.label,
      dimensionKeys);
    if (step === null) return;
    rerun({ type: 'DRILL_DOWN', step });
  };

  return (
    <div className="min-w-0 space-y-4">
      <RunBar run={run} blocked={blocked} request={request} />

      {issues.length > 0 && (
        <div>
          {issues.map((issue) => (
            <InlineNote key={issueKey(issue)} tone={blocksRun(issue) ? 'bad' : 'warn'}>
              {issueText(issue)}
            </InlineNote>
          ))}
        </div>
      )}

      {run.error !== null && <ErrorBanner message={run.error} />}

      <BiFilterEditor
        fields={filterFields}
        filters={state.filters}
        drillFrom={state.filters.length - state.trail.length}
        onAdd={(filter) => dispatch({ type: 'ADD_FILTER', filter })}
        onSet={(index, filter) => dispatch({ type: 'SET_FILTER', index, filter })}
        onRemove={(index) => dispatch({ type: 'REMOVE_FILTER', index })}
      />

      {state.trail.length > 0 && (
        <DrillTrail
          state={state}
          onTo={(depth) => rerun({ type: 'TRAIL_TO', depth })}
        />
      )}

      {run.result !== null && (
        <>
          <Panel
            title={t('النتيجة', 'Résultat', 'Result')}
            actions={<ResultMeta result={run.result} stale={stale} />}
          >
            <BiChart
              type={state.chartType}
              result={run.result}
              height={360}
              onSelect={select}
              datasetId={datasetId}
              filters={state.filters}
            />
            <div className="mt-4">
              <SqlBlock
                sql={run.result.compiled_sql}
                copyLabel={t('انسخ العبارة', 'Copier l’instruction', 'Copy the statement')}
              />
            </div>
          </Panel>
          {/* Only under a result, and handed the same `stale` the meta pill shows: a save is
              a claim that the definition below produced the chart above, and that claim is
              only true while the request has not moved on. */}
          <BiSaveAnalysis datasetId={datasetId} state={state} stale={stale} />
        </>
      )}
    </div>
  );
}

/**
 * The run control, and the one sentence that says which state the canvas is in.
 *
 * "Not run yet" is a different fact from "ran and returned nothing", and a canvas that
 * showed an empty chart for both would be telling the reader the dataset is empty when
 * nobody has asked it anything.
 */
function RunBar({ run, blocked, request }: {
  run: BiRunState;
  blocked: boolean;
  request: BiQueryRequest | null;
}) {
  const { t } = useBiI18n();
  const stale = run.result !== null && run.signature !== requestSignature(request);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run.run}
        disabled={blocked || run.running || request === null}
        className="btn btn-primary"
      >
        {run.runs === 0
          ? <Play className="h-3.5 w-3.5" aria-hidden="true" />
          : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
        {run.running
          ? t('يُشغّل…', 'Exécution…', 'Running…')
          : (run.runs === 0
            ? t('شغّل التحليل', 'Exécuter l’analyse', 'Run the analysis')
            : t('أعد التشغيل', 'Réexécuter', 'Run again'))}
      </button>

      {run.runs === 0 && (
        <span className="text-[12px] text-[var(--text-muted)]">
          {t('لم يُشغّل بعد — لا شيء يُقاس قبل الطلب',
            'Pas encore exécuté — rien n’est mesuré avant la demande',
            'Not run yet — nothing is measured before it is asked for')}
        </span>
      )}
      {blocked && run.runs === 0 && (
        <Pill tone="bad">{t('الطلب غير مكتمل', 'Requête incomplète', 'Request incomplete')}</Pill>
      )}
      {stale && !run.running && (
        <Pill tone="warn">
          {t('الطلب تغيّر بعد آخر قياس', 'La requête a changé depuis la dernière mesure',
            'The request changed after the last run')}
        </Pill>
      )}
    </div>
  );
}

/**
 * The drill trail, as a path back out.
 *
 * Every step is clickable because a drill is not a one-way door, and the last crumb is
 * printed rather than linked: it is where the reader already is.
 */
function DrillTrail({ state, onTo }: {
  state: BuilderState;
  onTo: (depth: number) => void;
}) {
  const { t } = useBiI18n();
  const last = state.trail.length - 1;

  return (
    <nav
      aria-label={t('مسار التنقيب', 'Chemin d’exploration', 'Drill path')}
      className="flex flex-wrap items-center gap-1 text-[12px]"
    >
      <button type="button" onClick={() => onTo(0)} className="btn btn-ghost btn-sm">
        {t('الكل', 'Tout', 'All')}
      </button>
      {state.trail.map((step, index) => (
        <span key={`${index}:${step.fromKey}`} className="flex items-center gap-1">
          <span aria-hidden="true" className="text-[var(--text-muted)]">/</span>
          {index === last ? (
            <span
              aria-current="page"
              className="rounded px-1.5 font-medium text-[var(--text-primary)]"
              title={step.fromKey}
            >
              {step.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onTo(index + 1)}
              className="btn btn-ghost btn-sm"
              title={step.fromKey}
            >
              {step.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * What the result is, beside it: how many rows, how long, whether the server stopped
 * early, and whether the request has moved on since.
 *
 * `row_count` is the server's own count rather than `rows.length`, because those two
 * disagreeing is a fact about the transport worth seeing rather than smoothing over.
 */
function ResultMeta({ result, stale }: { result: BiQuerySuccess; stale: boolean }) {
  const { t } = useBiI18n();

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
      <span className="tabular">
        {t(`${fmtInt(result.row_count)} صف`, `${fmtInt(result.row_count)} lignes`,
          `${fmtInt(result.row_count)} rows`)}
      </span>
      <span aria-hidden="true">·</span>
      <span className="tabular">{fmtMs(result.duration_ms)}</span>
      {result.truncated && (
        <Pill tone="warn">
          {t(`مبتور عند ${fmtInt(result.row_limit)}`, `Tronqué à ${fmtInt(result.row_limit)}`,
            `Truncated at ${fmtInt(result.row_limit)}`)}
        </Pill>
      )}
      {stale && (
        <Pill tone="warn">
          {t('قياس أقدم من الطلب', 'Mesuré avant la requête actuelle',
            'Measured under an earlier request')}
        </Pill>
      )}
    </div>
  );
}
