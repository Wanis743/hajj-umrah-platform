/**
 * BI — the write surface.
 *
 * Twenty-six commands in two families that behave nothing alike.
 *
 * Five are RPCs. Three of those run queries and hand rows back, one syncs the
 * source catalog, one moves a definition through its lifecycle. The other
 * twenty-one are table writes: the kernel delegates them to one `biTableCrud`
 * factory, which means their payload is a raw column map that nothing on the
 * way to Postgres inspects. A misspelled column there is not a type error, it
 * is a Postgres sentence at runtime — so every column name in this file was
 * read out of the two migrations rather than remembered, and the seven
 * `…Values` builders below are the only place in this application that spells
 * one.
 *
 * What is never sent, because the server owns it and would either overwrite the
 * value or refuse the row:
 *
 *   agency_id, branch_id          defaulted from the caller's staff profile
 *   created_at, updated_at        stamped by triggers
 *   created_by, updated_by        defaulted from auth.uid()
 *   status, published_*, deprecated_*, version
 *                                 owned by `bi.status.set`, which is the only
 *                                 door in and out of a lifecycle state
 *   lineage, is_additive          computed by triggers from the expression, so
 *                                 a value sent here is a value discarded
 *   query_count, last_queried_at  written by the compiler as queries run
 *
 * The three query commands never toast. A refused or failed query is an outcome
 * the server records and returns, and a screen that shows it in the results
 * panel tells the truth better than a toast that disappears; every one of them
 * returns a `BiRun` so there is exactly one shape to render.
 */

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  type AppId,
  type DataCommandName,
  type Localized,
  CHANNEL_ACTIVATED,
  useApp,
  useIpc,
  useLedgerCommand,
} from '@/platform/sdk';
import { REPORTS } from '../shared/paths';
import { asString } from '../shared/guards';
import { type BiRun, readChart, readDrill, readQuery, readSync } from './model';
import {
  BI_DECIMALS_MAX,
  BI_GRID_COLUMNS,
  BI_GRID_MAX_HEIGHT,
  BI_ROW_LIMIT_DEFAULT,
  BI_ROW_LIMIT_MAX,
  BI_ROW_LIMIT_MIN,
  type BiAggregate,
  type BiChartRun,
  type BiChartType,
  type BiDimensionDataType,
  type BiDrillKind,
  type BiDrillResult,
  type BiFilter,
  type BiGovernedKind,
  type BiMetricFormat,
  type BiOptions,
  type BiQueryResult,
  type BiScalar,
  type BiSourceSyncResult,
  type BiStatus,
  type BiTileGrid,
  type BiTimeGrain,
  type BiView,
} from './types';

/** Argument order is Arabic, French, English — the same order as `text()` in a manifest. */
const w = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

/** A column map on its way to the broker. Nothing checks what is in it. */
type Row = Readonly<Record<string, unknown>>;

/** Which write is in flight, so a screen can disable the right control rather
 *  than every control. `null` is rest.
 *
 *  `export` is here with the seven database verbs although it spends no database
 *  time at all: what it holds is a modal file dialog, and a second Ctrl+E landing
 *  while the first one is still open would stack two save sheets over one grid. */
export type BiBusy =
  | 'query' | 'chart' | 'drill' | 'sync' | 'status' | 'save' | 'delete' | 'export' | null;

interface Said {
  readonly ok: Localized;
  readonly bad: Localized;
}

type Act = (
  busy: BiBusy,
  command: DataCommandName,
  payload: Readonly<Record<string, unknown>>,
  said: Said,
) => Promise<boolean>;

function useAct(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: BiBusy) => void,
): Act {
  const { t } = useApp().locale;
  return useCallback(
    async (busy, command, payload, said) => {
      setBusy(busy);
      const ok = await ledger.run(
        { command, payload },
        { success: t(said.ok), failure: t(said.bad) },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, t],
  );
}

/** Drops keys whose value is `undefined`, so an optional RPC argument that was
 *  never collected is absent rather than explicitly nothing. Column maps use
 *  {@link kept} for the same purpose on the two columns no dialog can read. */
const only = (payload: Readonly<Record<string, unknown>>): Row => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, Math.round(value)));

/**
 * One column, included only when the draft actually supplied a value.
 *
 * Spread as `...kept('grain', draft.grain)`. An `undefined` draft field drops the
 * key, and a dropped key is a column PostgREST's partial update never mentions, so
 * it keeps whatever it held. `null` is a value and still clears the column. The
 * draft types do not force a caller to pass one or the other — `grain?: string |
 * null` admits `undefined` — so this is the difference between "the dialog could
 * not show this" and "the dialog chose to empty it", spent on the three columns
 * {@link BiMetricDraft.grain}, {@link BiTileDraft.titleOverride} and
 * {@link BiAnalysisDraft.description} name.
 */
const kept = (column: string, value: unknown): Row =>
  value === undefined ? {} : { [column]: value };

