/**
 * Everything a Business Intelligence window holds that is not a pixel.
 *
 * The same seam `../dms/shell.ts` draws, and drawn the same way: small hooks that
 * each own one kind of state, and one assembly function that wires them in a fixed
 * order and hands the result to `App.tsx`. Nothing here renders. A test can mount
 * `useBiShell`, dispatch a command, and read back what the chrome would have drawn
 * without a renderer being involved.
 *
 * ## Why several hooks and not one
 *
 * The pieces have genuinely different lifetimes. Chrome state — which view, what is
 * typed in the search box, which row is lit — survives every dialog and every query.
 * The builder survives a dialog but not a reload. A dialog is the shortest-lived
 * thing on the screen and exists only between an open and a commit. Folding them
 * together would mean one `useState` whose updater has to know which of the three
 * questions it is answering, and every setter would begin by proving it is not
 * about to clobber the other two.
 *
 * ## What this file owns that the rest of the app does not
 *
 * **Search.** The broker's `where` speaks equality and `in`, not `ilike`, so a
 * search box is a client concern — `./model` exports `hit` and `filterAll` and this
 * is the one place that calls them. The filtered lists are computed once per render
 * and then reused three times: the list pane draws them, `shown`/`total` counts
 * them, and the CSV exports exactly what is on screen. An export that quietly wrote
 * rows the reader had filtered away would be a different document than the one they
 * were looking at.
 *
 * **Truncation.** A result that hit its row limit is a partial answer, and exporting
 * one without saying so hands somebody a CSV that looks complete. The shell knows —
 * `BiQueryResult.truncated` is read from the server rather than guessed — so it
 * publishes {@link BiShell.truncated} and the chrome draws the warning beside the
 * export button. The notice lives here rather than in `./actions`'s export toast
 * because a toast arrives after the file is written, which is one moment too late.
 *
 * **Which rows can be edited from a list.** Two of the definition kinds are returned
 * whole by their list read and can be edited straight from a row. The rest are not:
 * a dataset's editable record lives in `get_bi_dataset_detail`, and so do its
 * dimensions and metrics; a tile's lives in `get_bi_dashboard`. Their verbs read the
 * open detail and do nothing when it has not arrived, which is why the chrome
 * disables them while the detail is loading rather than opening an empty dialog.
 */

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, Ref } from 'react';

import { APP_IDS, useLocale, type AppId } from '@/platform/sdk';

import { hotkey, useBiActions, useBiFocus } from './actions';
import type {
  BiActions,
  BiAnalysisDraft,
  BiBusy,
  BiCrud,
  BiDashboardDraft,
  BiDatasetDraft,
  BiDimensionDraft,
  BiMetricDraft,
  BiQueryRequest,
  BiReportDraft,
  BiTarget,
  BiTileDraft,
} from './actions';
import {
  blocksRun,
  builderReducer,
  drillStepFor,
  initialBuilderState,
  readiness,
  requestSignature,
  toQueryRequest,
} from './builder';
import type { BuilderAction, BuilderIssue, BuilderState } from './builder';
import { biClipboard, biCsv } from './export';
import type { BiExportScope, Translate } from './export';
import { isoToday } from './format';
import {
  analysisFormOf,
  builderStateOf,
  dashboardFormOf,
  datasetFormOf,
  dimensionFormOf,
  EMPTY_ANALYSIS,
  EMPTY_DASHBOARD,
  EMPTY_DATASET,
  EMPTY_DIMENSION,
  EMPTY_METRIC,
  EMPTY_REPORT,
  EMPTY_TILE,
  metricFormOf,
  reportFormOf,
  tileFormOf,
  toAnalysisDraft,
  toDashboardDraft,
  toDatasetDraft,
  toDimensionDraft,
  toMetricDraft,
  toReportDraft,
  toTileDraft,
} from './forms';
import type {
  AnalysisForm,
  DashboardForm,
  DatasetForm,
  DimensionForm,
  MetricForm,
  ReportForm,
  TileForm,
} from './forms';
import { filterAll, hit, useBiModel } from './model';
import type {
  BiDrillTarget,
  BiEventScope,
  BiLineageTarget,
  BiModel,
  BiRun,
} from './model';
import type {
  BiAnalysis,
  BiChartType,
  BiColumn,
  BiDashboard,
  BiDataset,
  BiDatasetDetail,
  BiDimension,
  BiDrillKind,
  BiDrillResult,
  BiEvent,
  BiFilter,
  BiGovernedKind,
  BiMetric,
  BiQueryEntry,
  BiQueryOutcome,
  BiQueryResult,
  BiReport,
  BiScalar,
  BiStatus,
  BiTile,
  BiView,
} from './types';

/* ------------------------------------------------------------------ *
 *  The selectable row                                                  *
 * ------------------------------------------------------------------ */

/**
 * Anything a list pane can light up, across all five views that have a list.
 *
 * Named `BiListRow` and not `BiRow` because `./types` already spends that name on
 * `Readonly<Record<string, BiScalar>>` — a row *of a result*, which is a different
 * thing from a row *of a list* and is the one a chart iterates.
 *
 * `overview` and `analysis` are absent on purpose. Neither draws a list: the first
 * is a set of cards and the second is a builder over a result grid, whose cells are
 * addressed by column and value rather than by row id.
 */
export type BiListRow = BiDataset | BiDashboard | BiReport | BiQueryEntry | BiEvent;

/**
 * Five guards, each naming a field only one of the five carries.
 *
 * `in` rather than a discriminant field, because these are read models assembled
 * from five different RPCs and none of them was given a `kind` tag for the benefit
 * of a union that did not exist when they were written. The fields chosen are the
 * ones each shape has that no other does — a dataset counts dimensions, a dashboard
 * counts tiles, a report nests analyses, a query log line records an outcome, and a
 * ledger line records an event type.
 */
export const isDataset = (row: BiListRow): row is BiDataset => 'dimensionCount' in row;
export const isDashboard = (row: BiListRow): row is BiDashboard => 'tileCount' in row;
export const isReport = (row: BiListRow): row is BiReport => 'analyses' in row;
export const isQueryEntry = (row: BiListRow): row is BiQueryEntry => 'outcome' in row;
export const isEvent = (row: BiListRow): row is BiEvent => 'eventType' in row;

/** What a title bar says when this row is the subject. A query log line falls back
 *  twice, because `get_bi_query_log` left-joins the dataset and a run against one
 *  that has since been deleted keeps its id and loses its name. */
export function labelOf(row: BiListRow): string {
  if (isDataset(row)) return row.name;
  if (isDashboard(row) || isReport(row)) return row.title;
  if (isQueryEntry(row)) return row.datasetName ?? row.datasetKey ?? row.id;
  return row.eventType;
}

