/**
 * Modeling — the frame.
 *
 * What the window looks like, and nothing else. Every read is `model.ts`, every number is
 * `forecast.ts`, and what a press means is `shell.ts`; this file arranges four regions around
 * one register and hands each of them what the shell already worked out.
 *
 * The layout is the argument in order. The rail on the left is the hypothesis — driver,
 * window, horizon, adjustments, and the plan to measure it against — because a forecast read
 * without its assumptions is a promise. The register in the middle is what the hypothesis
 * produced. The pane on the right is either one account's own case or the whole model's, and
 * the status bar restates the scenario because the status bar is what a screenshot keeps.
 *
 * The one dialog collects a number. It is not a confirmation: nothing in this window reaches
 * the book, so there is nothing to be sure about.
 */
import { type CSSProperties, type KeyboardEvent, type MouseEvent, useCallback } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import { ModelingStatus, ModelingToolbar, RowMenu, ScenarioRail } from './chrome';
import { AccountPane, ScenarioPane } from './detail';
import { OverrideDialog } from './dialogs';
import {
  type CompareRow,
  type ForecastRow,
  METHOD_LABEL,
  type Projection,
  type Scenario,
  type TimelineRow,
} from './forecast';
import { CompareList, ForecastList, TimelineList } from './list';
import type { ModelingModel, ModelingView } from './model';
import { useModelingShell } from './shell';
import { Workbench } from './workbench';

/**
 * The window's title: the driver and the horizon, and the overrides if there are any.
 *
 * The taskbar is where somebody looks while the window is behind something else, and at that
 * moment the question is never "how much" — it is "which model am I looking at". A count of
 * hand-entered numbers is the second half of that answer.
 */
function windowTitle(scenario: Scenario, projection: Projection, locale: AppLocale): string {
  const name = locale.tr('النماذج المالية', 'Modélisation', 'Modeling');
  const driver = locale.t(METHOD_LABEL[scenario.method]);
  const horizon = `${fmt.integer(scenario.horizon, locale.lang)} ${locale.tr('شهر', 'mois', 'mo')}`;
  const head = `${name} — ${driver} · ${horizon}`;
  return projection.overrides === 0
    ? head
    : `${head} (${fmt.integer(projection.overrides, locale.lang)})`;
}

/**
 * The same line, for the other half of the window.
 *
 * A sibling rather than a branch inside `windowTitle`, because that function takes the projection's
 * `Scenario` — a driver, a horizon and a set of per-account overrides — and the workbench has no
 * such object. Its state is a model key and nothing else, so widening the signature would mean
 * passing two things where one is always null.
 */
function workbenchTitle(modelKey: string | null, locale: AppLocale): string {
  const name = locale.tr('النماذج المالية', 'Modélisation', 'Modeling');
  const bench = locale.tr('المشغل', 'Atelier', 'Workbench');
  return modelKey === null ? `${name} — ${bench}` : `${name} — ${bench} · ${modelKey}`;
}

/** The outer sheet, hoisted so the workbench and the projection are laid out by one object. */
const SHEET: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
};

/* ------------------------------------------------------------------ *
 * The register
 * ------------------------------------------------------------------ *
 * Three grids rather than one with flags. The forecast is per account, the timeline is per
 * month and the comparison is per account type; they share no column, so one component with
 * a switch inside every cell would be three grids wearing a single name.
 */

interface BodyProps {
  readonly view: ModelingView;
  readonly model: ModelingModel;
  readonly searching: boolean;
  readonly showQuiet: boolean;
  readonly lookback: number;
  onSelect: (id: string | null) => void;
  onActivate: (row: ForecastRow) => void;
  onContext: (row: ForecastRow, event: MouseEvent) => void;
  onMonth: (row: TimelineRow) => void;
  onGroup: (row: CompareRow) => void;
}