/* ------------------------------------------------------------------ *
 *  Running queries                                                     *
 * ------------------------------------------------------------------ */

export interface BiQueryRequest {
  readonly datasetId: string;
  readonly dimensions: readonly string[];
  readonly metrics: readonly string[];
  readonly filters?: readonly BiFilter[];
  readonly timeGrain?: BiTimeGrain | null;
  readonly orderBy?: string | null;
  readonly orderDesc?: boolean;
  readonly limit?: number;
  /** Set when the query came from a saved analysis, so the log can say so. */
  readonly visualizationId?: string | null;
}

/** A drill-through is clamped to 1..1000 with a default of 200 inside the
 *  compiler — a different pair from `BI_ROW_LIMIT_*`, because a drill is a list
 *  of rows somebody is about to read and an analysis is an aggregate. A dialog
 *  that bounds its input by the query constants would offer a number the server
 *  quietly reduces. */
export const BI_DRILL_LIMIT_DEFAULT = 200;
export const BI_DRILL_LIMIT_MAX = 1_000;

export interface BiDrillRequest {
  readonly datasetId: string;
  readonly dimensionKey: string;
  /** `null` is a value here and not an absence: it drills into the rows whose
   *  dimension is null, which is a real and frequently interesting group. */
  readonly value: BiScalar;
  readonly filters?: readonly BiFilter[];
  readonly limit?: number;
}

/* ------------------------------------------------------------------ *
 *  Definition drafts                                                   *
 * ------------------------------------------------------------------ */

/** Every column a dialog owns is sent, always — a form that leaves a field it
 *  *can* read back sends that field's value or a deliberate `null`, because the
 *  paired columns below (a drill's kind and expression, a ratio's two operands)
 *  are CHECK constraints that only make sense evaluated together, and because a
 *  cleared field has to be expressible somehow. Dialogs load the row first and
 *  edit a whole draft, which is also what the broker's own comment recommends.
 *
 *  Three fields are the exception, and `undefined` rather than `null` is how they
 *  say so: `bi_metrics.grain`, `bi_dashboard_tiles.title_override` and
 *  `bi_visualizations.description` are columns no read path returns, so no dialog
 *  can show one, and a save that wrote `null` for a value the dialog could not
 *  display would erase it silently. An update reaches a `bi_*` table as a
 *  PostgREST partial write — `sendWrite` sends only the keys it is handed — so a
 *  key left out of the map is a column left alone. `undefined` therefore means
 *  "cannot read this, do not touch it" and `null` still means "clear this".
 *  {@link kept} is the whole rule. */

export interface BiDatasetDraft {
  readonly key: string;
  readonly name: string;
  readonly nameAr?: string | null;
  readonly description?: string | null;
  /** Null only while the dataset is a draft: publishing requires a source. */
  readonly sourceId?: string | null;
  readonly timeColumn?: string | null;
  readonly rowFilter?: readonly BiFilter[];
}

export interface BiDimensionDraft {
  readonly datasetId: string;
  readonly key: string;
  readonly displayName: string;
  readonly displayNameAr?: string | null;
  readonly description?: string | null;
  readonly expression: string;
  readonly dataType: BiDimensionDataType;
  readonly sortOrder?: number;
  readonly isDefault?: boolean;
  readonly drillToKey?: string | null;
  readonly drillKind?: BiDrillKind | null;
  readonly drillExpression?: string | null;
}

export interface BiMetricDraft {
  readonly datasetId: string;
  readonly key: string;
  readonly displayName: string;
  readonly displayNameAr?: string | null;
  readonly description?: string | null;
  readonly aggregate: BiAggregate;
  /** Ignored when the aggregate is `RATIO`, which composes two sibling metrics
   *  rather than folding an expression of its own. */
  readonly formula: string;
  readonly filters?: readonly BiFilter[];
  readonly numeratorKey?: string | null;
  readonly denominatorKey?: string | null;
  readonly format: BiMetricFormat;
  readonly unit?: string | null;
  readonly decimals?: number;
  /** Left `undefined` by every dialog, because no read path returns it: the
   *  semantic layer's `bi_metrics.grain` predates the studio and
   *  `get_bi_dataset_detail` does not select it. Passing a value sets the column;
   *  passing `undefined` leaves whatever it holds. See {@link kept}. */
  readonly grain?: string | null;
  readonly sortOrder?: number;
}