/** Which of the governed kinds this row is, or none. Two of the five list rows are
 *  history rather than definitions: a query log line and a ledger line have no
 *  status to move, which is what `null` says here. */
export function governedKindOf(row: BiListRow): BiGovernedKind | null {
  if (isDataset(row)) return 'DATASET';
  if (isDashboard(row)) return 'DASHBOARD';
  if (isReport(row)) return 'REPORT';
  return null;
}

/** The status a governance dialog should open on, so the select starts where the
 *  row already is rather than on the first member of the enum. */
export function statusOf(row: BiListRow): BiStatus | null {
  if (isDataset(row) || isDashboard(row) || isReport(row)) return row.status;
  return null;
}

/* ------------------------------------------------------------------ *
 *  Views, selection, and the definitions a delete can name             *
 * ------------------------------------------------------------------ */

/** The seven definition tables, as the seven `BiCrud`s on {@link BiActions} name
 *  them. A delete dialog carries one of these instead of seven near-identical
 *  dialog members. */
export type BiCrudKind =
  | 'dataset' | 'dimension' | 'metric' | 'analysis' | 'report' | 'dashboard' | 'tile';

/**
 * Every `BiCrud`'s delete, regardless of its draft type.
 *
 * `remove` has the same signature on all seven — id in, boolean out — so a delete
 * can be dispatched from a table where `create` and `update` could not be, since
 * those differ by draft. `BiCrud<never>` picks out that one verb without naming a
 * draft, which is exactly what a delete does not need to know.
 */
type Remove = BiCrud<never>['remove'];

const REMOVER: Readonly<Record<BiCrudKind, (actions: BiActions) => Remove>> = {
  dataset: (actions) => actions.dataset.remove,
  dimension: (actions) => actions.dimension.remove,
  metric: (actions) => actions.metric.remove,
  analysis: (actions) => actions.analysis.remove,
  report: (actions) => actions.report.remove,
  dashboard: (actions) => actions.dashboard.remove,
  tile: (actions) => actions.tile.remove,
};

/** The nav rail's jump ids. Four of the seven are also declared as commands in
 *  `./manifest.ts` and reachable from the launcher's palette; all seven are here so
 *  the rail has one path to a view rather than two. */
const VIEW_COMMAND: Readonly<Record<string, BiView>> = {
  'view:overview': 'overview',
  'view:catalog': 'catalog',
  'view:analysis': 'analysis',
  'view:dashboards': 'dashboards',
  'view:reports': 'reports',
  'view:queries': 'queries',
  'view:events': 'events',
};

/** One highlighted row per view, so moving to Reports and back finds the dataset
 *  still lit. `overview` and `analysis` keep a slot they never fill, because a
 *  `Record<BiView, …>` that is complete is one no view can fall out of. */
export type BiSelection = Readonly<Record<BiView, string | null>>;

const EMPTY_SELECTION: BiSelection = {
  overview: null, catalog: null, analysis: null, dashboards: null,
  reports: null, queries: null, events: null,
};

/**
 * Where a drill-through can actually send somebody, and under what argument name.
 *
 * Four of the eleven drill kinds, for the reason `../dms/shell.ts` gives about its
 * own three: an "Open in …" that lands on the destination app's default screen
 * rather than on the row is worse than no verb at all. CRM reads `customerId`,
 * `quoteId` and `opportunityId`; Documents reads `documentId`. Nothing yet reads a
 * booking, a pilgrim, a package, an invoice, a payment, a journal entry or a lead,
 * so those seven kinds offer the id list and no jump. Widening this table is a
 * change to the destination app, not to this one.
 */
export interface BiDrillJump {
  readonly app: AppId;
  readonly key: string;
}

/** Exported because the drill dialog has to know the answer before it draws a
 *  button: seven of the eleven kinds have nowhere to go, and an "Open in …" that
 *  quietly does nothing is worse than a dialog that offers the id list instead. */
export const DRILL_JUMP: Readonly<Partial<Record<BiDrillKind, BiDrillJump>>> = {
  CRM_CUSTOMER: { app: APP_IDS.crm, key: 'customerId' },
  CRM_QUOTE: { app: APP_IDS.crm, key: 'quoteId' },
  CRM_OPPORTUNITY: { app: APP_IDS.crm, key: 'opportunityId' },
  DOCUMENT: { app: APP_IDS.dms, key: 'documentId' },
};

/* ------------------------------------------------------------------ *
 *  Search                                                              *
 * ------------------------------------------------------------------ */

/** The five lists a search box narrows, already narrowed. Computed once per render
 *  and read three times — by the list pane, by the counts, and by the CSV. */
export interface BiVisible {
  readonly datasets: readonly BiDataset[];
  readonly dashboards: readonly BiDashboard[];
  readonly reports: readonly BiReport[];
  readonly queries: readonly BiQueryEntry[];
  readonly events: readonly BiEvent[];
}

/**
 * What each kind of row is searched *by*.
 *
 * Keys as well as names, because a semantic layer is addressed by key in every
 * ticket written about it and `bookings_by_month` is what somebody types. The
 * bilingual name is included so an Arabic reader finds the row they can see.
 * `hit` lowercases the haystack only, so the needle is lowered once here rather
 * than on every field of every row.
 */
function biVisible(model: BiModel, search: string): BiVisible {
  const needle = search.trim().toLowerCase();
  return {
    datasets: filterAll(model.datasets, needle, (row) => hit(
      needle, row.key, row.name, row.nameAr, row.description, row.sourceKey, row.sourceName,
    )),
    dashboards: filterAll(model.dashboards.rows, needle, (row) => hit(
      needle, row.key, row.title, row.titleAr, row.description,
    )),
    reports: filterAll(model.reports.rows, needle, (row) => hit(
      needle, row.key, row.title, row.titleAr, row.description,
    )),
    queries: filterAll(model.queries.rows, needle, (row) => hit(
      needle, row.datasetKey, row.datasetName, row.visualizationTitle,
      row.actorRole, row.errorCode, row.errorMessage,
    )),
    events: filterAll(model.events.rows, needle, (row) => hit(
      needle, row.eventType, row.entityKind, row.entityId, row.actorRole, row.note,
    )),
  };
}

/** The row a selected id stands for, resolved against what is actually on screen.
 *  A selection that survived a refresh into a list that no longer holds it reads as
 *  nothing selected, which is the truth. */
function findRow(visible: BiVisible, view: BiView, id: string | null): BiListRow | null {
  if (id === null) return null;
  const of = (rows: readonly BiListRow[]): BiListRow | null =>
    rows.find((row) => row.id === id) ?? null;
  if (view === 'catalog') return of(visible.datasets);
  if (view === 'dashboards') return of(visible.dashboards);
  if (view === 'reports') return of(visible.reports);
  if (view === 'queries') return of(visible.queries);
  if (view === 'events') return of(visible.events);
  return null;
}