function ModelingBody(props: BodyProps) {
  const { view, model } = props;
  // Only the first load is a spinner. A refresh keeps the numbers on screen, because a grid
  // that empties itself every few seconds is a grid nobody can read a total off.
  const cold = model.loading && model.accounts.length === 0;
  const hasPlan = model.budget !== null;
  if (view === 'timeline') {
    return <TimelineList rows={model.projection.timeline} loading={cold} onActivate={props.onMonth} />;
  }
  if (view === 'compare') {
    return (
      <CompareList
        rows={model.projection.compare}
        loading={cold}
        hasPlan={hasPlan}
        onActivate={props.onGroup}
      />
    );
  }
  return (
    <ForecastList
      rows={model.rows}
      selectedId={model.selected?.account.id ?? null}
      loading={cold}
      searching={props.searching}
      showQuiet={props.showQuiet}
      hasPlan={hasPlan}
      lookback={props.lookback}
      onSelect={props.onSelect}
      onActivate={props.onActivate}
      onContext={props.onContext}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

export default function ModelingApp({ runtime }: AppEntryProps) {
  const shell = useModelingShell();
  const { model, perform, scenario, view } = shell;
  const selected = model.selected;

  // Toolbar, accelerators, jump list and command palette are one path in.
  useAppCommands(shell.command);
  useWindowTitle(
    view === 'workbench'
      ? workbenchTitle(shell.modelKey, runtime.locale)
      : windowTitle(scenario, model.projection, runtime.locale),
  );

  /**
   * One keyboard handler for both halves of the window.
   *
   * Hoisted out of the JSX because two branches now need it, and because the accelerators are the
   * one thing the workbench and the projection genuinely share: `shell.perform` resolves the view
   * switches first, offers everything else to the workbench, and falls back to its own verbs — so
   * Ctrl+4 gets somebody in here and Ctrl+1 gets them out, from either side.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // The dialog owns the keyboard while it is open: Ctrl+Enter in the field means apply,
      // not "open the dialog again".
      if (shell.editing) return;
      shell.keyDown(event);
    },
    [shell.editing, shell.keyDown],
  );

  /** The row menu acts on the row it names, which is not always the selected one. */
  const onMenuSelect = useCallback(
    (id: string) => {
      const row = shell.menu === null ? null : shell.menu.row;
      shell.closeMenu();
      if (row !== null) perform(id, row);
    },
    [perform, shell],
  );

  // Double-click types a number: the one edit a projected row has.
  const onActivate = useCallback((row: ForecastRow) => perform('override', row), [perform]);

  /**
   * The workbench, returned before the projection is assembled.
   *
   * An early return rather than a fourth branch in `ModelingBody`, and the reason is a type as
   * much as a layout: `view` is `ModelingView` at the top of this function and `ModelingStatus`
   * accepts only `ProjectionView`, so returning here is what narrows the variable for every line
   * below. The alternative was a cast at the status bar — the same code, with the compiler no
   * longer checking the claim.
   *
   * It carries its own `AppFrame`, because the two halves share no region: a rail of models is not
   * a rail of drivers, and a certificate is not an account.
   */
  if (view === 'workbench') {
    return (
      <div style={SHEET} onKeyDown={onKeyDown}>
        <Workbench
          modelKey={shell.modelKey}
          onPickModel={shell.pickModel}
          view={view}
          onCommand={shell.command}
          sink={shell.workbenchSink}
        />
      </div>
    );
  }

  return (
    <div style={SHEET} onKeyDown={onKeyDown}>
      <AppFrame
        scroll={false}
        navWidth={272}
        asideWidth={360}
        commands={
          <ModelingToolbar
            view={view}
            search={shell.search}
            searchRef={shell.searchRef}
            busy={shell.busy}
            loading={model.loading}
            canOverride={shell.canOverride}
            canRelease={shell.canRelease}
            overrides={model.projection.overrides}
            showQuiet={shell.showQuiet}
            onSearch={shell.setSearch}
            onQuiet={shell.setQuiet}
            onCommand={shell.command}
          />
        }
        nav={
          <ScenarioRail
            scenario={scenario}
            projection={model.projection}
            budgets={model.budgets}
            budget={model.budget}
            onMethod={shell.setMethod}
            onHorizon={shell.setHorizon}
            onLookback={shell.setLookback}
            onGrowth={shell.setGrowth}
            onUplift={shell.setUplift}
            onBudget={shell.pickBudget}
            onCommand={shell.command}
          />
        }
        aside={
          // The other two views have no account selected — one is months and one is types —
          // so the pane goes back to the whole model there even while a row is still held for
          // the forecast grid to return to.
          view === 'forecast' && selected !== null ? (
            <AccountPane
              row={selected}
              scenario={scenario}
              months={model.projection.historyMonths}
              future={model.projection.futureMonths}
              onCommand={shell.command}
            />
          ) : (
            <ScenarioPane
              projection={model.projection}
              scenario={scenario}
              budget={model.budget}
              coveredFrom={model.coveredFrom}
              busy={shell.busy}
              onCommand={shell.command}
            />
          )
        }
        status={
          <ModelingStatus
            view={view}
            shown={shell.shown}
            scenario={scenario}
            projection={model.projection}
            budget={model.budget}
            coveredFrom={model.coveredFrom}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <ModelingBody
          view={view}
          model={model}
          searching={shell.search.trim() !== ''}
          showQuiet={shell.showQuiet}
          lookback={scenario.lookback}
          onSelect={shell.pickAccount}
          onActivate={onActivate}
          onContext={shell.openMenu}
          onMonth={shell.copyMonth}
          onGroup={shell.copyGroup}
        />
      </AppFrame>

      {shell.menu === null ? null : (
        <RowMenu
          x={shell.menu.x}
          y={shell.menu.y}
          row={shell.menu.row}
          onSelect={onMenuSelect}
          onDismiss={shell.closeMenu}
        />
      )}

      <OverrideDialog
        open={shell.editing}
        row={selected}
        scenario={scenario}
        value={shell.draft}
        onValue={shell.setDraft}
        onConfirm={shell.confirmOverride}
        onClose={shell.cancelOverride}
      />
    </div>
  );
}