export interface BiAnalysisDraft {
  readonly key: string;
  readonly title: string;
  readonly titleAr?: string | null;
  /** Left `undefined` by every dialog: `bi_visualizations.description` is stored
   *  and never read back — a report's nested analysis and a tile's nested
   *  `visualization` both omit the key — so nothing can show one to prefill.
   *  Passing a value sets it; `undefined` leaves it. See {@link kept}. */
  readonly description?: string | null;
  readonly datasetId: string;
  /** Which report holds this analysis, or `null` for one saved on its own.
   *  Recoverable on an edit even though the analysis payload has no such key
   *  outside lineage: `get_bi_reports` nests each analysis under its report, so
   *  the screen that opened the dialog already knows the parent. */
  readonly reportId?: string | null;
  readonly chartType: BiChartType;
  readonly dimensions: readonly string[];
  readonly measures: readonly string[];
  readonly filters?: readonly BiFilter[];
  readonly timeGrain?: BiTimeGrain | null;
  readonly orderBy?: string | null;
  readonly orderDesc?: boolean;
  readonly rowLimit?: number;
  readonly options?: BiOptions;
  readonly sortOrder?: number;
}

export interface BiReportDraft {
  readonly key: string;
  readonly title: string;
  readonly titleAr?: string | null;
  readonly description?: string | null;
  readonly sortOrder?: number;
}

export interface BiDashboardDraft {
  readonly key: string;
  readonly title: string;
  readonly titleAr?: string | null;
  readonly description?: string | null;
  readonly isDefault?: boolean;
  readonly sortOrder?: number;
}

export interface BiTileDraft {
  readonly dashboardId: string;
  /** The saved analysis this tile draws. `bi_dashboard_tiles` calls the column
   *  `visualization_id`; the application calls the thing an analysis. */
  readonly analysisId: string;
  /** `undefined` leaves the stored override alone, which is what a repositioning
   *  save does; only a rename passes a value, and `null` clears it back to the
   *  analysis's own title. See {@link kept}. */
  readonly titleOverride?: string | null;
  readonly grid: BiTileGrid;
  readonly options?: BiOptions;
  readonly sortOrder?: number;
}

/* ------------------------------------------------------------------ *
 *  Column maps                                                         *
 * ------------------------------------------------------------------ */

function datasetValues(draft: BiDatasetDraft): Row {
  return {
    key: draft.key,
    name: draft.name,
    display_name_ar: draft.nameAr ?? null,
    description: draft.description ?? null,
    source_id: draft.sourceId ?? null,
    default_time_column: draft.timeColumn ?? null,
    row_filter_json: draft.rowFilter ?? [],
  };
}

function dimensionValues(draft: BiDimensionDraft): Row {
  // `(drill_through_kind is null) = (drill_through_expression is null)` is a
  // CHECK. Half a pair is dropped here rather than sent and refused.
  const kind = draft.drillKind ?? null;
  const expression = draft.drillExpression ?? null;
  const paired = kind !== null && expression !== null;
  return {
    dataset_id: draft.datasetId,
    key: draft.key,
    display_name: draft.displayName,
    display_name_ar: draft.displayNameAr ?? null,
    description: draft.description ?? null,
    expression: draft.expression,
    data_type: draft.dataType,
    sort_order: draft.sortOrder ?? 0,
    is_default: draft.isDefault ?? false,
    drill_to_key: draft.drillToKey ?? null,
    drill_through_kind: paired ? kind : null,
    drill_through_expression: paired ? expression : null,
  };
}

function metricValues(draft: BiMetricDraft): Row {
  // A ratio owns no expression — the trigger clears `formula` — and every other
  // aggregate must carry neither operand key, which is a CHECK rather than a
  // convention. `is_additive` is measured by the same trigger and never sent.
  const ratio = draft.aggregate === 'RATIO';
  return {
    dataset_id: draft.datasetId,
    key: draft.key,
    display_name: draft.displayName,
    display_name_ar: draft.displayNameAr ?? null,
    description: draft.description ?? null,
    aggregate: draft.aggregate,
    formula: ratio ? '' : draft.formula,
    filter_json: draft.filters ?? [],
    numerator_metric_key: ratio ? (draft.numeratorKey ?? null) : null,
    denominator_metric_key: ratio ? (draft.denominatorKey ?? null) : null,
    format: draft.format,
    unit: draft.unit ?? null,
    decimals: clamp(draft.decimals ?? 2, 0, BI_DECIMALS_MAX),
    ...kept('grain', draft.grain),
    sort_order: draft.sortOrder ?? 0,
  };
}

function analysisValues(draft: BiAnalysisDraft): Row {
  return {
    key: draft.key,
    title: draft.title,
    title_ar: draft.titleAr ?? null,
    // Omitted unless a caller supplies one, for the reason {@link kept} states:
    // the column exists on `bi_visualizations`, and no read returns it. Neither
    // the tile's nested `visualization` object nor the flat analysis a report
    // nests carries a `description` key, so no dialog can prefill one, and a save
    // that volunteered `null` would empty a description its author could not see.
    // Off the map, an edit leaves whatever is stored. The report and dashboard
    // maps below do send theirs, because both of those reads return it.
    ...kept('description', draft.description),
    dataset_id: draft.datasetId,
    report_id: draft.reportId ?? null,
    chart_type: draft.chartType,
    dimensions: draft.dimensions,
    measures: draft.measures,
    filters: draft.filters ?? [],
    time_grain: draft.timeGrain ?? null,
    order_by: draft.orderBy ?? null,
    order_desc: draft.orderDesc ?? true,
    row_limit: clamp(
      draft.rowLimit ?? BI_ROW_LIMIT_DEFAULT, BI_ROW_LIMIT_MIN, BI_ROW_LIMIT_MAX,
    ),
    options: draft.options ?? {},
    sort_order: draft.sortOrder ?? 0,
  };
}

