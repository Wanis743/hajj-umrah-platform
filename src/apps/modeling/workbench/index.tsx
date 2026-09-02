/**
 * The workbench — one model, opened.
 *
 * Everything around this file is a piece. `document.ts` turns rows into a spec, the engine compiles
 * and runs it, `commands.ts` names the fourteen verbs, `panels.tsx` draws the rail and the
 * certificate, `tables.tsx` the four registers and `editors.tsx` the four dialogs. None of them
 * knows what a *model* is. This is where a key becomes a document, a document becomes a compiled
 * model, a compiled model becomes a run, and a run becomes something a person can argue with.
 *
 * Three decisions here are worth more than the code expressing them.
 *
 * **The certificate is computed eagerly, on every change** — not lazily behind the button, which
 * was the tempting shape. `CertificateAside` renders a null `live` as "The model does not compile,
 * so there is nothing to measure", so a certificate that merely had not been asked for yet would
 * make the panel state a falsehood about a model that compiles perfectly well. The engine licenses
 * the eager reading in `certify`'s own words: the cost is `scenarios + 2·ranged + 1` runs of a
 * model compiled once, "which is why the certificate can be recomputed on a change rather than
 * stored and trusted". So it is recomputed, and the button only *stores* what is already on
 * screen. Nobody can press Certify and be handed a grade the panel did not show them first.
 *
 * **Compiling and running fail separately.** `compile` below returns a version whenever the
 * structure parsed, even when the scenario will not resolve, because `versionOf` takes the
 * *compiled* model — a hash of a structure is settled before any assumption has a value. That is
 * what lets the publish gate say "does not compile, so there is no hash" and "this scenario will
 * not resolve" as two different refusals, and it is why publishing freezes a structure rather than
 * a set of numbers.
 *
 * **The scenario and the target are preferences, not state.** Each is held as the id somebody
 * picked, and each falls back to a derivation — the first scenario, the last row's final period —
 * whenever the pick no longer names anything. A model whose active scenario was just deleted
 * therefore renders the base case rather than an empty grid, and the target is never null while
 * rows exist. The alternative is an effect that writes state on every document change, which is a
 * render loop waiting for a slow network.
 */
import { type MutableRefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { FunctionSquare, Plus } from 'lucide-react';
import {
  AppFrame,
  Button,
  EmptyState,
  type Localized,
  Pivot,
  type PivotTab,
  useCapability,
  useDataset,
  useLocale,
} from '@/platform/sdk';
import { useModelingActions } from '../actions';
import {
  type Certificate,
  type CompiledModel,
  type ModelFailure,
  type ModelRun,
  type ModelVersion,
  type Target,
  certify as measure,
  compileModel,
  reachOf,
  runCompiled,
  versionOf,
} from '../engine';
import type { ModelingView } from '../model';
import type { WorkbenchSink } from '../shell';
import type { ModelCommands } from './commands';
import { useModelCommands } from './commands';
import {
  type DocAssumption,
  type DocRow,
  type DocScenario,
  type ModelDocument,
  type ModelHeader,
  readCertificates,
  readDocument,
  readModels,
} from './document';
import { AssumptionDialog, ModelDialog, RowDialog, ScenarioDialog } from './editors';
import { publishGate } from './gate';
import {
  CertificateAside,
  FailureReport,
  ModelRail,
  type WorkbenchActions,
  WorkbenchStatus,
  WorkbenchToolbar,
} from './panels';
import { AssumptionTable, ResultsGrid, RowTable, ScenarioTable, TargetPicker } from './tables';

/* ------------------------------------------------------------------ *
 * What the window hands in
 * ------------------------------------------------------------------ */

export interface WorkbenchProps {
  /** The model this window has open, by key. Null until the rail or the effect below picks one. */
  readonly modelKey: string | null;
  readonly onPickModel: (key: string) => void;
  /** Passed to the toolbar, which draws the view switcher for the whole window, not just here. */
  readonly view: ModelingView;
  readonly onCommand: (id: string) => void;
  /**
   * Where the shell looks for a workbench handler before falling back to its own verbs.
   *
   * A ref because the handler closes over this component's state and is therefore a new function
   * every render — `shell.ts` records the same reasoning from the other side.
   */
  readonly sink: MutableRefObject<WorkbenchSink | null>;
}

/**
 * Which dialog is open, and on what.
 *
 * A tagged union rather than four booleans beside four subjects: "the row dialog is open on
 * nothing" is a state that has to exist, "the row dialog is closed but holds a row" is a state
 * that must not, and eight independent flags can spell twelve more that mean nothing at all.
 */
type Editing =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'MODEL'; readonly subject: ModelHeader | null }
  | { readonly kind: 'ASSUMPTION'; readonly subject: DocAssumption | null }
  | { readonly kind: 'ROW'; readonly subject: DocRow | null }
  | { readonly kind: 'SCENARIO'; readonly subject: DocScenario | null };

