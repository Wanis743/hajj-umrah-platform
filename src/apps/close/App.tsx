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
 * Only the reopen has a dialog, and it is a form: the server refuses that call without a
 * reason. The close has none, because `ledger.close` makes the kernel ask.
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
import { CloseRail, CloseStatus, CloseToolbar, TaskMenu } from './chrome';
import { PeriodPane, TaskPane } from './detail';
import { ReopenDialog } from './dialogs';
import { CheckList, TaskList, TrailList } from './list';
import type { AuditRow, CloseModel, CloseView } from './model';
import { useCloseShell } from './shell';

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
  onFix: (id: CheckId) => void;
  onSelect: (id: string | null) => void;
  onActivate: (row: ChecklistRow) => void;
  onContext: (row: ChecklistRow, event: MouseEvent) => void;
  onTrail: (row: AuditRow) => void;
}

/**
 * Which register is the window.
 *
 * Three, not one filtered three ways: the findings, the checklist and the trail share no
 * column, and the loading rule differs too — the trail has its own dataset, so it may
 * still be arriving after the checklist has rendered.
 */
function CloseBody({ view, model, searching, onFix, onSelect, onActivate, onContext, onTrail }: BodyProps) {
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

  const certify = useCallback((row: ChecklistRow) => perform('certify', row), [perform]);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(event) => {
        // The reason dialog owns the keyboard while it is open.
        if (shell.reopening) return;
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
          onFix={shell.fix}
          onSelect={shell.pickTask}
          onActivate={certify}
          onContext={shell.openMenu}
          onTrail={shell.copyTrail}
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

      <ReopenDialog
        open={shell.reopening}
        period={model.period}
        reason={shell.reason}
        busy={shell.busy === 'reopen'}
        onReason={shell.setReason}
        onConfirm={shell.confirmReopen}
        onClose={shell.cancelReopen}
      />
    </div>
  );
}