function reportValues(draft: BiReportDraft): Row {
  return {
    key: draft.key,
    title: draft.title,
    title_ar: draft.titleAr ?? null,
    description: draft.description ?? null,
    sort_order: draft.sortOrder ?? 0,
  };
}

function dashboardValues(draft: BiDashboardDraft): Row {
  return {
    key: draft.key,
    title: draft.title,
    title_ar: draft.titleAr ?? null,
    description: draft.description ?? null,
    is_default: draft.isDefault ?? false,
    sort_order: draft.sortOrder ?? 0,
  };
}

function tileValues(draft: BiTileDraft): Row {
  // `grid_x + grid_w <= 12` is a constraint, so a tile dragged past the right
  // edge is clamped to the edge instead of becoming a refused write.
  const x = clamp(draft.grid.x, 0, BI_GRID_COLUMNS - 1);
  return {
    dashboard_id: draft.dashboardId,
    visualization_id: draft.analysisId,
    // Omitted unless a caller supplies one. Nothing reads the override back --
    // `get_bi_dashboard` returns `coalesce(t.title_override, v.title)` as the
    // tile's `title` and does not return the override itself -- so a dialog that
    // prefilled this from what it displays would name the analysis's title, and a
    // save would pin it: the tile would stop following a renamed analysis, which
    // looks like a title that will not update rather than like a setting. Off the
    // map entirely, a save leaves the column alone.
    ...kept('title_override', draft.titleOverride),
    grid_x: x,
    grid_y: Math.max(0, Math.round(draft.grid.y)),
    grid_w: clamp(draft.grid.w, 1, BI_GRID_COLUMNS - x),
    grid_h: clamp(draft.grid.h, 1, BI_GRID_MAX_HEIGHT),
    options: draft.options ?? {},
    sort_order: draft.sortOrder ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 *  Queries                                                             *
 * ------------------------------------------------------------------ */

/** A transport or capability failure arrives with no server-side error frame,
 *  so one is written here in the shape the compiler uses. The screen then has a
 *  single error panel instead of two ways of being told the same thing. */
const unreachable = (message: string): BiRun<never> => ({
  ok: false,
  error: { code: 'unreachable', message, durationMs: 0 },
});

export interface BiQueryActions {
  readonly runQuery: (request: BiQueryRequest) => Promise<BiRun<BiQueryResult>>;
  readonly runAnalysis: (analysisId: string) => Promise<BiRun<BiChartRun>>;
  readonly drillThrough: (request: BiDrillRequest) => Promise<BiRun<BiDrillResult>>;
}

function useBiQueries(setBusy: (busy: BiBusy) => void): BiQueryActions {
  const runtime = useApp();

  const runQuery = useCallback(
    async (request: BiQueryRequest): Promise<BiRun<BiQueryResult>> => {
      setBusy('query');
      const outcome = await runtime.invoke('data.command', {
        command: 'bi.query.run',
        payload: only({
          datasetId: request.datasetId,
          dimensions: request.dimensions,
          metrics: request.metrics,
          filters: request.filters ?? [],
          timeGrain: request.timeGrain ?? undefined,
          orderBy: request.orderBy ?? undefined,
          orderDesc: request.orderDesc,
          limit: request.limit,
          visualizationId: request.visualizationId ?? undefined,
        }),
      });
      setBusy(null);
      return outcome.ok
        ? readQuery(outcome.value.result)
        : unreachable(outcome.error.message);
    },
    [runtime, setBusy],
  );

  const runAnalysis = useCallback(
    async (analysisId: string): Promise<BiRun<BiChartRun>> => {
      setBusy('chart');
      const outcome = await runtime.invoke('data.command', {
        command: 'bi.visualization.run',
        payload: { visualizationId: analysisId },
      });
      setBusy(null);
      return outcome.ok
        ? readChart(outcome.value.result)
        : unreachable(outcome.error.message);
    },
    [runtime, setBusy],
  );

  const drillThrough = useCallback(
    async (request: BiDrillRequest): Promise<BiRun<BiDrillResult>> => {
      setBusy('drill');
      const outcome = await runtime.invoke('data.command', {
        command: 'bi.drillThrough.run',
        payload: only({
          datasetId: request.datasetId,
          dimensionKey: request.dimensionKey,
          // Never stripped: a null dimension is a group somebody can open.
          value: request.value,
          filters: request.filters ?? [],
          limit: request.limit,
        }),
      });
      setBusy(null);
      return outcome.ok
        ? readDrill(outcome.value.result)
        : unreachable(outcome.error.message);
    },
    [runtime, setBusy],
  );

  return { runQuery, runAnalysis, drillThrough };
}

/* ------------------------------------------------------------------ *
 *  Governance                                                          *
 * ------------------------------------------------------------------ */

const STATUS_SAID: Said = {
  ok: w('تغيّرت الحالة', 'Statut modifié', 'Status changed'),
  bad: w('تعذّر تغيير الحالة', 'Changement de statut impossible', 'Could not change the status'),
};

const SYNC_SAID: Said = {
  ok: w('حُدِّث فهرس المصادر', 'Catalogue des sources actualisé', 'Source catalog refreshed'),
  bad: w('تعذّرت مزامنة المصادر', 'Synchronisation impossible', 'Could not sync the sources'),
};

const UNREADABLE = w(
  'ردّ الخادم بشيء غير مفهوم',
  'La réponse du serveur est illisible',
  'The server answered with something this screen could not read',
);

export interface BiGovernanceActions {
  /** The one door in and out of a lifecycle state. Nothing else writes
   *  `status`, `published_at`, `deprecated_at` or `version`. */
  readonly setStatus: (
    kind: BiGovernedKind, id: string, status: BiStatus, note?: string,
  ) => Promise<boolean>;
  readonly syncSources: () => Promise<BiSourceSyncResult | null>;
}

function useBiGovernance(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: BiBusy) => void,
): BiGovernanceActions {
  const runtime = useApp();
  const { t } = runtime.locale;
  const act = useAct(ledger, setBusy);

  const setStatus = useCallback(
    (kind: BiGovernedKind, id: string, status: BiStatus, note?: string) =>
      act('status', 'bi.status.set', only({ kind, id, status, note }), STATUS_SAID),
    [act],
  );

  const syncSources = useCallback(async (): Promise<BiSourceSyncResult | null> => {
    setBusy('sync');
    // The one command with no payload at all.
    const outcome = await runtime.invoke('data.command', {
      command: 'bi.sources.sync', payload: {},
    });
    setBusy(null);
    const title = t(SYNC_SAID.bad);
    if (!outcome.ok) {
      await runtime.toast({ kind: 'error', title, body: outcome.error.message });
      return null;
    }
    const result = readSync(outcome.value.result);
    if (result === null) {
      await runtime.toast({ kind: 'error', title, body: t(UNREADABLE) });
      return null;
    }
    await runtime.toast({ kind: 'success', title: t(SYNC_SAID.ok) });
    return result;
  }, [runtime, setBusy, t]);

  return { setStatus, syncSources };
}

/* ------------------------------------------------------------------ *
 *  Definitions                                                         *
 * ------------------------------------------------------------------ */

interface CrudNames {
  readonly create: DataCommandName;
  readonly update: DataCommandName;
  readonly remove: DataCommandName;
}

interface CrudSaid {
  readonly create: Said;
  readonly update: Said;
  readonly remove: Said;
}

/** What a screen gets for one kind of definition.
 *
 *  `create` hands back the new id, because an insert asks Postgres for it and a
 *  dialog that has just made a dataset usually wants to open it. `remove` hands
 *  back only whether it worked, because a delete returns nothing. */
export interface BiCrud<D> {
  readonly create: (draft: D) => Promise<string | null>;
  readonly update: (id: string, draft: D) => Promise<boolean>;
  readonly remove: (id: string) => Promise<boolean>;
}

/** Seven of these, one per table — the same symmetry the kernel's own binding
 *  table has, and for the same reason: twenty-one hand-written bodies is twenty
 *  opportunities to paste the wrong command name into the right function. */
function useCrud<D>(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: BiBusy) => void,
  names: CrudNames,
  values: (draft: D) => Row,
  said: CrudSaid,
): BiCrud<D> {
  const runtime = useApp();
  const { t } = runtime.locale;
  const act = useAct(ledger, setBusy);

  const create = useCallback(
    async (draft: D): Promise<string | null> => {
      setBusy('save');
      const outcome = await runtime.invoke('data.command', {
        command: names.create, payload: { values: values(draft) },
      });
      setBusy(null);
      if (!outcome.ok) {
        await runtime.toast({
          kind: 'error', title: t(said.create.bad), body: outcome.error.message,
        });
        return null;
      }
      await runtime.toast({ kind: 'success', title: t(said.create.ok) });
      return asString(outcome.value.result?.id);
    },
    [names, runtime, said, setBusy, t, values],
  );

  const update = useCallback(
    (id: string, draft: D) =>
      act('save', names.update, { id, values: values(draft) }, said.update),
    [act, names, said, values],
  );

  const remove = useCallback(
    (id: string) => act('delete', names.remove, { id }, said.remove),
    [act, names, said],
  );

  return { create, update, remove };
}