const CLOSED: Editing = { kind: 'NONE' };

/* ------------------------------------------------------------------ *
 * The four registers
 * ------------------------------------------------------------------ */

/** Results is the answer; the other three are what produced it. */
type Sheet = 'results' | 'rows' | 'assumptions' | 'scenarios';

const SHEET_ORDER: readonly Sheet[] = ['results', 'rows', 'assumptions', 'scenarios'];

const SHEET_LABEL: Readonly<Record<Sheet, Localized>> = {
  results: { ar: 'النتائج', fr: 'Résultats', en: 'Results' },
  rows: { ar: 'الأسطر', fr: 'Lignes', en: 'Rows' },
  assumptions: { ar: 'الافتراضات', fr: 'Hypothèses', en: 'Assumptions' },
  scenarios: { ar: 'السيناريوهات', fr: 'Scénarios', en: 'Scenarios' },
};

/** What the add button says. Results has nothing to add to it, hence the null. */
const ADD_LABEL: Readonly<Record<Sheet, Localized | null>> = {
  results: null,
  rows: { ar: 'سطر جديد', fr: 'Nouvelle ligne', en: 'New row' },
  assumptions: { ar: 'افتراض جديد', fr: 'Nouvelle hypothèse', en: 'New assumption' },
  scenarios: { ar: 'سيناريو جديد', fr: 'Nouveau scénario', en: 'New scenario' },
};

/* ------------------------------------------------------------------ *
 * Compiling
 * ------------------------------------------------------------------ */

/**
 * One document, put through the engine.
 *
 * Four fields rather than a result union because three of the four combinations are real and a
 * screen has to draw each of them: nothing open (all null), structure broken (a failure and no
 * version), structure sound but this scenario unresolvable (a version *and* a failure, no run),
 * and everything through (no failure). A `{ ok }` union would have collapsed the third into the
 * second and lost the hash that makes publishing possible.
 */
interface Compilation {
  readonly compiled: CompiledModel | null;
  readonly version: ModelVersion | null;
  readonly run: ModelRun | null;
  readonly failure: ModelFailure | null;
}

const UNCOMPILED: Compilation = { compiled: null, version: null, run: null, failure: null };
/**
 * Compile, then run, and keep whatever each stage produced.
 *
 * Pure and at module scope so the memo that calls it has one dependency worth naming, and so the
 * two stages cannot be quietly reordered by a later edit. `versionOf` is called *before* the run,
 * not after: the hash describes a structure, so it exists the moment the structure is settled,
 * whether or not the scenario somebody happens to be looking at resolves against it.
 */
function compile(document: ModelDocument | null, scenarioId: string | null): Compilation {
  if (document === null || scenarioId === null) return UNCOMPILED;

  const built = compileModel(document.spec);
  if (!built.ok) return { compiled: null, version: null, run: null, failure: built.failure };

  const version = versionOf(built.model);
  const result = runCompiled(built.model, scenarioId);
  return result.ok
    ? { compiled: built.model, version, run: result.run, failure: null }
    : { compiled: built.model, version, run: null, failure: result.failure };
}

/* ------------------------------------------------------------------ *
 * Stable nothings
 * ------------------------------------------------------------------ */