/** How many rows the current view is showing out of how many it read. The analysis
 *  view answers with its result grid, which is the list it has — and `rowCount` is
 *  the server's count, so a truncated result honestly shows fewer than it found. */
function tally(
  model: BiModel, visible: BiVisible, view: BiView, result: BiQueryResult | null,
): { readonly shown: number; readonly total: number } {
  if (view === 'catalog') {
    return { shown: visible.datasets.length, total: model.datasets.length };
  }
  if (view === 'dashboards') {
    return { shown: visible.dashboards.length, total: model.dashboards.rows.length };
  }
  if (view === 'reports') {
    return { shown: visible.reports.length, total: model.reports.rows.length };
  }
  if (view === 'queries') {
    return { shown: visible.queries.length, total: model.queries.rows.length };
  }
  if (view === 'events') {
    return { shown: visible.events.length, total: model.events.rows.length };
  }
  if (view === 'analysis') {
    return { shown: result?.rows.length ?? 0, total: result?.rowCount ?? 0 };
  }
  return { shown: 0, total: 0 };
}

/* ------------------------------------------------------------------ *
 *  Chrome                                                              *
 * ------------------------------------------------------------------ */

/** Where a context menu was asked for, and about what. */
export interface BiAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: BiListRow;
}

export interface BiUi {
  readonly view: BiView;
  readonly search: string;
  readonly selection: BiSelection;
  readonly selectedId: string | null;
  readonly menu: BiAnchor | null;
  readonly lineage: BiLineageTarget | null;
  readonly drill: BiDrillTarget | null;
  readonly outcome: BiQueryOutcome | null;
  readonly events: BiEventScope;
  readonly changeView: (view: BiView) => void;
  readonly setSearch: (search: string) => void;
  readonly pickRow: (id: string | null) => void;
  /** Go to a row in a named view. The only mover that crosses views, and the only
   *  one the overview needs. */
  readonly focus: (target: BiTarget) => void;
  readonly openMenu: (event: MouseEvent<Element>, row: BiListRow) => void;
  readonly closeMenu: () => void;
  readonly showLineage: (target: BiLineageTarget | null) => void;
  readonly showDrillPath: (target: BiDrillTarget | null) => void;
  readonly setOutcome: (outcome: BiQueryOutcome | null) => void;
  readonly setEventScope: (scope: BiEventScope) => void;
}

const NO_SCOPE: BiEventScope = { kind: null, id: null };

/**
 * The chrome's own state: the questions the reads are parameterised by.
 *
 * Some are filters the reader set and the rest are pointers the reader followed.
 * They live together because they change together — every one of them is cleared or
 * narrowed by moving to another view, and a `changeView` that had to reach into five
 * hooks to do it would be the seam in the wrong place.
 *
 * `useBiFocus` sets the view, the selection and the menu in one pass, because a
 * launch argument names a row in a view and arriving with the previous view's
 * flyout still open would be a window that reopened wrong.
 */