const DATASET_NAMES: CrudNames = {
  create: 'bi.dataset.create', update: 'bi.dataset.update', remove: 'bi.dataset.delete',
};
const DIMENSION_NAMES: CrudNames = {
  create: 'bi.dimension.create', update: 'bi.dimension.update', remove: 'bi.dimension.delete',
};
const METRIC_NAMES: CrudNames = {
  create: 'bi.metric.create', update: 'bi.metric.update', remove: 'bi.metric.delete',
};
const ANALYSIS_NAMES: CrudNames = {
  create: 'bi.visualization.create',
  update: 'bi.visualization.update',
  remove: 'bi.visualization.delete',
};
const REPORT_NAMES: CrudNames = {
  create: 'bi.report.create', update: 'bi.report.update', remove: 'bi.report.delete',
};
const DASHBOARD_NAMES: CrudNames = {
  create: 'bi.dashboard.create', update: 'bi.dashboard.update', remove: 'bi.dashboard.delete',
};
const TILE_NAMES: CrudNames = {
  create: 'bi.tile.create', update: 'bi.tile.update', remove: 'bi.tile.delete',
};

const DATASET_SAID: CrudSaid = {
  create: {
    ok: w('أُنشئت مجموعة البيانات', 'Jeu de données créé', 'Dataset created'),
    bad: w('تعذّر إنشاء مجموعة البيانات', 'Création impossible', 'Could not create the dataset'),
  },
  update: {
    ok: w('حُفظت مجموعة البيانات', 'Jeu de données enregistré', 'Dataset saved'),
    bad: w('تعذّر حفظ مجموعة البيانات', 'Enregistrement impossible', 'Could not save the dataset'),
  },
  remove: {
    ok: w('حُذفت مجموعة البيانات', 'Jeu de données supprimé', 'Dataset deleted'),
    bad: w('تعذّر حذف مجموعة البيانات', 'Suppression impossible', 'Could not delete the dataset'),
  },
};