/**
 * One frozen empty of each shape, at module scope.
 *
 * Every one of these is handed to a table as a prop. A fresh `new Map()` per render is a fresh
 * identity per render, which defeats the memo inside each consumer that takes one — so the empty
 * case, which is the case a model spends its first minute in, would render the slowest.
 */
const NO_NUMBERS: ReadonlyMap<string, number> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_NAMES: ReadonlyMap<string, string> = new Map();
/** The axis a create dialog is opened with: there is no model yet to have one. */
const NO_PERIODS: readonly string[] = [];

/**
 * The target nobody picked: the last row, at the last period.
 *
 * A model is read bottom-right — the final line at the final period is the number somebody came
 * for — so the default is that cell rather than the first. `FINAL` rather than `AT` because the
 * engine is explicit that they differ: "a horizon that grows should not silently keep measuring
 * month nine". The index is still set to the last period so that switching the kind to `AT` in the
 * picker lands somewhere sensible instead of on period zero.
 */
function fallbackTarget(document: ModelDocument): Target | null {
  const rows = document.rows;
  if (rows.length === 0) return null;
  return {
    key: rows[rows.length - 1].key,
    kind: 'FINAL',
    period: Math.max(0, document.spec.periods.length - 1),
  };
}
/* ------------------------------------------------------------------ *
 * The registers
 * ------------------------------------------------------------------ */

/**
 * What the add button opens, per register.
 *
 * Total over `Sheet` and holding the dialog state itself rather than a kind string, so the button
 * needs no switch and a fifth register would be told, by the compiler, that it owes an answer.
 */
const NEW_OF: Readonly<Record<Sheet, Editing | null>> = {
  results: null,
  rows: { kind: 'ROW', subject: null },
  assumptions: { kind: 'ASSUMPTION', subject: null },
  scenarios: { kind: 'SCENARIO', subject: null },
};

interface SheetsProps {
  readonly document: ModelDocument;
  /** Null when the structure did not compile. Carries the graph, hence the depth column. */
  readonly compiled: CompiledModel | null;
  /** Null when the structure compiled but this scenario would not resolve. */
  readonly run: ModelRun | null;
  readonly failure: ModelFailure | null;
  /** The scenario being read. Null only while a model has no scenarios at all. */
  readonly active: DocScenario | null;
  readonly target: Target | null;
  /** False for a published or archived model: the registers still read, nothing writes. */
  readonly editable: boolean;
  readonly loading: boolean;
  readonly sheet: Sheet;
  readonly onSheet: (next: Sheet) => void;
  readonly onTarget: (next: Target) => void;
  /** One channel for all six new/edit acts, since the dialogs are one state machine. */
  readonly onEdit: (next: Editing) => void;
  readonly onActivate: (id: string) => void;
  /** Deletes and overrides go straight through: they need no dialog and no confirmation state. */
  readonly commands: ModelCommands;
}
/**
 * What each tab's badge counts. Results has no count, because it is not a list of anything.
 *
 * A total record of accessors rather than a chain of ternaries, for the same reason the labels are
 * a record: adding a register should be a compile error until somebody has said what it shows.
 */
const COUNT_OF: Readonly<Record<Sheet, (document: ModelDocument) => number | null>> = {
  results: () => null,
  rows: (document) => document.rows.length,
  assumptions: (document) => document.assumptions.length,
  scenarios: (document) => document.scenarios.length,
};

/**
 * One register at a time, and the five derivations the tables cannot make for themselves.
 *
 * Each of these exists because a table is given what it draws, never a model to interrogate. The
 * interesting one is `inherited`: `Resolution.changed` carries `by` as the scenario's *name* and
 * not its id, because `resolveScenario` writes `source.set(key, scenario.name)` at the moment it
 * applies the override — so the map a column prints is a filter over what the resolver already
 * recorded, with no id-to-name lookup anywhere. The resolver's output was shaped by what a screen
 * has to print rather than by what was convenient to collect.
 *
 * `depth` is read off `compiled.graph`, not `run.graph`, so the ordering column survives a
 * scenario that will not resolve — the same reasoning that keeps the version alive past a failed
 * run, applied to a column instead of a hash.
 */