export function useBiUi(): BiUi {
  const [view, setView] = useState<BiView>('overview');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<BiSelection>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<BiAnchor | null>(null);
  const [lineage, setLineage] = useState<BiLineageTarget | null>(null);
  const [drill, setDrill] = useState<BiDrillTarget | null>(null);
  const [outcome, setOutcome] = useState<BiQueryOutcome | null>(null);
  const [events, setEventScope] = useState<BiEventScope>(NO_SCOPE);

  /** Lineage and the drill hierarchy are both "what I was looking at in the pane
   *  I just left", so neither follows the reader to the next view. */
  const changeView = useCallback((next: BiView): void => {
    setView(next);
    setMenu(null);
    setLineage(null);
    setDrill(null);
  }, []);

  const pickRow = useCallback((id: string | null): void => {
    setSelection((current) => ({ ...current, [view]: id }));
  }, [view]);

  /** Select before placing, so a right-click on an unselected row acts on the row
   *  under the cursor rather than on whatever was lit before. */
  const openMenu = useCallback((event: MouseEvent<Element>, row: BiListRow): void => {
    event.preventDefault();
    setSelection((current) => ({ ...current, [view]: row.id }));
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, [view]);

  const closeMenu = useCallback((): void => setMenu(null), []);

  /**
   * Go to a row in a named view, in one pass.
   *
   * Not `changeView` followed by `pickRow`: `pickRow` writes to the view its closure
   * captured, which during the same event is still the view being left — so the pair
   * would file the id under the old tab and light nothing under the new one. Writing
   * `target.view` explicitly is what makes the move atomic.
   *
   * Lineage and the drill hierarchy are dropped for the same reason `changeView` drops
   * them: both are "what I was looking at in the pane I just left".
   */
  const focus = useCallback((target: BiTarget): void => {
    setView(target.view);
    setMenu(null);
    setLineage(null);
    setDrill(null);
    setSelection((current) => ({ ...current, [target.view]: target.id }));
  }, []);

  useBiFocus(focus);

  return {
    view, search, selection, selectedId: selection[view], menu, lineage, drill, outcome, events,
    changeView, setSearch, pickRow, openMenu, closeMenu, focus,
    showLineage: setLineage, showDrillPath: setDrill, setOutcome, setEventScope,
  };
}

/* ------------------------------------------------------------------ *
 *  The builder                                                         *
 * ------------------------------------------------------------------ */

export interface BiBuilder {
  readonly state: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
  /** The query the shelves currently describe, or `null` when they describe none.
   *  Computed once here so the save dialog and the staleness stamp read the same
   *  object rather than two that were built a render apart. */
  readonly request: BiQueryRequest | null;
  /** The saved analysis currently on the shelves, and the report it came from.
   *  Both are context a save needs and neither is derivable from the query. */
  readonly loaded: BiAnalysis | null;
  readonly reportId: string | null;
  readonly run: BiRun<BiQueryResult> | null;
  readonly result: BiQueryResult | null;
  /** Whether the shelves have changed since the result on screen was fetched.
   *  Signed by {@link requestSignature}, which deliberately omits the chart type:
   *  redrawing the same numbers as a bar instead of a line does not make them old. */
  readonly stale: boolean;
  readonly runNow: () => Promise<void>;
  readonly load: (analysis: BiAnalysis, reportId: string | null) => void;
  readonly reset: (datasetId: string | null) => void;
}

/**
 * The query being composed, the answer it last got, and whether the two still
 * describe each other.
 *
 * `useReducer` rather than `useState` because `./builder` already owns every legal
 * transition — fourteen of them, several of which have to re-sanitise the sort or
 * drop the drill trail — and a shell that re-implemented any of that would be a
 * second opinion about what a shelf does.
 */
export function useBiBuilder(actions: BiActions): BiBuilder {
  const [state, dispatch] = useReducer(builderReducer, initialBuilderState());
  const [loaded, setLoaded] = useState<BiAnalysis | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [run, setRun] = useState<BiRun<BiQueryResult> | null>(null);
  const [signature, setSignature] = useState('');

  const request = toQueryRequest(state, loaded?.id ?? null);
  const current = request === null ? '' : requestSignature(request);

  const runNow = useCallback(async (): Promise<void> => {
    const next = toQueryRequest(state, loaded?.id ?? null);
    if (next === null) return;
    const outcome = await actions.runQuery(next);
    setRun(outcome);
    // Signed after the answer lands rather than before it is asked for: a run that
    // failed still describes the request that failed, and marking it stale would
    // offer a re-run of the same refusal as though something had changed.
    setSignature(requestSignature(next));
  }, [actions, loaded, state]);

  /** A saved analysis arrives as two halves — a query for the shelves and a record
   *  for the title — and the last result is dropped rather than kept beside a query
   *  it was not the answer to. */
  const load = useCallback((analysis: BiAnalysis, report: string | null): void => {
    dispatch({ type: 'LOAD', state: builderStateOf(analysis) });
    setLoaded(analysis);
    setReportId(report);
    setRun(null);
    setSignature('');
  }, []);

  const reset = useCallback((datasetId: string | null): void => {
    dispatch({ type: 'LOAD', state: initialBuilderState(datasetId) });
    setLoaded(null);
    setReportId(null);
    setRun(null);
    setSignature('');
  }, []);

  return {
    state, dispatch, request, loaded, reportId, run,
    result: run !== null && run.ok ? run.value : null,
    stale: signature !== '' && signature !== current,
    runNow, load, reset,
  };
}

/* ------------------------------------------------------------------ *
 *  Dialogs                                                             *
 * ------------------------------------------------------------------ */

/**
 * Eleven members: seven definition editors, two governance verbs, and two panes
 * that show an answer rather than ask for one.
 *
 * Each editor carries `id: null` for a create and an id for an edit, which is the
 * whole difference between the two — the same dialog, the same form, and a commit
 * that picks `create` or `update` from that one field.
 *
 * Some carry more than a form. A dataset and a metric each own a `readonly
 * BiFilter[]` that `to*Draft` takes as an argument, because a list of predicates is
 * not something a text input can hold; a dimension, a metric and a tile carry the id
 * of the thing they belong to, because the payloads they were read from nest them
 * under a parent that repeats no id.
 */
export type BiDialog =
  | { kind: 'dataset'; id: string | null; form: DatasetForm; filters: readonly BiFilter[] }
  | { kind: 'dimension'; id: string | null; datasetId: string; form: DimensionForm }
  | {
      kind: 'metric'; id: string | null; datasetId: string;
      form: MetricForm; filters: readonly BiFilter[];
    }
  | {
      kind: 'analysis'; id: string | null; reportId: string | null; form: AnalysisForm;
      /** The query this save will write, captured when the dialog opened.
       *
       *  Not read from the builder at commit time, which is where it used to come
       *  from and where it was wrong: renaming an analysis from a report list while
       *  the shelves hold some other query would have written *that* query over the
       *  one being renamed, silently and with no way back. A rename carries the
       *  query it was read from; a save from the shelves carries the shelves'. */
      request: BiQueryRequest | null;
      chartType: BiChartType;
    }
  | { kind: 'report'; id: string | null; form: ReportForm }
  | { kind: 'dashboard'; id: string | null; form: DashboardForm }
  | {
      kind: 'tile'; id: string | null; dashboardId: string;
      analysisId: string; form: TileForm;
    }
  | {
      kind: 'status'; target: BiGovernedKind; id: string;
      title: string; status: BiStatus; text: string;
    }
  | { kind: 'delete'; target: BiCrudKind; id: string; title: string }
  | {
      kind: 'drill'; dimensionKey: string; label: string;
      result: BiDrillResult | null; error: string | null;
    }
  | { kind: 'sql'; title: string; sql: string };

export interface BiDialogs {
  readonly dialog: BiDialog | null;
  readonly open: (dialog: BiDialog) => void;
  readonly close: () => void;
  readonly setDataset: (patch: Partial<DatasetForm>) => void;
  readonly setDimension: (patch: Partial<DimensionForm>) => void;
  readonly setMetric: (patch: Partial<MetricForm>) => void;
  readonly setAnalysis: (patch: Partial<AnalysisForm>) => void;
  readonly setReport: (patch: Partial<ReportForm>) => void;
  readonly setDashboard: (patch: Partial<DashboardForm>) => void;
  readonly setTile: (patch: Partial<TileForm>) => void;
  readonly setFilters: (filters: readonly BiFilter[]) => void;
  readonly setNote: (text: string) => void;
  readonly setStatus: (status: BiStatus) => void;
  readonly setDrillAnswer: (dimensionKey: string, run: BiRun<BiDrillResult>) => void;
}

/**
 * One dialog at a time, and every setter proves which one before it writes.
 *
 * The check happens *inside* the updater rather than outside it, the same rule
 * `../dms/shell.ts` follows: a keystroke that is still in flight when a commit
 * closes the dialog would otherwise reopen it with a member the chrome has already
 * stopped drawing.
 */
export function useBiDialogs(): BiDialogs {
  const [dialog, setDialog] = useState<BiDialog | null>(null);

  const open = useCallback((next: BiDialog): void => setDialog(next), []);
  const close = useCallback((): void => setDialog(null), []);

  const setDataset = useCallback((patch: Partial<DatasetForm>): void => {
    setDialog((now) =>
      now?.kind === 'dataset' ? { ...now, form: { ...now.form, ...patch } } : now);
  }, []);

  const setDimension = useCallback((patch: Partial<DimensionForm>): void => {
    setDialog((now) =>
      now?.kind === 'dimension' ? { ...now, form: { ...now.form, ...patch } } : now);
  }, []);

  const setMetric = useCallback((patch: Partial<MetricForm>): void => {
    setDialog((now) =>
      now?.kind === 'metric' ? { ...now, form: { ...now.form, ...patch } } : now);
  }, []);

  const setAnalysis = useCallback((patch: Partial<AnalysisForm>): void => {
    setDialog((now) =>
      now?.kind === 'analysis' ? { ...now, form: { ...now.form, ...patch } } : now);
  }, []);

  const setReport = useCallback((patch: Partial<ReportForm>): void => {
    setDialog((now) =>
      now?.kind === 'report' ? { ...now, form: { ...now.form, ...patch } } : now);
  }, []);

  const setDashboard = useCallback((patch: Partial<DashboardForm>): void => {
    setDialog((now) =>
      now?.kind === 'dashboard' ? { ...now, form: { ...now.form, ...patch } } : now);
  }, []);

  const setTile = useCallback((patch: Partial<TileForm>): void => {
    setDialog((now) =>
      now?.kind === 'tile' ? { ...now, form: { ...now.form, ...patch } } : now);
  }, []);

  /** The two members that own a filter list, edited by the same predicate editor. */
  const setFilters = useCallback((filters: readonly BiFilter[]): void => {
    setDialog((now) =>
      now?.kind === 'dataset' || now?.kind === 'metric' ? { ...now, filters } : now);
  }, []);

  const setNote = useCallback((text: string): void => {
    setDialog((now) => (now?.kind === 'status' ? { ...now, text } : now));
  }, []);

  const setStatus = useCallback((status: BiStatus): void => {
    setDialog((now) => (now?.kind === 'status' ? { ...now, status } : now));
  }, []);

  /** The drill answer arrives after the dialog opened, so it is matched to the
   *  dimension it was asked about: a second click while the first was in flight
   *  must not print the first answer under the second question. */
  const setDrillAnswer = useCallback(
    (dimensionKey: string, run: BiRun<BiDrillResult>): void => {
      setDialog((now) =>
        now?.kind === 'drill' && now.dimensionKey === dimensionKey
          ? {
              ...now,
              result: run.ok ? run.value : null,
              error: run.ok ? null : run.error.message,
            }
          : now);
    }, []);

  return {
    dialog, open, close, setDataset, setDimension, setMetric, setAnalysis, setReport,
    setDashboard, setTile, setFilters, setNote, setStatus, setDrillAnswer,
  };
}

/* ------------------------------------------------------------------ *
 *  Commits                                                             *
 * ------------------------------------------------------------------ */

export interface BiCommits {
  readonly commitDataset: () => Promise<void>;
  readonly commitDimension: () => Promise<void>;
  readonly commitMetric: () => Promise<void>;
  readonly commitAnalysis: () => Promise<void>;
  readonly commitReport: () => Promise<void>;
  readonly commitDashboard: () => Promise<void>;
  readonly commitTile: () => Promise<void>;
  readonly commitStatus: () => Promise<void>;
  readonly commitDelete: () => Promise<void>;
}

/** A note typed into the governance dialog, trimmed, with blank meaning none. The
 *  same rule and the same reading as `./forms`'s `said`. */
const note = (text: string): string | undefined => {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Create or update, and close only if the server agreed.
 *
 * A dialog that closed on a refused save would throw away what the reader typed and
 * leave them looking at the unchanged row wondering which of the two they were
 * seeing. `create` answers with an id and `update` with a boolean, so the two are
 * normalised to "did it work" here rather than at seven call sites.
 */
async function saveVia<D>(
  crud: BiCrud<D>, id: string | null, draft: D, close: () => void,
): Promise<void> {
  const ok = id === null ? (await crud.create(draft)) !== null : await crud.update(id, draft);
  if (ok) close();
}

/**
 * Nine commits, each of which re-proves which dialog is open before it reads it.
 *
 * The re-check is not defensive noise: a commit is an `async` function that was
 * handed to a button several renders ago, and TypeScript will not narrow
 * `dialog.form` for it without one. The early return also makes each of these safe
 * to call from a keyboard handler that does not know what is on screen.
 */
export function useBiCommits(
  dialog: BiDialog | null,
  close: () => void,
  actions: BiActions,
): BiCommits {
  const commitDataset = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'dataset') return;
    const draft: BiDatasetDraft = toDatasetDraft(dialog.form, dialog.filters);
    await saveVia(actions.dataset, dialog.id, draft, close);
  }, [actions, close, dialog]);

  const commitDimension = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'dimension') return;
    const draft: BiDimensionDraft = toDimensionDraft(dialog.form, dialog.datasetId);
    await saveVia(actions.dimension, dialog.id, draft, close);
  }, [actions, close, dialog]);

  const commitMetric = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'metric') return;
    const draft: BiMetricDraft = toMetricDraft(dialog.form, dialog.datasetId, dialog.filters);
    await saveVia(actions.metric, dialog.id, draft, close);
  }, [actions, close, dialog]);

  /** The one commit that needs something the dialog did not ask for. An analysis is
   *  a name over a query, and the query was captured when the dialog opened — from
   *  the shelves for a save, from the record for a rename. A member with no query
   *  stays open rather than writing a titled analysis of nothing. */
  const commitAnalysis = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'analysis' || dialog.request === null) return;
    const draft: BiAnalysisDraft = toAnalysisDraft(
      dialog.form, dialog.request, dialog.chartType, dialog.reportId,
    );
    await saveVia(actions.analysis, dialog.id, draft, close);
  }, [actions, close, dialog]);

  const commitReport = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'report') return;
    const draft: BiReportDraft = toReportDraft(dialog.form);
    await saveVia(actions.report, dialog.id, draft, close);
  }, [actions, close, dialog]);

  const commitDashboard = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'dashboard') return;
    const draft: BiDashboardDraft = toDashboardDraft(dialog.form);
    await saveVia(actions.dashboard, dialog.id, draft, close);
  }, [actions, close, dialog]);

  const commitTile = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'tile') return;
    const draft: BiTileDraft = toTileDraft(dialog.form, dialog.dashboardId, dialog.analysisId);
    await saveVia(actions.tile, dialog.id, draft, close);
  }, [actions, close, dialog]);

  const commitStatus = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'status') return;
    const ok = await actions.setStatus(dialog.target, dialog.id, dialog.status, note(dialog.text));
    if (ok) close();
  }, [actions, close, dialog]);

  const commitDelete = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'delete') return;
    const ok = await REMOVER[dialog.target](actions)(dialog.id);
    if (ok) close();
  }, [actions, close, dialog]);

  return {
    commitDataset, commitDimension, commitMetric, commitAnalysis, commitReport,
    commitDashboard, commitTile, commitStatus, commitDelete,
  };
}