const DIMENSION_SAID: CrudSaid = {
  create: {
    ok: w('أُضيف البعد', 'Dimension ajoutée', 'Dimension added'),
    bad: w('تعذّرت إضافة البعد', 'Ajout impossible', 'Could not add the dimension'),
  },
  update: {
    ok: w('حُفظ البعد', 'Dimension enregistrée', 'Dimension saved'),
    bad: w('تعذّر حفظ البعد', 'Enregistrement impossible', 'Could not save the dimension'),
  },
  remove: {
    ok: w('حُذف البعد', 'Dimension supprimée', 'Dimension deleted'),
    bad: w('تعذّر حذف البعد', 'Suppression impossible', 'Could not delete the dimension'),
  },
};

const METRIC_SAID: CrudSaid = {
  create: {
    ok: w('أُضيف المؤشّر', 'Mesure ajoutée', 'Metric added'),
    bad: w('تعذّرت إضافة المؤشّر', 'Ajout impossible', 'Could not add the metric'),
  },
  update: {
    ok: w('حُفظ المؤشّر', 'Mesure enregistrée', 'Metric saved'),
    bad: w('تعذّر حفظ المؤشّر', 'Enregistrement impossible', 'Could not save the metric'),
  },
  remove: {
    ok: w('حُذف المؤشّر', 'Mesure supprimée', 'Metric deleted'),
    bad: w('تعذّر حذف المؤشّر', 'Suppression impossible', 'Could not delete the metric'),
  },
};

const ANALYSIS_SAID: CrudSaid = {
  create: {
    ok: w('أُنشئ التحليل', 'Analyse créée', 'Analysis created'),
    bad: w('تعذّر إنشاء التحليل', 'Création impossible', 'Could not create the analysis'),
  },
  update: {
    ok: w('حُفظ التحليل', 'Analyse enregistrée', 'Analysis saved'),
    bad: w('تعذّر حفظ التحليل', 'Enregistrement impossible', 'Could not save the analysis'),
  },
  remove: {
    ok: w('حُذف التحليل', 'Analyse supprimée', 'Analysis deleted'),
    bad: w('تعذّر حذف التحليل', 'Suppression impossible', 'Could not delete the analysis'),
  },
};

const REPORT_SAID: CrudSaid = {
  create: {
    ok: w('أُنشئ التقرير', 'Rapport créé', 'Report created'),
    bad: w('تعذّر إنشاء التقرير', 'Création impossible', 'Could not create the report'),
  },
  update: {
    ok: w('حُفظ التقرير', 'Rapport enregistré', 'Report saved'),
    bad: w('تعذّر حفظ التقرير', 'Enregistrement impossible', 'Could not save the report'),
  },
  remove: {
    ok: w('حُذف التقرير', 'Rapport supprimé', 'Report deleted'),
    bad: w('تعذّر حذف التقرير', 'Suppression impossible', 'Could not delete the report'),
  },
};

