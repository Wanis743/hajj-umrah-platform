/**
 * Statements — the frame.
 *
 * What the window looks like, and nothing else. Every read is `model.ts`, every figure is
 * `balances.ts` and `statement.ts`, what leaves is `report.ts`, and what a press means is
 * `shell.ts`; this file arranges four regions around one grid and hands each of them what the
 * shell already worked out.
 *
 * The layout is a sentence in order. The rail on the left is the question — which statement,
 * on which basis, over which window, against which comparison — because a balance sheet read
 * without those four is a column of figures with no date attached. The grid in the middle is
 * the answer and nothing else. The pane on the right is either one account's case or the whole
 * statement's, and the status bar restates the basis because the status bar is what a
 * screenshot keeps.
 *
 * There is no dialog. Nothing in this window reaches the book, so there is nothing to be sure
 * about before it happens.
 */
import { type MouseEvent, useCallback } from 'react';
import {
  type AppEntryProps,
  AppFrame,
  type AppLocale,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import type { FiscalPeriod } from '../shared/ledger';
import type { Basis } from './balances';
import { ReportRail, RowMenu, StatementsStatus, StatementsToolbar } from './chrome';
import { AccountPane, StatementPane } from './detail';
import type { SavedReport } from './document';
import { StatementList, TrialList } from './list';
import type { StatementsModel } from './model';
import { useStatementsShell } from './shell';
import { accountCount, type StatementRow, type StatementView, VIEW_LABEL } from './statement';

/**
 * The window's title: which statement, over which window.
 *
 * The taskbar is where somebody looks while the window is behind something else, and at that
 * moment the question is never "how much" — it is "which statement is that, and over what".
 * A title that said only "Statements" would leave three windows on one book indistinguishable.
 */
function windowTitle(report: SavedReport, period: FiscalPeriod | null, locale: AppLocale): string {
  const name = locale.tr('البيانات المالية', 'États financiers', 'Statements');
  const span =
    report.basis === 'book' || period === null
      ? locale.tr('الدفتر بالكامل', 'Livre entier', 'Whole book')
      : `${period.start} → ${period.end}`;
  return `${name} — ${locale.t(VIEW_LABEL[report.view])} · ${span}`;
}
/* ------------------------------------------------------------------ *
 * The grid
 * ------------------------------------------------------------------ *
 * Two grids rather than one with flags. The income statement and the balance sheet are the same
 * shape — a heading, its accounts, the line they add to — and the trial balance is not: it has
 * two columns per account, a posting count, and no structure to indent. One component switching
 * inside every cell would be two grids wearing a single name.
 */

interface BodyProps {
  readonly view: StatementView;
  readonly model: StatementsModel;
  readonly basis: Basis;
  /** A comparison was asked for and exists, so the last two columns mean something. */
  readonly comparing: boolean;
  onSelect: (id: string | null) => void;
  onActivate: (row: StatementRow) => void;
  onContext: (row: StatementRow, event: MouseEvent) => void;
}

function StatementsBody(props: BodyProps) {
  const { model, view } = props;
  // Only the first load is a spinner. A refresh keeps the figures on screen: a statement that
  // empties itself while somebody is reading a total off it is worse than one a few seconds old.
  const cold = model.loading && model.figures.length === 0;
  const selectedId = model.selected?.accountId ?? null;
  if (view === 'trial') {
    return (
      <TrialList
        rows={model.rows}
        basis={props.basis}
        selectedId={selectedId}
        loading={cold}
        onSelect={props.onSelect}
        onActivate={props.onActivate}
        onContext={props.onContext}
      />
    );
  }
  return (
    <StatementList
      rows={model.rows}
      basis={props.basis}
      selectedId={selectedId}
      comparing={props.comparing}
      loading={cold}
      onSelect={props.onSelect}
      onActivate={props.onActivate}
      onContext={props.onContext}
    />
  );
}
/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

export default function StatementsApp({ runtime }: AppEntryProps) {
  const shell = useStatementsShell();
  const { model, perform, report, source } = shell;
  const selected = model.selected;

  // Toolbar, accelerators, jump list and command palette are one path in.
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(report, source.period, runtime.locale));

  /** The row menu acts on the row it names, which is not always the selected account. */
  const onMenuSelect = useCallback(
    (id: string) => {
      const row = shell.menu === null ? null : shell.menu.row;
      shell.closeMenu();
      if (row !== null) perform(id, row);
    },
    [perform, shell],
  );

  /** Double-click opens the account behind a line, which is where a disbelieved figure is settled. */
  const onActivate = useCallback((row: StatementRow) => perform('ledger', row), [perform]);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={shell.keyDown}
    >
      <AppFrame
        scroll={false}
        navWidth={292}
        asideWidth={360}
        commands={
          <StatementsToolbar
            view={report.view}
            search={report.search}
            searchRef={shell.searchRef}
            busy={shell.busy}
            loading={model.loading}
            showZero={report.showZero}
            canDrill={shell.canDrill}
            onSearch={shell.setSearch}
            onZero={shell.setZero}
            onCommand={shell.command}
          />
        }
        nav={
          <ReportRail
            report={report}
            periods={model.periods}
            period={model.period}
            comparison={source.comparison}
            summary={model.set.summary}
            postings={model.postings}
            bounded={model.bounded}
            busy={shell.busy}
            onBasis={shell.setBasis}
            onPeriod={shell.setPeriod}
            onCompare={shell.setCompare}
            onCommand={shell.command}
          />
        }
        aside={
          // One account's case when a row is held, the whole statement's otherwise. The account
          // survives a change of statement, because the same account is on all three of them.
          selected === null ? (
            <StatementPane
              view={report.view}
              summary={model.set.summary}
              source={source}
              postings={model.postings}
              coveredFrom={model.coveredFrom}
              busy={shell.busy}
              onCommand={shell.command}
            />
          ) : (
            <AccountPane figure={selected} source={source} onCommand={shell.command} />
          )
        }
        status={
          <StatementsStatus
            view={report.view}
            basis={report.basis}
            period={source.period}
            comparison={source.comparison}
            accounts={accountCount(model.rows)}
            hidden={model.hidden}
            postings={model.postings}
            summary={model.set.summary}
            bounded={model.bounded}
            coveredFrom={model.coveredFrom}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <StatementsBody
          view={report.view}
          model={model}
          basis={report.basis}
          comparing={source.comparison !== null}
          onSelect={shell.pickAccount}
          onActivate={onActivate}
          onContext={shell.openMenu}
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
    </div>
  );
}