/* ------------------------------------------------------------------ *
 *  Verbs on things inside a detail pane                                *
 * ------------------------------------------------------------------ */

interface VerbDeps {
  readonly ui: BiUi;
  readonly model: BiModel;
  readonly builder: BiBuilder;
  readonly dialogs: BiDialogs;
  readonly actions: BiActions;
}

export interface BiDetailVerbs {
  readonly editDimension: (dimension: BiDimension) => void;
  readonly editMetric: (metric: BiMetric) => void;
  readonly editTile: (tile: BiTile) => void;
  readonly editAnalysis: (analysis: BiAnalysis, reportId: string | null) => void;
  readonly openAnalysis: (analysis: BiAnalysis, reportId: string | null) => void;
  readonly removeDefinition: (target: BiCrudKind, id: string, title: string) => void;
  /** Regroup the chart one level down. Nothing happens on a metric cell, a period
   *  cell or a column with nowhere to go — {@link drillStepFor} says so with
   *  `null`. */
  readonly drillDown: (column: BiColumn, value: BiScalar, label: string) => void;
  /** Ask which rows a mark stands for. Opens the answer, then fetches it. */
  readonly drillThrough: (column: BiColumn, value: BiScalar, label: string) => void;
  readonly openDrillTarget: (result: BiDrillResult) => void;
  readonly copyText: (text: string | null) => void;
  readonly showSql: (title: string, sql: string | null) => void;
}

