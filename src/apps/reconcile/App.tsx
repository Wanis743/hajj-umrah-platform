/**
 * Reconciliation — the frame.
 *
 * What the window looks like, and nothing else. What a press means is `shell.ts`,
 * every read is `model.ts`, and every judgement is `match.ts`; this file arranges four
 * regions around a grid and hands each of them what the shell already worked out.
 *
 * The layout is the exercise itself. The rail asks the three questions in order —
 * which bank, which statement, which side of it — the grid is that statement, and the
 * pane on the right is the argument for the one row selected in it. The difference
 * sits in the status bar, where a number somebody checks a dozen times an hour
 * belongs.
 *
 * Nothing here confirms anything. Both commands carry `ledger.post`, so the kernel
 * raises its own consent, and the datasets refetch themselves when the broker
 * invalidates them.
 */
import { type MouseEvent, useCallback } from 'react';
import {
  AppFrame,
  type AppEntryProps,
  type AppLocale,
  fmt,
  useAppCommands,
  useContextMenu,
  useWindowTitle,
} from '@/platform/sdk';
import {
  accountLabel,
  type BankAccount,
  type BankStatement,
  type BankTransaction,
  type Currency,
} from '../shared/ledger';
import { hotkey, type ReconcileBusy } from './actions';
import { LineMenu, ReconcileRail, ReconcileStatus, ReconcileToolbar } from './chrome';
import { MatchPane } from './detail';
import { SweepDialog } from './dialogs';
import { LedgerGrid, StatementGrid } from './list';
import type { Candidate } from './match';
import type { ReconcileModel, ReconcileView } from './model';
import { useReconcileShell } from './shell';

/**
 * The window's title: the bank, the statement, and what is left.
 *
 * The count is there for the reason a mail client puts one there — the taskbar is
 * where somebody looks while the window is behind something else, and "7" is the
 * answer to the only question they have.
 */
function windowTitle(
  account: BankAccount | null,
  statement: BankStatement | null,
  open: number,
  locale: AppLocale,
): string {
  const name = locale.tr('المطابقة البنكية', 'Rapprochement bancaire', 'Reconciliation');
  if (account === null) return name;
  const date =
    statement === null ? locale.tr('لا كشف', 'Aucun relevé', 'no statement') : fmt.date(statement.date, locale.lang);
  const head = `${name} — ${account.name} · ${date}`;
  return open === 0 ? head : `${head} (${fmt.integer(open, locale.lang)})`;
}

/* ------------------------------------------------------------------ *
 * The two panes that depend on the view
 * ------------------------------------------------------------------ */

interface BodyProps {
  readonly model: ReconcileModel;
  readonly view: ReconcileView;
  readonly currency: Currency;
  readonly planned: ReadonlySet<string>;
  readonly filtered: boolean;
  counterpartOf: (row: BankTransaction) => string;
  onSelect: (row: BankTransaction | null) => void;
  onMenu: (row: BankTransaction, event: MouseEvent) => void;
  onOpenLine: (accountId: string) => void;
}

/**
 * Which grid is the window.
 *
 * The ledger view is not a filter on the statement — it is the other book. Reusing one
 * grid for both would mean a column set that fits neither.
 */
function ReconcileBody({
  model,
  view,
  currency,
  planned,
  filtered,
  counterpartOf,
  onSelect,
  onMenu,
  onOpenLine,
}: BodyProps) {
  if (view === 'ledger') {
    return (
      <LedgerGrid
        rows={model.visibleLedger}
        loading={model.ledgerLoading && model.ledgerRows.length === 0}
        currency={currency}
        accountName={model.ledgerAccount === null ? '' : accountLabel(model.ledgerAccount)}
        filtered={filtered}
        onActivate={(row) => {
          const accountId = row.line.accountId;
          if (accountId !== null) onOpenLine(accountId);
        }}
      />
    );
  }
  return (
    <StatementGrid
      view={view}
      rows={model.visible}
      loading={model.loading && model.transactions.length === 0}
      currency={currency}
      amounts={model.amounts}
      planned={planned}
      selectedId={model.selected?.id ?? null}
      counterpartOf={counterpartOf}
      onSelect={onSelect}
      // Double-click is "show me the argument", which is where the pane already is.
      onActivate={onSelect}
      onContextMenu={onMenu}
      filtered={filtered}
      hasStatement={model.statement !== null}
    />
  );
}

