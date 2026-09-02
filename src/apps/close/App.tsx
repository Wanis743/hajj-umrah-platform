/**
 * Period close — the frame.
 *
 * What the window looks like, and nothing else. What a press means is `shell.ts`, every
 * read is `model.ts`, and every judgement is `checks.ts`; this file arranges four regions
 * around one register and hands each of them what the shell already worked out.
 *
 * The layout is the month-end conversation in order: the rail says which period and how
 * much of the checklist is signed, the register says what is still wrong with it, the
 * pane on the right is the argument for closing — or for the one task blocking it — and
 * the status bar carries the difference, which is the number somebody re-reads a dozen
 * times before pressing anything.
 *
 * Every dialog here is a form and none of them is a confirmation: the reopen and the
 * retire because the server refuses those two calls without a reason, and the register's
 * other two because a control will not save without a code and a test will not record
 * without a conclusion. The close has no dialog at all — `ledger.close` makes the kernel
 * ask, and a second prompt saying the same thing teaches people to click through both.
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
import { type FiscalPeriod, PERIOD_STATUS_LABEL } from '../shared/ledger';
import type { CheckId, ChecklistRow, CloseAssessment } from './checks';
import { CloseRail, CloseStatus, CloseToolbar, ControlMenu, TaskMenu } from './chrome';
import type { FinancialControl } from './controls';
import { ControlPane, PeriodPane, TaskPane } from './detail';
import { ControlFormDialog, ControlRetireDialog, ControlTestDialog, ReopenDialog } from './dialogs';
import { CheckList, ControlList, TaskList, TrailList } from './list';
import type { AuditRow, CloseModel, CloseView } from './model';
import { type CloseShell, useCloseShell } from './shell';

/**
 * The window's title: the period, and what is left of its checklist.
 *
 * The count is there for the reason a mail client puts one in its title — the taskbar is
 * where somebody looks while the window is behind something else, and "4" answers the
 * only question they have at that moment.
 */
function windowTitle(period: FiscalPeriod | null, assessment: CloseAssessment, locale: AppLocale): string {
  const name = locale.tr('إقفال الفترة', 'Clôture de période', 'Period close');
  if (period === null) return name;
  const head = `${name} — ${period.label}`;
  if (assessment.sealed) return `${head} · ${locale.t(PERIOD_STATUS_LABEL[period.status])}`;
  return assessment.openTasks === 0 ? head : `${head} (${fmt.integer(assessment.openTasks, locale.lang)})`;
}

/* ------------------------------------------------------------------ *
 * The register
 * ------------------------------------------------------------------ */

interface BodyProps {
  readonly view: CloseView;
  readonly model: CloseModel;
  readonly searching: boolean;
  /** The register's one clock, so the grid cannot disagree with the pane beside it. */
  readonly now: number;
  onFix: (id: CheckId) => void;
  onSelect: (id: string | null) => void;
  onActivate: (row: ChecklistRow) => void;
  onContext: (row: ChecklistRow, event: MouseEvent) => void;
  onTrail: (row: AuditRow) => void;
  onControl: (id: string | null) => void;
  onControlContext: (control: FinancialControl, event: MouseEvent) => void;
}

/**
 * Which register is the window.
 *
 * Four, not one filtered four ways: the findings, the checklist, the controls and the
 * trail share no column, and the loading rule differs too — the trail and the register
 * each have their own dataset, so either may still be arriving after the checklist has
 * rendered. Each branch reads its own `loading` against its own unfiltered length, so a
 * search that matches nothing shows "no matches" rather than a spinner that never stops.
 */