/**
 * The verbs whose subject is smaller than a list row.
 *
 * A dimension, a metric and a tile are all edited from inside a detail pane, and
 * all three take their parent's id from the pane rather than from themselves. A
 * chart cell is smaller still: it is a column and a value, and two entirely
 * different things can be done with it — regroup the chart, or ask which rows the
 * mark stands for.
 */
export function useBiDetailVerbs(deps: VerbDeps): BiDetailVerbs {
  const { ui, model, builder, dialogs, actions } = deps;
  const { open } = dialogs;
  const detail = model.dataset.value;
  const board = model.dashboard.value;

  const editDimension = useCallback((dimension: BiDimension): void => {
    if (detail === null) return;
    open({
      kind: 'dimension', id: dimension.id, datasetId: detail.dataset.id,
      form: dimensionFormOf(dimension),
    });
  }, [detail, open]);

  const editMetric = useCallback((metric: BiMetric): void => {
    if (detail === null) return;
    open({
      kind: 'metric', id: metric.id, datasetId: detail.dataset.id,
      form: metricFormOf(metric), filters: metric.filters,
    });
  }, [detail, open]);

  /** A tile names its analysis through the definition nested inside it; there is no
   *  flat `analysisId` on the row, and inventing one would be a second answer to a
   *  question `get_bi_dashboard` already answered. */
  const editTile = useCallback((tile: BiTile): void => {
    if (board === null) return;
    open({
      kind: 'tile', id: tile.id, dashboardId: board.dashboard.id,
      analysisId: tile.analysis.id, form: tileFormOf(tile),
    });
  }, [board, open]);

  /** Renaming, and nothing more. The query sent back is the one the record was read
   *  with — `builderStateOf` then `toQueryRequest` is the same round trip `openAnalysis`
   *  puts on the shelves, so a rename rewrites the title and leaves the numbers alone.
   *  The one value it does not return unchanged is `rowLimit`, which `builderStateOf`
   *  clamps to the range the builder can produce; a row written before this app existed
   *  is repaired rather than re-saved as it stood. */
  const editAnalysis = useCallback((analysis: BiAnalysis, reportId: string | null): void => {
    open({
      kind: 'analysis', id: analysis.id, reportId, form: analysisFormOf(analysis),
      request: toQueryRequest(builderStateOf(analysis), analysis.id),
      chartType: analysis.chartType,
    });
  }, [open]);

  /** Open it on the shelves rather than in a dialog: a saved analysis is a query,
   *  and the place to look at a query is the builder. */
  const openAnalysis = useCallback((analysis: BiAnalysis, reportId: string | null): void => {
    builder.load(analysis, reportId);
    ui.changeView('analysis');
  }, [builder, ui]);

  const removeDefinition = useCallback(
    (target: BiCrudKind, id: string, title: string): void => {
      open({ kind: 'delete', target, id, title });
    }, [open]);

  const drillDown = useCallback((column: BiColumn, value: BiScalar, label: string): void => {
    const keys = (detail?.dimensions ?? []).map((dimension) => dimension.key);
    const step = drillStepFor(builder.state, column, value, label, keys);
    if (step === null) return;
    builder.dispatch({ type: 'DRILL_DOWN', step });
  }, [builder, detail]);

  /** Opened before it is asked, so the reader sees the question they clicked while
   *  the answer is still travelling. `setDrillAnswer` matches it back by key. */
  const drillThrough = useCallback((column: BiColumn, value: BiScalar, label: string): void => {
    const datasetId = builder.state.datasetId;
    if (datasetId === null || column.kind !== 'DIMENSION') return;
    open({ kind: 'drill', dimensionKey: column.key, label, result: null, error: null });
    void actions
      .drillThrough({ datasetId, dimensionKey: column.key, value, filters: builder.state.filters })
      .then((run) => dialogs.setDrillAnswer(column.key, run));
  }, [actions, builder, dialogs, open]);

  /** One id, because a launch argument names one row. The whole set is what the
   *  dialog's copy button is for. */
  const openDrillTarget = useCallback((result: BiDrillResult): void => {
    const jump = result.kind === null ? undefined : DRILL_JUMP[result.kind];
    const first = result.entityIds[0];
    if (jump === undefined || first === undefined) return;
    actions.openApp(jump.app, { [jump.key]: first });
  }, [actions]);

  const copyText = useCallback((text: string | null): void => {
    actions.copy(text ?? '');
  }, [actions]);

  const showSql = useCallback((title: string, sql: string | null): void => {
    if (sql === null || sql === '') return;
    open({ kind: 'sql', title, sql });
  }, [open]);

  return {
    editDimension, editMetric, editTile, editAnalysis, openAnalysis, removeDefinition,
    drillDown, drillThrough, openDrillTarget, copyText, showSql,
  };
}

/* ------------------------------------------------------------------ *
 *  The command path                                                    *
 * ------------------------------------------------------------------ */

interface CommandDeps extends VerbDeps {
  readonly verbs: BiDetailVerbs;
  readonly visible: BiVisible;
  readonly selectedRow: BiListRow | null;
  /** Resolved once at mount. It names the exported file and does nothing else. */
  readonly today: string;
  readonly tr: Translate;
  /** Read side only. The shell hands the same ref out for the search box. */
  readonly searchRef: { readonly current: HTMLInputElement | null };
}