const DASHBOARD_SAID: CrudSaid = {
  create: {
    ok: w('أُنشئت اللوحة', 'Tableau de bord créé', 'Dashboard created'),
    bad: w('تعذّر إنشاء اللوحة', 'Création impossible', 'Could not create the dashboard'),
  },
  update: {
    ok: w('حُفظت اللوحة', 'Tableau de bord enregistré', 'Dashboard saved'),
    bad: w('تعذّر حفظ اللوحة', 'Enregistrement impossible', 'Could not save the dashboard'),
  },
  remove: {
    ok: w('حُذفت اللوحة', 'Tableau de bord supprimé', 'Dashboard deleted'),
    bad: w('تعذّر حذف اللوحة', 'Suppression impossible', 'Could not delete the dashboard'),
  },
};

const TILE_SAID: CrudSaid = {
  create: {
    ok: w('أُضيفت البطاقة', 'Vignette ajoutée', 'Tile added'),
    bad: w('تعذّرت إضافة البطاقة', 'Ajout impossible', 'Could not add the tile'),
  },
  update: {
    ok: w('حُفظت البطاقة', 'Vignette enregistrée', 'Tile saved'),
    bad: w('تعذّر حفظ البطاقة', 'Enregistrement impossible', 'Could not save the tile'),
  },
  remove: {
    ok: w('أُزيلت البطاقة', 'Vignette retirée', 'Tile removed'),
    bad: w('تعذّرت إزالة البطاقة', 'Retrait impossible', 'Could not remove the tile'),
  },
};

/* ------------------------------------------------------------------ *
 *  The shell syscalls                                                  *
 * ------------------------------------------------------------------ */

/**
 * The keyboard, resolved against the manifest's own accelerators.
 *
 * Ids come from the manifest's vocabulary, so the palette and the keyboard reach
 * the same handler and cannot drift apart. `dashboard:new` and `source:sync` are
 * absent because the manifest gives them no accelerator, and inventing one here
 * would publish a chord the palette does not show.
 *
 * Nothing is suppressed per view, and the export key is why. Documents withholds
 * Ctrl+E on its dashboard because a panel of tiles is not a rectangle; here the
 * overview exports in long form — one row per number on the tab — so every one of
 * the seven views has a file worth writing and the key never has to mean nothing.
 *
 * `analysis:save` is claimed on every view, including those that cannot save
 * anything, because the browser's own Ctrl+S opens a save-page sheet over the
 * window; the shell claims the chord, refuses it quietly and the sheet never
 * appears. `run` is claimed everywhere for a milder version of the same reason —
 * the builder's state outlives a view change, so Ctrl+Enter is a sentence about
 * the analysis being composed rather than about what is currently painted, and
 * `blocksRun` is the honest gate for it rather than a view name.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey || event.shiftKey) return null;
  // Checked before the letters: `Enter` lower-cases to `enter`, not to a letter.
  if (event.key === 'Enter') return 'run';
  const key = event.key.toLowerCase();
  if (key === 'n') return 'dataset:new';
  if (key === 'f') return 'search';
  if (key === 's') return 'analysis:save';
  if (key === 'e') return 'export';
  return null;
}

/**
 * Arriving with somewhere to be.
 *
 * Four keys, one per thing this app can be pointed at by name. A lineage target is
 * absent on purpose: it is a kind *and* an id, and a launch argument map that has
 * to be read two keys at a time is a different shape than this one.
 */
const ARG_VIEW: Readonly<Record<string, BiView>> = {
  analysisId: 'analysis',
  dashboardId: 'dashboards',
  reportId: 'reports',
  datasetId: 'catalog',
};

export interface BiTarget {
  readonly view: BiView;
  readonly id: string;
}

const targetFrom = (args: Readonly<Record<string, string>> | undefined): BiTarget | null => {
  if (args === undefined) return null;
  for (const [key, view] of Object.entries(ARG_VIEW)) {
    const id = args[key];
    if (id !== undefined && id !== '') return { view, id };
  }
  return null;
};

/**
 * Two doors into the same room: the launch that created the window, read once
 * behind a latch, and every later activation of a window that already existed,
 * read every time. A ref holds the newest callback so the subscription does not
 * have to be torn down and rebuilt whenever the shell re-renders.
 */
export function useBiFocus(onTarget: (target: BiTarget) => void): void {
  const runtime = useApp();
  const sink = useRef(onTarget);
  sink.current = onTarget;
  const launched = useRef(false);

  useEffect(() => {
    if (launched.current) return;
    const target = targetFrom(runtime.args);
    if (target === null) return;
    launched.current = true;
    sink.current(target);
  }, [runtime]);

  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const target = targetFrom(payload?.args);
    if (target !== null) sink.current(target);
  });
}

const fileName = (view: BiView, today: string): string => `bi-${view}-${today}.csv`;

