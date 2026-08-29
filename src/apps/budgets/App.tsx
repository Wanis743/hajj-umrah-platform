/**
 * Budgets — the frame.
 *
 * What the window looks like, and nothing else. What a press means is `shell.ts`, every
 * read is `model.ts`, and every judgement is `variance.ts`; this file arranges four regions
 * around one register and hands each of them what the shell already worked out.
 *
 * The layout is the review conversation in order: the rail says which budget and how much
 * of it is consumed, the register says which accounts are off and by how much, the pane on
 * the right is the account somebody is about to change — or the plan's own summary when
 * nothing is selected — and the status bar names the basis, which is the sentence that
 * makes the rest of the numbers mean anything.
 *
 * The one dialog is a field, not a confirmation: `budget.upsert` carries `ledger.post`, so
 * the kernel has already asked.
 */
import { type MouseEvent, useCallback } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import type { Budget } from '../shared/ledger';
import { BudgetRail, BudgetStatus, BudgetToolbar, RowMenu } from './chrome';
import { AccountPane, BudgetPane } from './detail';
import { AmountDialog } from './dialogs';
import { RollupList, VarianceList } from './list';
import type { BudgetModel, BudgetView } from './model';
import { useBudgetShell } from './shell';
import type { BudgetAssessment, RollupRow, VarianceRow } from './variance';

/**
 * The window's title: the budget, and how many accounts are on the wrong side of it.
 *
 * The count is there for the reason a mail client puts one in its title — the taskbar is
 * where somebody looks while the window is behind something else, and "3" answers the only
 * question they have at that moment.
 */
function windowTitle(budget: Budget | null, assessment: BudgetAssessment, locale: AppLocale): string {
  const name = locale.tr('الموازنات', 'Budgets', 'Budgets');
  if (budget === null) return name;
  const label = budget.name === '' ? locale.tr('بلا اسم', 'Sans nom', 'Untitled') : budget.name;
  const head = `${name} — ${label}`;
  return assessment.adverse === 0 ? head : `${head} (${fmt.integer(assessment.adverse, locale.lang)})`;
}

/**
 * The register, which is one of two grids.
 *
 * The rollup is not a filtered variance grid, so it gets its own component rather than a
 * flag: five rows, no selection, no search. The variance and plan views *are* the same
 * grid — one boolean apart — because the moment they became two components they would
 * start disagreeing about column widths.
 */
interface BodyProps {
  readonly view: BudgetView;
  readonly model: BudgetModel;
  readonly searching: boolean;
  onSelect: (id: string | null) => void;
  onActivate: (row: VarianceRow) => void;
  onContext: (row: VarianceRow, event: MouseEvent) => void;
  onGroup: (group: RollupRow) => void;
}

function BudgetBody({ view, model, searching, onSelect, onActivate, onContext, onGroup }: BodyProps) {
  // Only the first load is a spinner. A refresh keeps the numbers on screen, because a
  // grid that empties itself every five seconds is a grid nobody can read a total off.
  const cold = model.loading && model.accounts.length === 0;
  if (view === 'rollup') {
    return <RollupList rows={model.assessment.groups} loading={cold} onActivate={onGroup} />;
  }
  return (
    <VarianceList
      rows={model.rows}
      selectedId={model.selected?.account.id ?? null}
      loading={cold}
      searching={searching}
      showIdle={view === 'plan'}
      onSelect={onSelect}
      onActivate={onActivate}
      onContext={onContext}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

export default function BudgetsApp({ runtime }: AppEntryProps) {
  const shell = useBudgetShell();
  const { model, perform } = shell;
  const assessment = model.assessment;
  const selected = model.selected;

  // Toolbar, accelerators, jump list and command palette are one path in.
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(model.budget, assessment, runtime.locale));

  /** The row menu acts on the row it names, which is not always the selected one. */
  const onMenuSelect = useCallback(
    (id: string) => {
      const row = shell.menu === null ? null : shell.menu.row;
      shell.closeMenu();
      if (row !== null) perform(id, row);
    },
    [perform, shell],
  );

  // Double-click sets the amount, which is the only thing a plan row is for.
  const setAmount = useCallback((row: VarianceRow) => perform('set', row), [perform]);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(event) => {
        // The amount dialog owns the keyboard while it is open: Ctrl+Enter in a field means
        // save, not "open the dialog again".
        if (shell.editing) return;
        shell.keyDown(event);
      }}
    >
      <AppFrame
        scroll={false}
        navWidth={248}
        asideWidth={352}
        commands={
          <BudgetToolbar
            view={shell.view}
            search={shell.search}
            searchRef={shell.searchRef}
            busy={shell.busy}
            loading={model.loading}
            canSet={shell.canSet}
            canSeed={shell.canSeed}
            adverse={assessment.adverse}
            onSearch={shell.setSearch}
            onCommand={shell.command}
          />
        }
        nav={
          <BudgetRail
            budgets={model.budgets}
            budget={model.budget}
            assessment={assessment}
            onBudget={shell.pickBudget}
          />
        }
        aside={
          // The rollup has no selection, so the pane goes back to the plan there even when a
          // row is still held for the grid to return to.
          shell.view !== 'rollup' && selected !== null ? (
            <AccountPane
              row={selected}
              line={assessment.byAccount.get(selected.account.id) ?? null}
              busy={shell.busy}
              locked={assessment.locked}
              onCommand={shell.command}
            />
          ) : (
            <BudgetPane
              budget={model.budget}
              period={model.period}
              assessment={assessment}
              busy={shell.busy}
              onCommand={shell.command}
            />
          )
        }
        status={
          <BudgetStatus
            view={shell.view}
            shown={shell.shown}
            budget={model.budget}
            period={model.period}
            assessment={assessment}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <BudgetBody
          view={shell.view}
          model={model}
          searching={shell.filtered}
          onSelect={shell.pickAccount}
          onActivate={setAmount}
          onContext={shell.openMenu}
          onGroup={shell.copyGroup}
        />
      </AppFrame>

      {shell.menu === null ? null : (
        <RowMenu
          x={shell.menu.x}
          y={shell.menu.y}
          row={shell.menu.row}
          busy={shell.busy !== null}
          locked={assessment.locked}
          onSelect={onMenuSelect}
          onDismiss={shell.closeMenu}
        />
      )}

      <AmountDialog
        open={shell.editing}
        row={selected}
        dzd={shell.dzd}
        sar={shell.sar}
        busy={shell.busy === 'set' || shell.busy === 'seed'}
        intent={shell.intent}
        onDzd={shell.setDzd}
        onSar={shell.setSar}
        onConfirm={shell.confirmAmount}
        onClose={shell.cancelAmount}
      />
    </div>
  );
}

