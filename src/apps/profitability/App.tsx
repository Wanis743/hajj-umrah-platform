/**
 * Profitability — the frame.
 *
 * What the window looks like, and nothing else. Every read is `model.ts`, every figure is
 * `figures.ts`, what leaves is `report.ts`, and what a press means is `shell.ts`; this file
 * arranges four regions around one grid and hands each of them what the shell already worked
 * out.
 *
 * The layout is a sentence in order. The rail on the left is the question — by what, over what,
 * against what, ranked how — and beneath it the one figure that decides whether the answer is
 * about the business or about the tagging. The grid in the middle is the ranking and nothing
 * else. The pane on the right is either one member's case or the whole report's, and the status
 * bar restates the basis because the status bar is what a screenshot keeps.
 *
 * There is no dialog. Nothing in this window reaches the book, so there is nothing to be sure
 * about before it happens.
 */
import { useCallback } from 'react';
import {
  type AppEntryProps,
  AppFrame,
  type AppLocale,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import { ProfitabilityRail, ProfitabilityStatus, ProfitabilityToolbar, RowMenu } from './chrome';
import { MemberPane, SlicePane } from './detail';
import type { MemberFigure } from './figures';
import { ProfitabilityList } from './list';
import { DIMENSION_LABEL, type Question } from './question';
import type { Provenance } from './report';
import { useProfitabilityShell } from './shell';

/**
 * The window's title: by what, over what.
 *
 * The taskbar is where somebody looks while the window is behind something else, and at that
 * moment the question is never "how much" — it is "which report is that". Two of these windows
 * open on one book, one by package and one by branch, would otherwise be indistinguishable.
 */
function windowTitle(question: Question, source: Provenance, locale: AppLocale): string {
  const name = locale.tr('الربحية', 'Rentabilité', 'Profitability');
  const span =
    question.basis === 'book' || source.period === null
      ? locale.tr('الدفتر بالكامل', 'Livre entier', 'Whole book')
      : `${source.period.start} → ${source.period.end}`;
  return `${name} — ${locale.t(DIMENSION_LABEL[question.dimension])} · ${span}`;
}
/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ *
 * The four regions are built as values before the frame is assembled rather than written inline
 * inside it. Each of them takes eight or ten props off the shell, and nesting all four in one
 * expression is how a rail ends up being handed the status bar's idea of the window.
 */

export default function ProfitabilityApp({ runtime }: AppEntryProps) {
  const shell = useProfitabilityShell();
  const { model, perform, question, source } = shell;
  const selected = model.selected;

  // Toolbar, accelerators, jump list and command palette are one path in.
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(question, source, runtime.locale));

  /** The row menu acts on the row it names, which is not always the member the pane describes. */
  const onMenuSelect = useCallback(
    (id: string) => {
      const row = shell.menu === null ? null : shell.menu.row;
      shell.closeMenu();
      if (row !== null) perform(id, row);
    },
    [perform, shell],
  );

  /** Double-click opens the largest account behind a row: where a disbelieved margin is settled. */
  const onActivate = useCallback((row: MemberFigure) => perform('ledger', row), [perform]);

  // Only the first load is a spinner. A refresh keeps the figures on screen: a ranking that
  // empties itself while somebody reads a margin off it is worse than one a few seconds old.
  const cold = model.loading && model.slice.members.length === 0;

  const commands = (
    <ProfitabilityToolbar
      dimension={question.dimension}
      search={question.search}
      searchRef={shell.searchRef}
      busy={shell.busy}
      loading={model.loading}
      showSilent={question.showSilent}
      canDrill={shell.canDrill}
      onSearch={shell.setSearch}
      onSilent={shell.setSilent}
      onCommand={shell.command}
    />
  );
  const nav = (
    <ProfitabilityRail
      question={question}
      slice={model.slice}
      periods={model.periods}
      period={model.period}
      comparison={source.comparison}
      bounded={model.bounded}
      unnamed={model.unnamed}
      busy={shell.busy}
      onBasis={shell.setBasis}
      onPeriod={shell.setPeriod}
      onCompare={shell.setCompare}
      onSort={shell.setSort}
      onCommand={shell.command}
    />
  );

  // One member's case when a row is held, the whole report's otherwise. The selection survives a
  // change of ranking and a change of search, and is dropped only by a change of dimension —
  // where the key it was made of stops meaning anything.
  const aside =
    selected === null ? (
      <SlicePane
        slice={model.slice}
        source={source}
        coveredFrom={model.coveredFrom}
        busy={shell.busy}
        onCommand={shell.command}
      />
    ) : (
      <MemberPane
        member={selected}
        source={source}
        departures={model.departures}
        onCommand={shell.command}
      />
    );
  const status = (
    <ProfitabilityStatus
      dimension={question.dimension}
      basis={question.basis}
      period={source.period}
      comparison={source.comparison}
      printed={model.rows.length}
      hidden={model.hidden}
      postings={model.slice.lines}
      slice={model.slice}
      unnamed={model.unnamed}
      bounded={model.bounded}
      coveredFrom={model.coveredFrom}
      error={model.error}
      fetchedAt={model.fetchedAt}
    />
  );

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={shell.keyDown}
    >
      <AppFrame
        scroll={false}
        navWidth={300}
        asideWidth={368}
        commands={commands}
        nav={nav}
        aside={aside}
        status={status}
      >
        <ProfitabilityList
          rows={model.rows}
          dimension={question.dimension}
          filtered={model.hidden > 0 || question.search.trim() !== ''}
          selectedKey={shell.selectedKey}
          comparing={source.comparison !== null}
          loading={cold}
          onSelect={shell.pickMember}
          onActivate={onActivate}
          onContext={shell.openMenu}
        />
      </AppFrame>

      {shell.menu === null ? null : (
        <RowMenu
          x={shell.menu.x}
          y={shell.menu.y}
          row={shell.menu.row}
          dimension={question.dimension}
          onSelect={onMenuSelect}
          onDismiss={shell.closeMenu}
        />
      )}
    </div>
  );
}