function Sheets({
  document,
  compiled,
  run,
  failure,
  active,
  target,
  editable,
  loading,
  sheet,
  onSheet,
  onTarget,
  onEdit,
  onActivate,
  commands,
}: SheetsProps) {
  const { t } = useLocale();

  /** Overrides this scenario wrote itself, as against ones it was handed. */
  const own = useMemo(() => (active === null ? NO_KEYS : new Set(active.overrides.keys())), [active]);

  const inherited = useMemo(() => {
    if (run === null) return NO_NAMES;
    const map = new Map<string, string>();
    for (const change of run.resolution.changed) {
      if (!own.has(change.key)) map.set(change.key, change.by);
    }
    return map;
  }, [own, run]);

  const outOfRange = useMemo(
    () => (run === null ? NO_KEYS : new Set(run.resolution.outOfRange.map((one) => one.key))),
    [run],
  );
  /**
   * How many rows each assumption reaches, or null when nothing compiled.
   *
   * Null and zero are different findings — "this assumption feeds nothing" against "nobody can
   * say yet" — and the table draws the first as a zero and the second as a blank column.
   */
  const reach = useMemo(() => {
    if (compiled === null) return null;
    const map = new Map<string, number>();
    for (const one of document.assumptions) map.set(one.key, reachOf(compiled, one.key).length);
    return map;
  }, [compiled, document.assumptions]);

  /** Key → the period a short given row was held flat from. */
  const held = useMemo(() => {
    if (run === null) return NO_NUMBERS;
    const map = new Map<string, number>();
    for (const one of run.held) map.set(one.key, one.from);
    return map;
  }, [run]);

  const tabs = useMemo<readonly PivotTab<Sheet>[]>(
    () => SHEET_ORDER.map((id) => ({ id, label: t(SHEET_LABEL[id]), badge: COUNT_OF[id](document) })),
    [document, t],
  );

  const adding = ADD_LABEL[sheet];
  const opens = NEW_OF[sheet];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Pivot tabs={tabs} active={sheet} onChange={onSheet} />
        {adding !== null && opens !== null && editable ? (
          <Button variant="accent" onClick={() => onEdit(opens)}>
            <Plus size={14} aria-hidden />
            {t(adding)}
          </Button>
        ) : null}
      </div>
      {sheet === 'results' ? (
        <ResultsPane
          document={document}
          run={run}
          failure={failure}
          target={target}
          onTarget={onTarget}
        />
      ) : null}

      {sheet === 'rows' ? (
        <RowTable
          rows={document.rows}
          depth={compiled === null ? null : compiled.graph.depth}
          held={held}
          periods={document.spec.periods.length}
          editable={editable}
          onEdit={(subject) => onEdit({ kind: 'ROW', subject })}
          onDelete={(subject) => void commands.deleteRow(subject.key)}
          loading={loading}
        />
      ) : null}

      {sheet === 'assumptions' ? (
        <AssumptionTable
          assumptions={document.assumptions}
          values={run === null ? NO_NUMBERS : run.values}
          own={own}
          inherited={inherited}
          outOfRange={outOfRange}
          reach={reach}
          // An override is written *on* a scenario, so with none there is nothing to write it on.
          editable={editable && active !== null}
          onEdit={(subject) => onEdit({ kind: 'ASSUMPTION', subject })}
          onDelete={(subject) => void commands.deleteAssumption(subject.key)}
          onOverride={(key, value) => {
            if (active !== null) void commands.setOverride(active.id, key, value);
          }}
          onClear={(key) => {
            if (active !== null) void commands.clearOverride(active.id, key);
          }}
          loading={loading}
        />
      ) : null}

      {sheet === 'scenarios' ? (
        <ScenarioTable
          scenarios={document.scenarios}
          // Never null while a scenario exists, and the table is not rendered when none does.
          activeId={active === null ? '' : active.id}
          onActivate={onActivate}
          editable={editable}
          onEdit={(subject) => onEdit({ kind: 'SCENARIO', subject })}
          onDelete={(subject) => void commands.deleteScenario(subject.id)}
          loading={loading}
        />
      ) : null}
    </div>
  );
}
interface ResultsPaneProps {
  readonly document: ModelDocument;
  readonly run: ModelRun | null;
  readonly failure: ModelFailure | null;
  readonly target: Target | null;
  readonly onTarget: (next: Target) => void;
}

