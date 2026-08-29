/**
 * Treasury — the frame.
 *
 * What the window looks like, and nothing else. Every read is `model.ts`, every figure is
 * `cash.ts`, every conversion is `rates.ts`, what leaves is `report.ts`, and what a press
 * means is `shell.ts`. This file arranges four regions around one grid and hands each of
 * them what the shell already worked out.
 *
 * The layout is a sentence in order. The toolbar names which of the three reports is on
 * screen. The rail on the left is the question — how far ahead, ranked how — and then, in
 * order, what was actually read, what it comes to, and how it falls either side of the
 * horizon. The grid in the middle is that ranking. The pane on the right is either the
 * whole position or one row's, and the status bar restates the date and the rate, because
 * the status bar is what a screenshot keeps.
 *
 * There is no dialog. Nothing in this window reaches the book, so there is nothing to be
 * sure about before it happens.
 */
import { useCallback } from 'react';
import {
  type AppEntryProps,
  AppFrame,
  type AppLocale,
  useAppCommands,
  useWindowTitle,
} from '@/platform/sdk';
import { type CashRow, LENS_LABEL } from './cash';
import { RowMenu, TreasuryRail, TreasuryStatus, TreasuryToolbar } from './chrome';
import { PositionPane, RowPane } from './detail';
import { TreasuryList } from './list';
import { type Question, timed } from './question';
import { useTreasuryShell } from './shell';

/**
 * The window's title: which report, over what stretch.
 *
 * The taskbar is where somebody looks while the window is behind something else, and at
 * that moment the question is never "how much" — it is "which one is that". Three of these
 * windows open on one book, one per lens, would otherwise be three identical buttons.
 *
 * The cash lens names the day instead of the horizon, because no horizon applies to a
 * balance and a title that said "30 days" over a bank balance would be a promise the
 * figures underneath it do not keep.
 */
function windowTitle(question: Question, today: string, locale: AppLocale): string {
  const name = locale.tr('الخزينة', 'Trésorerie', 'Treasury');
  const lens = locale.t(LENS_LABEL[question.lens]);
  const span = timed(question.lens)
    ? locale.tr(`${question.horizon} يومًا`, `${question.horizon} j`, `${question.horizon} days`)
    : today;
  return `${name} — ${lens} · ${span}`;
}
/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ *
 * The four regions are built as values before the frame is assembled rather than written
 * inline inside it. Each takes eight or ten props off the shell, and nesting all four in
 * one expression is how a rail ends up being handed the status bar's idea of the window.
 */

export default function TreasuryApp({ runtime }: AppEntryProps) {
  const shell = useTreasuryShell();
  const { model, perform, question, source, today } = shell;
  const selected = model.selected;

  // Toolbar, accelerators, jump list and command palette are one path in.
  useAppCommands(shell.command);
  useWindowTitle(windowTitle(question, today, runtime.locale));

  /** The menu acts on the row it names, which is not always the row the pane describes. */
  const onMenuSelect = useCallback(
    (id: string) => {
      const row = shell.menu === null ? null : shell.menu.row;
      shell.closeMenu();
      if (row !== null) perform(id, row);
    },
    [perform, shell],
  );

  /**
   * Double-click opens the postings behind the row, where there are any to open.
   *
   * Only a bank account names a ledger account — a supplier bill names a supplier nothing
   * exposes and an invoice names a booking — so on the two flow lenses this does nothing
   * at all, which is the same answer the two dark buttons in the pane already give.
   */
  const onActivate = useCallback((row: CashRow) => perform('ledger', row), [perform]);

  // Only the first load is a spinner. A refresh keeps the figures on screen: a position
  // that empties itself while somebody reads a balance off it is worse than a stale one.
  const cold = model.loading && model.all.length === 0;
  const commands = (
    <TreasuryToolbar
      lens={question.lens}
      search={question.search}
      searchRef={shell.searchRef}
      busy={shell.busy}
      loading={model.loading}
      beyond={question.beyond}
      outside={shell.outside}
      canDrill={shell.canDrill}
      canReconcile={shell.canReconcile}
      onSearch={shell.setSearch}
      onBeyond={shell.setBeyond}
      onCommand={shell.command}
    />
  );

  // `count` is the lens's own rows, before the find box and the horizon narrowed them —
  // the same population every figure in this pane is summed over.
  const nav = (
    <TreasuryRail
      question={question}
      figures={model.figures}
      outlook={model.outlook}
      rates={model.rates}
      buckets={model.buckets}
      today={today}
      count={model.all.length}
      bounded={model.bounded}
      unpriced={model.unpriced}
      busy={shell.busy}
      onHorizon={shell.setHorizon}
      onSort={shell.setSort}
      onCommand={shell.command}
    />
  );

  // One row's case when a row is held, the whole position's otherwise. The selection
  // survives a change of horizon, of ranking and of the find box, and is dropped only by a
  // change of lens — where the key it was made of stops meaning anything.
  const aside =
    selected === null ? (
      <PositionPane
        figures={model.figures}
        outlook={model.outlook}
        source={source}
        unpriced={model.unpriced}
        busy={shell.busy}
        onCommand={shell.command}
      />
    ) : (
      <RowPane row={selected} source={source} onCommand={shell.command} />
    );
  const status = (
    <TreasuryStatus
      lens={question.lens}
      horizon={question.horizon}
      today={today}
      rates={model.rates}
      printed={model.rows.length}
      hidden={model.hidden}
      figures={model.figures}
      outlook={model.outlook}
      unpriced={model.unpriced}
      bounded={model.bounded}
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
        <TreasuryList
          rows={model.rows}
          lens={question.lens}
          filtered={model.hidden > 0 || question.search.trim() !== ''}
          mixed={shell.mixed}
          selectedKey={shell.selectedKey}
          loading={cold}
          onSelect={shell.pickRow}
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