interface AsideProps {
  readonly model: ReconcileModel;
  readonly currency: Currency;
  readonly candidateId: string | null;
  readonly busy: ReconcileBusy;
  onPick: (lineId: string) => void;
  onMatch: (candidate: Candidate) => void;
  onUnmatch: () => void;
  onOpenAccount: (accountId: string) => void;
  onCommand: (id: string) => void;
}

/** The right-hand argument: the model's pieces, spread out for the pane. */
function ReconcileAside({
  model,
  currency,
  candidateId,
  busy,
  onPick,
  onMatch,
  onUnmatch,
  onOpenAccount,
  onCommand,
}: AsideProps) {
  return (
    <MatchPane
      transaction={model.selected}
      candidates={model.candidates}
      counterpart={model.counterpart}
      account={model.account}
      statement={model.statement}
      summary={model.summary}
      ledgerRows={model.ledgerRows}
      currency={currency}
      candidateId={candidateId}
      busy={busy}
      ledgerLoading={model.ledgerLoading}
      planCount={model.plan.length}
      onPick={onPick}
      onMatch={onMatch}
      onUnmatch={onUnmatch}
      onOpenAccount={onOpenAccount}
      onCommand={onCommand}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

export default function ReconcileApp({ runtime }: AppEntryProps) {
  const shell = useReconcileShell();
  const { model, perform, pickLine } = shell;
  const menu = useContextMenu<BankTransaction>();

  // Toolbar, accelerators, jump list and command palette are one path in.
  useAppCommands(shell.command);

  /** The row menu acts on the row it names, which is not always the selected one. */
  const onMenuSelect = useCallback(
    (id: string) => {
      const target = menu.menu?.target ?? null;
      menu.close();
      if (target !== null) perform(id, target);
    },
    [menu, perform],
  );

  const onMenu = useCallback(
    (row: BankTransaction, event: MouseEvent) => {
      pickLine(row);
      menu.open(event, row);
    },
    [menu, pickLine],
  );

  useWindowTitle(windowTitle(model.account, model.statement, model.summary.open, runtime.locale));

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(event) => {
        // The report dialog owns the keyboard while it is open.
        if (shell.report !== null) return;
        const id = hotkey(event);
        if (id === null) return;
        event.preventDefault();
        shell.command(id);
      }}
    >
      <AppFrame
        scroll={false}
        navWidth={240}
        asideWidth={352}
        commands={
          <ReconcileToolbar
            view={shell.view}
            search={shell.search}
            onSearch={shell.setSearch}
            searchRef={shell.searchRef}
            onCommand={shell.command}
            busy={shell.busy}
            loading={model.loading}
            canMatch={shell.canMatch}
            canUnmatch={shell.canUnmatch}
            canExport={model.transactions.length > 0}
            planCount={model.plan.length}
          />
        }
        nav={
          <ReconcileRail
            accounts={model.accounts}
            account={model.account}
            statements={model.statements}
            statement={model.statement}
            view={shell.view}
            summary={model.summary}
            ledgerRows={model.ledgerRows}
            onAccount={shell.pickAccount}
            onStatement={shell.pickStatement}
            onView={shell.changeView}
          />
        }
        aside={
          <ReconcileAside
            model={model}
            currency={shell.currency}
            candidateId={shell.candidateId}
            busy={shell.busy}
            onPick={shell.pickCandidate}
            onMatch={shell.matchWith}
            onUnmatch={shell.unmatchSelected}
            onOpenAccount={shell.openAccount}
            onCommand={shell.command}
          />
        }
        status={
          <ReconcileStatus
            shown={shell.view === 'ledger' ? model.visibleLedger.length : model.visible.length}
            summary={model.summary}
            ledgerRows={model.ledgerRows}
            currency={shell.currency}
            truncated={model.truncated}
            error={model.error}
            fetchedAt={model.fetchedAt}
          />
        }
      >
        <ReconcileBody
          model={model}
          view={shell.view}
          currency={shell.currency}
          planned={shell.planned}
          filtered={shell.filtered}
          counterpartOf={shell.counterpartOf}
          onSelect={pickLine}
          onMenu={onMenu}
          onOpenLine={shell.openAccount}
        />
      </AppFrame>

      {menu.menu === null ? null : (
        <LineMenu
          x={menu.menu.x}
          y={menu.menu.y}
          transaction={menu.menu.target}
          canMatch={menu.menu.target.state === 'unmatched'}
          canUnmatch={menu.menu.target.state === 'matched' && !shell.locked}
          onSelect={onMenuSelect}
          onDismiss={menu.close}
        />
      )}

      <SweepDialog report={shell.report} onClose={shell.dismissReport} />
    </div>
  );
}