function CloseBody({
  view,
  model,
  searching,
  now,
  onFix,
  onSelect,
  onActivate,
  onContext,
  onTrail,
  onControl,
  onControlContext,
}: BodyProps) {
  if (view === 'tasks') {
    return (
      <TaskList
        rows={model.visibleTasks}
        selectedId={model.selectedTask?.task.id ?? null}
        loading={model.loading && model.tasks.length === 0}
        searching={searching}
        onSelect={onSelect}
        // Double-click signs the row, which is the one thing a checklist is for.
        onActivate={onActivate}
        onContext={onContext}
      />
    );
  }
  if (view === 'controls') {
    return (
      <ControlList
        rows={model.visibleControls}
        selectedId={model.selectedControl?.id ?? null}
        now={now}
        loading={model.controlsLoading && model.controls.length === 0}
        searching={searching}
        onSelect={onControl}
        onContext={onControlContext}
      />
    );
  }
  if (view === 'trail') {
    return (
      <TrailList
        rows={model.visibleTrail}
        loading={model.trailLoading && model.trail.length === 0}
        searching={searching}
        onActivate={onTrail}
      />
    );
  }
  return (
    <CheckList
      checks={model.assessment.checks}
      loading={model.loading && model.periods.length === 0}
      onFix={onFix}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The register's three forms
 * ------------------------------------------------------------------ *
 * Kept together and out of the frame below, because they are one thing: one draft, one
 * close, and one at a time. Each is mounted unconditionally and told whether it is open,
 * the way `ReopenDialog` is — a dialog that unmounts on close cannot animate out, and the
 * three share the draft anyway, so there is nothing to gain by rendering only the live one.
 *
 * `busy` is read per form and not as `busy !== null`: a refused test leaves the test form
 * open with its text, and a spinner on all three would say the register was doing three
 * things at once.
 */
function RegisterDialogs({ shell }: { readonly shell: CloseShell }) {
  return (
    <>
      <ControlFormDialog
        open={shell.controlDialog === 'edit'}
        target={shell.controlTarget}
        draft={shell.draft}
        busy={shell.busy === 'control'}
        onDraft={shell.setDraft}
        onConfirm={shell.saveControl}
        onClose={shell.closeControl}
      />
      <ControlTestDialog
        open={shell.controlDialog === 'test'}
        target={shell.controlTarget}
        draft={shell.draft}
        busy={shell.busy === 'test'}
        onDraft={shell.setDraft}
        onConfirm={shell.recordTest}
        onClose={shell.closeControl}
      />
      {/* The reason lives in the same draft as the rest; this form is handed only it. */}
      <ControlRetireDialog
        open={shell.controlDialog === 'retire'}
        target={shell.controlTarget}
        reason={shell.draft.reason}
        busy={shell.busy === 'retire'}
        onReason={(reason) => shell.setDraft({ reason })}
        onConfirm={shell.confirmRetire}
        onClose={shell.closeControl}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

export default function CloseApp({ runtime }: AppEntryProps) {
  const shell = useCloseShell();
  const { model, perform } = shell;
  const assessment = model.assessment;

  // Toolbar, accelerators, jump list and command palette are one path in.
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(model.period, assessment, runtime.locale));

  /** The row menu acts on the row it names, which is not always the selected one. */
  const onMenuSelect = useCallback(
    (id: string) => {
      const row = shell.menu === null ? null : shell.menu.row;
      shell.closeMenu();
      if (row !== null) perform(id, row);
    },
    [perform, shell],
  );

  /**
   * The register's menu is shorter than the checklist's, because opening it already moved
   * the selection. Its entries are the toolbar's own command ids, so there is nothing to
   * pass: `command` reads the selected control the same way the toolbar does.
   */
  const onControlMenuSelect = useCallback(
    (id: string) => {
      shell.closeControlMenu();
      shell.command(id);
    },
    [shell],
  );

  const certify = useCallback((row: ChecklistRow) => perform('certify', row), [perform]);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(event) => {
        // Whichever form is open owns the keyboard. A Ctrl+Shift+T typed into a test note
        // must not record the test underneath the dialog that is collecting it.
        if (shell.reopening || shell.controlDialog !== null) return;
        shell.keyDown(event);
      }}
    >
      <AppFrame
        scroll={false}
        navWidth={248}
        asideWidth={352}
        commands={
          <CloseToolbar
            view={shell.view}
            search={shell.search}
            searchRef={shell.searchRef}
            busy={shell.busy}
            loading={model.loading}
            canClose={shell.canClose}
            canReopen={shell.canReopen}
            canCertify={shell.canCertify}
            canTest={shell.canTest}
            canRetire={shell.canRetire}
            failures={assessment.failures}
            onSearch={shell.setSearch}
            onCommand={shell.command}
          />
        }
        nav={
          <CloseRail
            periods={model.periods}
            period={model.period}
            assessment={assessment}
            onPeriod={shell.pickPeriod}
          />
        }
        aside={
          shell.view === 'tasks' && shell.selectedTask !== null ? (
            <TaskPane row={shell.selectedTask} busy={shell.busy} onCommand={shell.command} />
          ) : shell.view === 'controls' && model.selectedControl !== null ? (
            // The pane reads the model and not the shell: the register's selection is a row
            // of the dataset, and the shell only decides which id is the selected one.
            <ControlPane
              control={model.selectedControl}
              tests={model.controlTests}
              testsLoading={model.testsLoading}
              now={shell.now}
              busy={shell.busy}
              onCommand={shell.command}
            />
          ) : (
            <PeriodPane
              period={model.period}
              assessment={assessment}
              busy={shell.busy}
              onCommand={shell.command}
            />
          )
        }
        status={
          <CloseStatus
            view={shell.view}
            shown={shell.shown}
            period={model.period}
            assessment={assessment}
            truncated={model.truncated}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <CloseBody
          view={shell.view}
          model={model}
          searching={shell.filtered}
          now={shell.now}
          onFix={shell.fix}
          onSelect={shell.pickTask}
          onActivate={certify}
          onContext={shell.openMenu}
          onTrail={shell.copyTrail}
          onControl={shell.pickControl}
          onControlContext={shell.openControlMenu}
        />
      </AppFrame>

      {shell.menu === null ? null : (
        <TaskMenu
          x={shell.menu.x}
          y={shell.menu.y}
          row={shell.menu.row}
          busy={shell.busy !== null}
          onSelect={onMenuSelect}
          onDismiss={shell.closeMenu}
        />
      )}

      {shell.controlMenu === null ? null : (
        <ControlMenu
          x={shell.controlMenu.x}
          y={shell.controlMenu.y}
          control={shell.controlMenu.control}
          now={shell.now}
          busy={shell.busy !== null}
          onSelect={onControlMenuSelect}
          onDismiss={shell.closeControlMenu}
        />
      )}

      <ReopenDialog
        open={shell.reopening}
        period={model.period}
        reason={shell.reason}
        busy={shell.busy === 'reopen'}
        onReason={shell.setReason}
        onConfirm={shell.confirmReopen}
        onClose={shell.cancelReopen}
      />

      <RegisterDialogs shell={shell} />
    </div>
  );
}