export interface BiTransferActions {
  readonly exportCsv: (view: BiView, content: string, today: string) => void;
  readonly copy: (text: string) => void;
  /** Cross-app, carrying an argument: drill-through is the whole reason this app
   *  holds `shell.launch`. A cell stands for rows another app owns. */
  readonly openApp: (app: AppId, args?: Readonly<Record<string, string>>) => void;
}

/**
 * The three verbs that move something out of the window.
 *
 * All three return `void` rather than a promise, for the reason Documents gives:
 * nothing downstream branches on whether a copy succeeded. A dialog needs to know
 * whether its save worked so it can stay open; a toolbar button does not, so the
 * promise is consumed here and the caller gets a plain click handler.
 *
 * `exportCsv` is the only one that touches `busy`, because it is the only one that
 * opens a sheet the user can sit in front of.
 */
function useBiTransfer(setBusy: (busy: BiBusy) => void): BiTransferActions {
  const runtime = useApp();
  const { tr } = runtime.locale;

  const exportCsv = useCallback(
    (view: BiView, content: string, today: string): void => {
      const run = async (): Promise<void> => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير CSV', 'Exporter en CSV', 'Export as CSV'),
          startPath: REPORTS,
          suggestedName: fileName(view, today),
          contentTypes: ['text/csv'],
        });
        // A cancelled dialog is an answer, not a failure: nothing is said about it.
        const path = chosen.ok ? chosen.value.path : null;
        if (path === null) {
          setBusy(null);
          return;
        }
        const written = await runtime.invoke('fs.writeText', {
          path,
          content,
          contentType: 'text/csv',
        });
        setBusy(null);
        await runtime.toast(
          written.ok
            ? { kind: 'success', title: tr('تم التصدير', 'Exporté', 'Exported'), body: path }
            : {
                kind: 'error',
                title: tr('تعذّر التصدير', 'Export impossible', 'Export failed'),
                body: written.error.message,
              },
        );
      };
      void run();
    },
    [runtime, setBusy, tr],
  );

  /**
   * Compiled SQL, a dataset key, a metric's formula — what somebody lifts out of
   * this app to paste into a ticket or a migration. Nothing to copy is not a
   * failure: the row was simply one the server sent without that column.
   */
  const copy = useCallback(
    (text: string): void => {
      if (text === '') return;
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) =>
        runtime.toast(
          result.ok
            ? { kind: 'success', title: tr('تم النسخ', 'Copié', 'Copied') }
            : { kind: 'error', title: tr('تعذّر النسخ', 'Copie impossible', 'Copy failed') },
        ),
      );
    },
    [runtime, tr],
  );

  const openApp = useCallback(
    (app: AppId, args?: Readonly<Record<string, string>>) => void runtime.launch(app, args),
    [runtime],
  );

  return { exportCsv, copy, openApp };
}

/* ------------------------------------------------------------------ *
 *  The surface                                                         *
 * ------------------------------------------------------------------ */

/** Queries and governance are flat; the definitions are namespaced by kind.
 *  DMS spreads everything flat because its twenty-odd verbs are all different
 *  from each other. Here twenty-one of them are the same three verbs applied to
 *  seven things, and `actions.metric.update` says which three far better than
 *  `updateMetric` next to `updateMetricFilter` would. */
export interface BiActions extends BiQueryActions, BiGovernanceActions, BiTransferActions {
  readonly busy: BiBusy;
  readonly dataset: BiCrud<BiDatasetDraft>;
  readonly dimension: BiCrud<BiDimensionDraft>;
  readonly metric: BiCrud<BiMetricDraft>;
  readonly analysis: BiCrud<BiAnalysisDraft>;
  readonly report: BiCrud<BiReportDraft>;
  readonly dashboard: BiCrud<BiDashboardDraft>;
  readonly tile: BiCrud<BiTileDraft>;
}

export function useBiActions(): BiActions {
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<BiBusy>(null);
  const queries = useBiQueries(setBusy);
  const governance = useBiGovernance(ledger, setBusy);
  const transfer = useBiTransfer(setBusy);
  return {
    busy,
    ...queries,
    ...governance,
    ...transfer,
    dataset: useCrud(ledger, setBusy, DATASET_NAMES, datasetValues, DATASET_SAID),
    dimension: useCrud(ledger, setBusy, DIMENSION_NAMES, dimensionValues, DIMENSION_SAID),
    metric: useCrud(ledger, setBusy, METRIC_NAMES, metricValues, METRIC_SAID),
    analysis: useCrud(ledger, setBusy, ANALYSIS_NAMES, analysisValues, ANALYSIS_SAID),
    report: useCrud(ledger, setBusy, REPORT_NAMES, reportValues, REPORT_SAID),
    dashboard: useCrud(ledger, setBusy, DASHBOARD_NAMES, dashboardValues, DASHBOARD_SAID),
    tile: useCrud(ledger, setBusy, TILE_NAMES, tileValues, TILE_SAID),
  };
}