export interface BiCommands {
  /** Anything the manifest, the palette or the nav rail can send. */
  readonly command: (id: string) => void;
  /** The same vocabulary plus the verbs that need a row, for the context menu. */
  readonly perform: (id: string, row: BiListRow) => void;
  readonly keyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** What the CSV and the clipboard are given: exactly the rows on screen, plus the
 *  result the builder is showing. */
function scopeOf(
  model: BiModel, visible: BiVisible, result: BiQueryResult | null,
): BiExportScope {
  return {
    overview: model.overview.value,
    datasets: visible.datasets,
    result,
    dashboards: visible.dashboards,
    reports: visible.reports,
    queries: visible.queries,
    events: visible.events,
  };
}

/**
 * The verbs that act on the window rather than on anything selected in it.
 *
 * `run` is view-agnostic on purpose: Ctrl+Enter from the catalog runs whatever is on
 * the shelves, which is what a reader who has just dragged a metric there means.
 * `analysis:save` opens the dialog prefilled from the loaded analysis when there is
 * one, so Ctrl+S over a report's analysis renames it rather than forking it.
 */
function useGlobalCommands(deps: CommandDeps): (id: string) => boolean {
  const { ui, model, builder, dialogs, actions, visible, today, tr, searchRef } = deps;
  const { open } = dialogs;
  const view = ui.view;
  const { refreshAll } = model;

  return useCallback((id: string): boolean => {
    if (id === 'refresh') { refreshAll(); return true; }
    if (id === 'search') { searchRef.current?.focus(); return true; }
    if (id === 'run') { void builder.runNow(); return true; }
    if (id === 'source:sync') { void actions.syncSources(); return true; }
    if (id === 'export' || id === 'copy') {
      const scope = scopeOf(model, visible, builder.result);
      if (id === 'copy') actions.copy(biClipboard(view, scope, tr));
      else actions.exportCsv(view, biCsv(view, scope, tr), today);
      return true;
    }
    if (id === 'analysis:save') {
      const loaded = builder.loaded;
      // Both arms carry the shelves' query, because both are saving the shelves:
      // one over a new row, one over the row the shelves were loaded from.
      open(loaded === null
        ? {
            kind: 'analysis', id: null, reportId: null, form: EMPTY_ANALYSIS,
            request: builder.request, chartType: builder.state.chartType,
          }
        : {
            kind: 'analysis', id: loaded.id, reportId: builder.reportId,
            form: analysisFormOf(loaded),
            request: builder.request, chartType: builder.state.chartType,
          });
      return true;
    }
    return false;
  }, [actions, builder, model, open, refreshAll, searchRef, today, tr, view, visible]);
}

/**
 * Seven creates, four of which need a parent.
 *
 * A dimension and a metric are created into the dataset whose detail is open; a
 * tile is placed on the dashboard whose detail is open, over the analysis already
 * on the shelves. Each does nothing when its parent is missing, which is the
 * chrome's cue to disable the button rather than open a dialog that cannot save.
 */
function useCreateCommands(deps: CommandDeps): (id: string) => boolean {
  const { ui, model, builder, dialogs } = deps;
  const { open } = dialogs;
  const { changeView } = ui;
  const detail = model.dataset.value;
  const board = model.dashboard.value;

  return useCallback((id: string): boolean => {
    if (id === 'dataset:new') {
      open({ kind: 'dataset', id: null, form: EMPTY_DATASET, filters: [] });
      return true;
    }
    if (id === 'dashboard:new') {
      open({ kind: 'dashboard', id: null, form: EMPTY_DASHBOARD });
      return true;
    }
    if (id === 'report:new') {
      open({ kind: 'report', id: null, form: EMPTY_REPORT });
      return true;
    }
    if (id === 'analysis:new') {
      builder.reset(detail?.dataset.id ?? null);
      changeView('analysis');
      return true;
    }
    if (id === 'dimension:new' && detail !== null) {
      open({ kind: 'dimension', id: null, datasetId: detail.dataset.id, form: EMPTY_DIMENSION });
      return true;
    }
    if (id === 'metric:new' && detail !== null) {
      open({
        kind: 'metric', id: null, datasetId: detail.dataset.id,
        form: EMPTY_METRIC, filters: [],
      });
      return true;
    }
    if (id === 'tile:new' && board !== null && builder.loaded !== null) {
      open({
        kind: 'tile', id: null, dashboardId: board.dashboard.id,
        analysisId: builder.loaded.id, form: EMPTY_TILE,
      });
      return true;
    }
    return false;
  }, [board, builder, changeView, detail, open]);
}

/**
 * Open the right editor for a row, or none.
 *
 * A dashboard and a report are returned whole by their list reads, so both open
 * straight from the row. A dataset is not: `get_bi_catalog` sends a summary with
 * counts and no `source_id`, and the record an editor needs comes from
 * `get_bi_dataset_detail`. So a dataset opens only while it is the one the detail
 * pane has loaded — which, since selecting a row is what parameterises that read, is
 * true a moment after the click and false during it. It still answers `true`, so the
 * command does not fall through to something else while the detail is in flight.
 */
function editRow(
  row: BiListRow, detail: BiDatasetDetail | null, open: BiDialogs['open'],
): boolean {
  if (isDashboard(row)) {
    open({ kind: 'dashboard', id: row.id, form: dashboardFormOf(row) });
    return true;
  }
  if (isReport(row)) {
    open({ kind: 'report', id: row.id, form: reportFormOf(row) });
    return true;
  }
  if (!isDataset(row)) return false;
  if (detail !== null && detail.dataset.id === row.id) {
    open({
      kind: 'dataset',
      id: row.id,
      form: datasetFormOf(detail.dataset, detail.source?.id ?? ''),
      filters: detail.dataset.rowFilters,
    });
  }
  return true;
}

/** Which table a delete would reach for. Two of the five list shapes are history
 *  and have no table a delete may touch — a query log line and a ledger line are
 *  the record of what happened, and editing the record is not a verb. */
function deleteKindOf(row: BiListRow): BiCrudKind | null {
  if (isDataset(row)) return 'dataset';
  if (isDashboard(row)) return 'dashboard';
  if (isReport(row)) return 'report';
  return null;
}

/** What a context menu can do to the row under the cursor. Each verb that does not
 *  apply to this shape is *consumed* rather than passed on, because a "Change
 *  status" that quietly ran a global command instead would be worse than one that
 *  did nothing. */
function useRowCommands(deps: CommandDeps): (id: string, row: BiListRow) => boolean {
  const { ui, model, dialogs, verbs } = deps;
  const { open } = dialogs;
  const { showLineage } = ui;
  const { showSql } = verbs;
  const detail = model.dataset.value;

  return useCallback((id: string, row: BiListRow): boolean => {
    if (id === 'edit') return editRow(row, detail, open);
    if (id === 'delete') {
      const kind = deleteKindOf(row);
      if (kind !== null) open({ kind: 'delete', target: kind, id: row.id, title: labelOf(row) });
      return true;
    }
    if (id === 'status') {
      const target = governedKindOf(row);
      const status = statusOf(row);
      if (target !== null && status !== null) {
        open({ kind: 'status', target, id: row.id, title: labelOf(row), status, text: '' });
      }
      return true;
    }
    if (id === 'sql') {
      if (isQueryEntry(row)) showSql(labelOf(row), row.compiledSql);
      return true;
    }
    if (id === 'lineage') {
      if (isDataset(row)) showLineage({ kind: 'DATASET', id: row.id });
      return true;
    }
    return false;
  }, [detail, open, showLineage, showSql]);
}

/**
 * Four tiers, tried in order.
 *
 * The split is the one `../dms/shell.ts` draws: a jump changes the view and nothing
 * else, a global verb acts on the window, a create needs to know where it is being
 * created, and a row verb needs a row. Keeping them apart means the keyboard, the
 * palette, the rail and the context menu all arrive at the same four functions
 * instead of at four copies of one `switch`.
 */
export function useBiCommandPath(deps: CommandDeps): BiCommands {
  const { ui, selectedRow } = deps;
  const { changeView, closeMenu } = ui;

  const runView = useCallback((id: string): boolean => {
    const next = VIEW_COMMAND[id];
    if (next === undefined) return false;
    changeView(next);
    return true;
  }, [changeView]);

  const runGlobal = useGlobalCommands(deps);
  const runCreate = useCreateCommands(deps);
  const runRow = useRowCommands(deps);

  const command = useCallback((id: string): void => {
    if (runView(id) || runGlobal(id) || runCreate(id)) return;
    if (selectedRow !== null) runRow(id, selectedRow);
  }, [runCreate, runGlobal, runRow, runView, selectedRow]);

  const perform = useCallback((id: string, row: BiListRow): void => {
    closeMenu();
    if (runRow(id, row)) return;
    command(id);
  }, [closeMenu, command, runRow]);

  const keyDown = useCallback((event: KeyboardEvent<HTMLElement>): void => {
    const id = hotkey(event);
    if (id === null) return;
    event.preventDefault();
    command(id);
  }, [command]);

  return { command, perform, keyDown };
}

/* ------------------------------------------------------------------ *
 *  Assembly                                                            *
 * ------------------------------------------------------------------ */

export interface BiShell extends BiUi, BiCommits, BiCommands, BiDetailVerbs {
  readonly model: BiModel;
  readonly actions: BiActions;
  readonly busy: BiBusy;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly visible: BiVisible;
  readonly selectedRow: BiListRow | null;
  readonly shown: number;
  readonly total: number;
  /** The builder, its answer, and what the compiler would refuse. */
  readonly builder: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
  readonly loadedAnalysis: BiAnalysis | null;
  readonly result: BiQueryResult | null;
  readonly queryError: string | null;
  readonly issues: readonly BuilderIssue[];
  readonly blocked: boolean;
  readonly stale: boolean;
  /** Whether the result on screen stops short of the rows that matched. Published
   *  rather than toasted because the reader has to know *before* they export. */
  readonly truncated: boolean;
  readonly dialog: BiDialog | null;
  readonly closeDialog: () => void;
  readonly setDataset: (patch: Partial<DatasetForm>) => void;
  readonly setDimension: (patch: Partial<DimensionForm>) => void;
  readonly setMetric: (patch: Partial<MetricForm>) => void;
  readonly setAnalysisForm: (patch: Partial<AnalysisForm>) => void;
  readonly setReport: (patch: Partial<ReportForm>) => void;
  readonly setDashboard: (patch: Partial<DashboardForm>) => void;
  readonly setTile: (patch: Partial<TileForm>) => void;
  readonly setFilters: (filters: readonly BiFilter[]) => void;
  readonly setNote: (text: string) => void;
  readonly setStatus: (status: BiStatus) => void;
}

/**
 * The window, assembled.
 *
 * The order is the dependency order and nothing else. `actions` first because no
 * other piece can do anything without the syscalls. `ui` next because it answers
 * what the reads should be parameterised by. `builder` after `ui` because the
 * analysis view's dataset is the builder's, and before `dialogs` because a save
 * dialog is opened prefilled from what is on the shelves. `dialogs` before
 * `commits` because a commit reads the open member. `model` after all of them,
 * because the detail read follows whichever of the two panes the reader is looking
 * through. Then the row, resolved against the filtered lists so the verbs are handed
 * a row rather than an id — and finally the command path, the only seam that needs
 * every other.
 *
 * `BiModelParams` is rebuilt as a fresh literal every render and that is deliberate:
 * `useBiModel` keys its effects on the *content* of the query-shaping options rather
 * than on their identity, so memoising here would buy nothing and hide that fact.
 */
export function useBiShell(): BiShell {
  const { tr } = useLocale();
  // Resolved once at mount. It names the exported file and nothing else; a window
  // left open across midnight is not worth a clock.
  const today = useMemo(isoToday, []);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useBiActions();
  const ui = useBiUi();
  const builder = useBiBuilder(actions);
  const dialogs = useBiDialogs();
  const commits = useBiCommits(dialogs.dialog, dialogs.close, actions);

  // The catalog selects a dataset to read about; the builder chooses one to query.
  // Both want the same detail, and which of them is asking is which view is open.
  const model = useBiModel({
    datasetId: ui.view === 'analysis' ? builder.state.datasetId : ui.selection.catalog,
    dashboardId: ui.selection.dashboards,
    lineage: ui.lineage,
    drill: ui.drill,
    outcome: ui.outcome,
    events: ui.events,
  });

  const visible = biVisible(model, ui.search);
  const selectedRow = findRow(visible, ui.view, ui.selectedId);
  const detail = model.dataset.value;
  const issues = readiness(builder.state, detail?.metrics ?? [], detail?.dimensions ?? []);

  const verbs = useBiDetailVerbs({ ui, model, builder, dialogs, actions });
  const commands = useBiCommandPath({
    ui, model, builder, dialogs, actions, verbs, visible, selectedRow, today, tr, searchRef,
  });
  const counts = tally(model, visible, ui.view, builder.result);

  return {
    ...ui, ...commits, ...commands, ...verbs,
    model, actions, busy: actions.busy, searchRef, visible, selectedRow,
    shown: counts.shown, total: counts.total,
    builder: builder.state,
    dispatch: builder.dispatch,
    loadedAnalysis: builder.loaded,
    result: builder.result,
    queryError: builder.run !== null && !builder.run.ok ? builder.run.error.message : null,
    issues,
    blocked: issues.some(blocksRun),
    stale: builder.stale,
    truncated: builder.result?.truncated ?? false,
    dialog: dialogs.dialog,
    closeDialog: dialogs.close,
    setDataset: dialogs.setDataset,
    setDimension: dialogs.setDimension,
    setMetric: dialogs.setMetric,
    setAnalysisForm: dialogs.setAnalysis,
    setReport: dialogs.setReport,
    setDashboard: dialogs.setDashboard,
    setTile: dialogs.setTile,
    setFilters: dialogs.setFilters,
    setNote: dialogs.setNote,
    setStatus: dialogs.setStatus,
  };
}