/**
 * The answer, or the reason there is not one.
 *
 * Its own component rather than a ternary inside `Sheets` because three states share this tab and
 * the third is not a failure: a model with no scenarios has nothing to resolve against, so it is
 * owed a sentence about scenarios rather than a failure report about nothing.
 *
 * The picker stays on screen through all three, which is the decision worth stating. It edits
 * which cell the certificate will be about, and that is a choice somebody can make about a model
 * that does not currently run — the target is part of the question, not part of the answer.
 */
function ResultsPane({ document, run, failure, target, onTarget }: ResultsPaneProps) {
  const { t } = useLocale();
  const picker = (
    <TargetPicker
      rows={document.rows}
      periods={document.spec.periods}
      target={target}
      onChange={onTarget}
    />
  );

  if (run !== null) {
    return (
      <>
        {picker}
        <ResultsGrid
          run={run}
          rows={document.rows}
          assumptions={document.assumptions}
          target={target}
          // Clicking a cell asks about that cell: this period, not the horizon.
          onPick={(key, period) => onTarget({ key, kind: 'AT', period })}
        />
      </>
    );
  }

  if (failure !== null) {
    return (
      <>
        {picker}
        <FailureReport failure={failure} />
      </>
    );
  }

  return (
    <>
      {picker}
      <EmptyState
        icon={FunctionSquare}
        title={t({ ar: 'لا سيناريو بعد', fr: 'Aucun scénario', en: 'No scenario yet' })}
        description={t({
          ar: 'يُقرأ النموذج من خلال سيناريو. أضف واحدًا وستمتلئ الشبكة.',
          fr: 'Un modèle se lit à travers un scénario. Ajoutez-en un et la grille se remplira.',
          en: 'A model is read through a scenario. Add one and the grid fills.',
        })}
      />
    </>
  );
}
/* ------------------------------------------------------------------ *
 * Taking the grid out
 * ------------------------------------------------------------------ */

/** Quotes a field only when it would otherwise break the row. */
function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The run, as a spreadsheet would read it.
 *
 * Raw numbers with a dot, not `fmt` — this leaves the browser for Excel, and a French locale's
 * comma decimal separator would arrive there as a column break. Rows only, not assumptions: this
 * is the answer, and the inputs that produced it are three commands away in the audit trail.
 *
 * A row with no series at all still gets its line, empty, because a reader comparing two exports
 * needs the shape to be stable even when a formula stopped resolving.
 */
function toCsv(document: ModelDocument, run: ModelRun): string {
  const lines: string[] = [`key,label,unit,${run.periods.map(csvCell).join(',')}`];
  for (const row of document.rows) {
    const series = run.series.get(row.key) ?? [];
    const cells = run.periods.map((_, index) => (index < series.length ? String(series[index]) : ''));
    lines.push([csvCell(row.key), csvCell(row.label), csvCell(row.unit), ...cells].join(','));
  }
  return lines.join('\r\n');
}
/* ------------------------------------------------------------------ *
 * The workbench
 * ------------------------------------------------------------------ */

/**
 * One model, opened: the rail, the four registers, the certificate and the fourteen verbs.
 *
 * The reads are three and they are chained by a key. `modelingModels` is unconditional and cheap —
 * counts folded in by SQL — and it is also the only place a *key* becomes an *id*, because the
 * window remembers which model it had open by key and every command takes the id. So the spec and
 * the certificate history are `enabled` only once that lookup lands, and a key that names nothing
 * (a model somebody else archived) reads as no document rather than as an error.
 */
export function Workbench({ modelKey, onPickModel, view, onCommand, sink }: WorkbenchProps) {
  const { t } = useLocale();
  const shellActions = useModelingActions();

  const [sheet, setSheet] = useState<Sheet>('results');
  const [editing, setEditing] = useState<Editing>(CLOSED);
  /** Which scenario somebody picked, not which one is shown. See the file header. */
  const [pickedScenario, setPickedScenario] = useState<string | null>(null);
  const [pickedTarget, setPickedTarget] = useState<Target | null>(null);

  const models = useDataset('modelingModels');
  const summaries = useMemo(() => readModels(models.rows), [models.rows]);

  const modelId = useMemo(() => {
    if (modelKey === null) return null;
    const found = summaries.find((one) => one.key === modelKey);
    return found === undefined ? null : found.id;
  }, [modelKey, summaries]);

  const spec = useDataset('modelingSpec', {
    where: modelId === null ? undefined : { modelId },
    enabled: modelId !== null,
  });
  const certificates = useDataset('modelingCertificates', {
    where: modelId === null ? undefined : { modelId },
    enabled: modelId !== null,
    limit: 24,
  });

  const document = useMemo(() => readDocument(spec.rows), [spec.rows]);
  const history = useMemo(() => readCertificates(certificates.rows), [certificates.rows]);
  const commands = useModelCommands(modelId);
  /**
   * The scenario being read: the one picked, or the first one, or none at all.
   *
   * An explicit `length === 0` rather than `scenarios[0] ?? null`, because this project compiles
   * without `noUncheckedIndexedAccess` — the index expression types as `DocScenario`, so the `??`
   * would read as dead code to anybody and to the linter, while still being the only thing
   * standing between an empty model and an undefined id going to the engine.
   */
  const active = useMemo(() => {
    if (document === null || document.scenarios.length === 0) return null;
    const found = document.scenarios.find((one) => one.id === pickedScenario);
    return found ?? document.scenarios[0];
  }, [document, pickedScenario]);

  const { compiled, version, run, failure } = useMemo(
    () => compile(document, active === null ? null : active.id),
    [active, document],
  );

  /**
   * The target, checked against the model it is about.
   *
   * Both halves of the pick are validated, not just the row: a horizon that shrank leaves a period
   * index pointing past the end, and `measureRun` answers `undefined` for that — a certificate
   * measuring nothing, arrived at silently. A stale pick falls back to the last cell instead.
   */
  const target = useMemo(() => {
    if (document === null) return null;
    const picked = pickedTarget;
    if (
      picked !== null &&
      document.rows.some((one) => one.key === picked.key) &&
      picked.period >= 0 &&
      picked.period < document.spec.periods.length
    ) {
      return picked;
    }
    return fallbackTarget(document);
  }, [document, pickedTarget]);

  /**
   * The grade, measured on every change rather than when the button is pressed.
   *
   * The engine puts the price at `scenarios + 2·ranged + 1` runs of a model compiled once, and says
   * in as many words that this is why a certificate can be recomputed rather than stored and
   * trusted. So `certify` below stores what the aside is already showing, and nobody is handed a
   * grade the panel did not display first.
   */
  const live = useMemo<Certificate | null>(
    () =>
      compiled === null || run === null || active === null || target === null
        ? null
        : measure(compiled, active.id, target),
    [active, compiled, run, target],
  );
  /**
   * Whether publishing is allowed, and why not when it is not.
   *
   * `publishGate` is given `elevationRequired` rather than `granted`, which is the distinction the
   * toolbar needs: a capability that is merely ungranted disables the button, while one that can be
   * elevated to should offer the elevation instead of pretending the act is impossible.
   */
  const publish = useCapability('model.publish');
  const gate = useMemo(
    () => publishGate(document, version, publish.elevationRequired),
    [document, publish.elevationRequired, version],
  );

  /** A published model is read, not edited. Reopening it as a draft is its own verb. */
  const editable = document !== null && document.header.status === 'DRAFT';

  const takenModels = useMemo(() => new Set(summaries.map((one) => one.key)), [summaries]);

  /**
   * Two namespaces, and they are not the same size.
   *
   * `taken` answers "may I use this key", and rows and assumptions share one namespace, so both
   * dialogs are handed the union — a row called `margin` and an assumption called `margin` would
   * make `margin` in a formula ambiguous, and the engine resolves it in one direction only.
   * `known` answers "may a formula name this", which is the same set seen from the other side.
   */
  const known = useMemo(() => {
    if (document === null) return NO_KEYS;
    const keys = new Set<string>();
    for (const row of document.rows) keys.add(row.key);
    for (const one of document.assumptions) keys.add(one.key);
    return keys;
  }, [document]);

  const rowKeys = useMemo(
    () => (document === null ? NO_KEYS : new Set(document.rows.map((one) => one.key))),
    [document],
  );
  /**
   * The eight toolbar verbs, in one object.
   *
   * `recompute` refetches rather than bumping a local counter, because the numbers on screen are
   * derived from the spec and the spec is what may have gone stale — somebody else's edit, or this
   * session's own command landing after an optimistic render. Both `refetch`s are stable
   * `useCallback`s in the SDK, so they are honest memo dependencies rather than a lie that happens
   * to work.
   *
   * `certify` sends `live`, which is the certificate the aside is displaying. There is no second
   * measurement here and deliberately so: the panel and the ledger cannot disagree if only one
   * number was ever computed.
   */
  const actions = useMemo<WorkbenchActions>(
    () => ({
      newModel: () => setEditing({ kind: 'MODEL', subject: null }),
      editHeader: () => {
        if (document !== null) setEditing({ kind: 'MODEL', subject: document.header });
      },
      publish: () => {
        if (version !== null) void commands.publish(version.fullHash);
      },
      revise: () => void commands.revise(),
      archive: () => void commands.archive(),
      restore: () => void commands.restore(),
      recompute: () => {
        spec.refetch();
        certificates.refetch();
      },
      certify: () => {
        if (live !== null) void commands.certify(live);
      },
    }),
    [certificates.refetch, commands, document, live, spec.refetch, version],
  );
  /**
   * The five verbs the workbench takes off the shell, and the ones it deliberately does not.
   *
   * `shell.ts` consults this before its own handlers and reads `false` as "not mine", so every
   * command not named here keeps working exactly as it did — `find` still lands in the search box,
   * `reset` still clears the projection's overrides. That is why this returns a boolean instead of
   * swallowing everything while the workbench is open.
   *
   * `export` and `copy` are the same act with two destinations, so they build the same CSV. Both
   * refuse rather than emit an empty file when there is nothing to export: a header row on its own
   * looks like a model that computed to nothing, which is a worse answer than no file at all.
   */
  useEffect(() => {
    sink.current = (id: string): boolean => {
      if (id === 'refresh') {
        actions.recompute();
        return true;
      }
      if (id === 'certify') {
        actions.certify();
        return true;
      }
      if (id === 'publish') {
        actions.publish();
        return true;
      }
      if (id === 'export' || id === 'copy') {
        if (document === null || run === null || active === null) return true;
        const csv = toCsv(document, run);
        if (id === 'copy') shellActions.copy(csv);
        else shellActions.exportCsv(csv, `${document.header.key}-${active.id}.csv`);
        return true;
      }
      return false;
    };
    return () => {
      sink.current = null;
    };
  }, [actions, active, document, run, shellActions, sink]);

  /**
   * Open something, once, when there is something to open.
   *
   * The condition is on `modelKey` rather than on a "has run" flag, so this fires again after the
   * only model was archived out of the list and a different one arrived — and stops firing the
   * moment a key is set, including a key the person chose themselves.
   */
  useEffect(() => {
    if (modelKey === null && summaries.length > 0) onPickModel(summaries[0].key);
  }, [modelKey, onPickModel, summaries]);
  const close = useCallback(() => setEditing(CLOSED), []);

  /**
   * The frame, and then the dialogs.
   *
   * `busy` is the union of a command in flight and a spec being refetched, because both mean the
   * numbers on screen are about to change and neither should be pressed against twice. The aside's
   * `loading` is the certificate read alone — a slow history should grey the history, not the
   * toolbar.
   */
  return (
    <>
      <AppFrame
        padded
        commands={
          <WorkbenchToolbar
            document={document}
            gate={gate}
            view={view}
            onCommand={onCommand}
            actions={actions}
            busy={commands.running || spec.loading}
            compiled={compiled !== null}
          />
        }
        nav={
          <ModelRail
            models={summaries}
            selectedKey={modelKey}
            onSelect={onPickModel}
            onNew={actions.newModel}
            loading={models.loading}
          />
        }
        navLabel={t({ ar: 'النماذج', fr: 'Modèles', en: 'Models' })}
        aside={
          <CertificateAside
            live={live}
            history={history}
            onStore={actions.certify}
            storing={commands.running}
            loading={certificates.loading}
          />
        }
        asideLabel={t({ ar: 'الشهادة', fr: 'Certificat', en: 'Certificate' })}
        status={<WorkbenchStatus document={document} version={version} />}
      >
        {document === null ? (
          <EmptyState
            icon={FunctionSquare}
            title={t({ ar: 'لا نموذج مفتوح', fr: 'Aucun modèle ouvert', en: 'No model open' })}
            description={t({
              ar: 'اختر نموذجًا من القائمة، أو ابنِ واحدًا جديدًا.',
              fr: 'Choisissez un modèle dans la liste, ou créez-en un.',
              en: 'Pick a model from the list, or build a new one.',
            })}
            action={
              <Button variant="accent" onClick={actions.newModel}>
                <Plus size={14} aria-hidden />
                {t({ ar: 'نموذج جديد', fr: 'Nouveau modèle', en: 'New model' })}
              </Button>
            }
          />
        ) : (
          <Sheets
            document={document}
            compiled={compiled}
            run={run}
            failure={failure}
            active={active}
            target={target}
            editable={editable}
            loading={spec.loading}
            sheet={sheet}
            onSheet={setSheet}
            onTarget={setPickedTarget}
            onEdit={setEditing}
            onActivate={setPickedScenario}
            commands={commands}
          />
        )}
      </AppFrame>
      {/*
        The model dialog is mounted unconditionally; the other three only with a document.

        Not an inconsistency: creating a model is the one edit that happens when nothing is open,
        and it is how a person gets their first one. There is no corresponding act for the rest —
        a row belongs to a model, so "add a row to nothing" is not a state to be rendered but a
        state to be unreachable, and `document !== null` is what makes it so without a guard
        inside every form.
      */}
      <ModelDialog
        open={editing.kind === 'MODEL'}
        subject={editing.kind === 'MODEL' ? editing.subject : null}
        periods={document === null ? NO_PERIODS : document.spec.periods}
        taken={takenModels}
        onCreate={commands.create}
        onUpdate={commands.update}
        onClose={close}
      />

      {document === null ? null : (
        <>
          <AssumptionDialog
            open={editing.kind === 'ASSUMPTION'}
            subject={editing.kind === 'ASSUMPTION' ? editing.subject : null}
            // Rows and assumptions are one namespace; the dialog is told the whole of it.
            taken={known}
            count={document.assumptions.length}
            onSave={commands.saveAssumption}
            onClose={close}
          />
          <RowDialog
            open={editing.kind === 'ROW'}
            subject={editing.kind === 'ROW' ? editing.subject : null}
            // Two different sets, and the difference is the point: `taken` is what a row may not be
            // called, `known` is what its formula may read.
            taken={rowKeys}
            periods={document.spec.periods}
            known={known}
            count={document.rows.length}
            onSave={commands.saveRow}
            onClose={close}
          />
          <ScenarioDialog
            open={editing.kind === 'SCENARIO'}
            subject={editing.kind === 'SCENARIO' ? editing.subject : null}
            scenarios={document.scenarios}
            count={document.scenarios.length}
            onSave={commands.saveScenario}
            onClose={close}
          />
        </>
      )}
    </>
  );
}
