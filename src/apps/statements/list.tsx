/**
 * Statements — the two grids.
 *
 * The income statement and the balance sheet share one grid, because they are the same shape:
 * a heading, the accounts under it, the line those accounts add to, and at the foot the one
 * figure the exercise exists to produce. The trial balance gets its own, because it is the
 * only statement with two columns per row and no structure at all.
 *
 * **Nothing here sorts.** A statement's row order *is* its meaning — a subtotal that has
 * floated three rows up from the accounts it closes is a subtotal of nothing, and the trial
 * balance's grand total belongs at the bottom rather than wherever its debit column happens
 * to rank. Sorting lives in the registers, where a row is a row.
 *
 * Structure is carried by indentation and weight, which is how a printed statement carries
 * it. Colour is spent on one row only: a check line that does not come out at zero. Not on
 * losses, not on variances — an expense that grew and a revenue that grew are both positive
 * numbers, and a grid that paints one of them red has picked a side the arithmetic did not.
 */
import type { MouseEvent } from 'react';
import { Scale, Table2 } from 'lucide-react';
import { type Column, DataGrid, EmptyState, fmt, useLocale } from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL } from '../shared/ledger';
import type { Basis } from './balances';
import { rowLabel, type StatementRow } from './statement';

/** The one coloured row: a check that did not come out at zero. */
const rowTone = (row: StatementRow) =>
  row.kind === 'check' && Math.abs(row.amount) >= 0.005 ? 'danger' : undefined;

/** How a comparison column moved. Printed, never coloured: the sign has no side. */
const moved = (row: StatementRow): number | null => (row.prior === null ? null : row.amount - row.prior);

/** Nothing to print, said in the words of whichever basis came back empty. */
function NothingHere({ basis }: { readonly basis: Basis }) {
  const { tr } = useLocale();
  return (
    <EmptyState
      icon={Scale}
      title={tr('لا شيء يُعرَض', 'Rien à présenter', 'Nothing to state')}
      description={
        basis === 'book'
          ? tr(
              'لا قيد مُرحَّل في الدفتر بعد.',
              'Aucune écriture comptabilisée dans le livre.',
              'Nothing is posted in the book yet.',
            )
          : tr(
              'لا حساب في دليل الحسابات.',
              'Aucun compte dans le plan comptable.',
              'The chart of accounts is empty.',
            )
      }
    />
  );
}
/**
 * One row's name, indented and weighted by what the row is.
 *
 * A section heading is set in small capitals and carries no figure; the line that closes it
 * is set bold one indent in. A check line is italic, because it is not a figure the business
 * produced — it is this window asking the book a question.
 */
function RowName({ row }: { readonly row: StatementRow }) {
  const { t } = useLocale();
  const heading = row.kind === 'section';
  const closing = row.kind === 'total';
  return (
    <span
      className={row.figure === null ? undefined : 'fx-title-ellipsis'}
      style={{
        color: heading ? 'var(--fx-text-secondary)' : undefined,
        fontStyle: row.kind === 'check' ? 'italic' : undefined,
        fontSize: heading ? 'var(--fx-caption)' : undefined,
        fontWeight: heading || closing ? 700 : row.kind === 'subtotal' || row.kind === 'check' ? 600 : 400,
        letterSpacing: heading ? '0.04em' : undefined,
        paddingInlineStart: row.depth * 18,
        textTransform: heading ? 'uppercase' : undefined,
      }}
    >
      {rowLabel(row, t)}
    </span>
  );
}

/** A figure, weighted like the row it sits on. Section headings print nothing at all. */
function Figure({ row, value }: { readonly row: StatementRow; readonly value: number | null }) {
  const { lang } = useLocale();
  if (row.kind === 'section' || value === null) {
    return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  }
  const closing = row.kind !== 'account';
  return (
    <span style={{ fontWeight: closing ? 600 : 400 }}>{fmt.money(value, 'DZD', lang)}</span>
  );
}
/* ------------------------------------------------------------------ *
 * The income statement and the balance sheet
 * ------------------------------------------------------------------ */

interface StatementListProps {
  readonly rows: readonly StatementRow[];
  readonly basis: Basis;
  /** The account the pane is describing, which may be filtered out of the grid. */
  readonly selectedId: string | null;
  /** A comparison was asked for, so the last two columns mean something. */
  readonly comparing: boolean;
  readonly loading: boolean;
  onSelect: (accountId: string | null) => void;
  onActivate: (row: StatementRow) => void;
  onContext: (row: StatementRow, event: MouseEvent) => void;
}

export function StatementList(props: StatementListProps) {
  const { rows, selectedId } = props;
  const { tr } = useLocale();
  // The comparison pair is declared apart so one column order holds with a gap in it, rather
  // than two orders that drift the moment either is edited.
  const compared: readonly Column<StatementRow>[] = props.comparing
    ? [
        {
          id: 'prior',
          header: tr('المقارنة', 'Comparaison', 'Prior'),
          width: 170,
          align: 'end',
          mono: true,
          render: (row) => <Figure row={row} value={row.prior} />,
        },
        {
          id: 'variance',
          header: tr('الفرق', 'Écart', 'Variance'),
          width: 170,
          align: 'end',
          mono: true,
          render: (row) => <Figure row={row} value={moved(row)} />,
        },
      ]
    : [];
  const columns: readonly Column<StatementRow>[] = [
    {
      id: 'line',
      header: tr('السطر', 'Ligne', 'Line'),
      render: (row) => <RowName row={row} />,
    },
    {
      id: 'amount',
      header: tr('المبلغ', 'Montant', 'Amount'),
      width: 190,
      align: 'end',
      mono: true,
      render: (row) => <Figure row={row} value={row.amount} />,
    },
    ...compared,
  ];
  // Resolved against every row rather than remembered as a key, because the account the pane
  // describes can be hidden by the search box while still being the selected one.
  const selectedRow = selectedId === null ? undefined : rows.find((row) => row.figure?.accountId === selectedId);

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={props.loading}
      density="compact"
      virtualized
      selectedKeys={selectedRow === undefined ? undefined : new Set([selectedRow.id])}
      onSelectionChange={(keys) => {
        const [key] = [...keys];
        const row = key === undefined ? undefined : rows.find((item) => item.id === key);
        props.onSelect(row?.figure?.accountId ?? null);
      }}
      onActivate={props.onActivate}
      onRowContextMenu={props.onContext}
      rowTone={rowTone}
      empty={<NothingHere basis={props.basis} />}
    />
  );
}
/* ------------------------------------------------------------------ *
 * The trial balance
 * ------------------------------------------------------------------ *
 * Both sides of every account, and no structure to indent. The account cell carries its class
 * underneath its name, because this is the one statement where nothing else says whether a
 * row is an asset or a charge.
 *
 * The two closing rows print what they mean and nothing more: the grand total shows its two
 * sides and no balance, and the difference shows a balance and no sides. A cell with a number
 * in it is a cell somebody will check something against, and adding a debit-natured balance
 * to a credit-natured one produces a number that cannot be checked against anything.
 */

interface TrialListProps {
  readonly rows: readonly StatementRow[];
  readonly basis: Basis;
  readonly selectedId: string | null;
  readonly loading: boolean;
  onSelect: (accountId: string | null) => void;
  onActivate: (row: StatementRow) => void;
  onContext: (row: StatementRow, event: MouseEvent) => void;
}

/** An account over its class, or a closing row's own words. */
function TrialName({ row }: { readonly row: StatementRow }) {
  const { t } = useLocale();
  const figure = row.figure;
  if (figure === null) {
    return (
      <span style={{ fontStyle: row.kind === 'check' ? 'italic' : undefined, fontWeight: 700 }}>
        {rowLabel(row, t)}
      </span>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <span className="fx-title-ellipsis" style={{ fontWeight: 600 }}>
        {`${figure.code} · ${figure.name}`}
      </span>
      <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
        {t(ACCOUNT_TYPE_LABEL[figure.type])}
      </span>
    </div>
  );
}
export function TrialList(props: TrialListProps) {
  const { rows, selectedId } = props;
  const { tr, lang } = useLocale();
  const columns: readonly Column<StatementRow>[] = [
    {
      id: 'account',
      header: tr('الحساب', 'Compte', 'Account'),
      render: (row) => <TrialName row={row} />,
    },
    {
      id: 'debit',
      header: tr('مدين', 'Débit', 'Debit'),
      width: 168,
      align: 'end',
      mono: true,
      render: (row) => <Figure row={row} value={row.kind === 'check' ? null : row.debit} />,
    },
    {
      id: 'credit',
      header: tr('دائن', 'Crédit', 'Credit'),
      width: 168,
      align: 'end',
      mono: true,
      render: (row) => <Figure row={row} value={row.kind === 'check' ? null : row.credit} />,
    },
    {
      id: 'balance',
      header: tr('الرصيد', 'Solde', 'Balance'),
      width: 176,
      align: 'end',
      mono: true,
      render: (row) => <Figure row={row} value={row.kind === 'total' ? null : row.amount} />,
    },
    {
      id: 'postings',
      header: tr('قيود', 'Écritures', 'Postings'),
      width: 104,
      align: 'end',
      mono: true,
      render: (row) =>
        row.figure === null ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          fmt.integer(row.figure.lines, lang)
        ),
    },
  ];
  const selectedRow = selectedId === null ? undefined : rows.find((row) => row.figure?.accountId === selectedId);
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={props.loading}
      density="compact"
      virtualized
      selectedKeys={selectedRow === undefined ? undefined : new Set([selectedRow.id])}
      onSelectionChange={(keys) => {
        const [key] = [...keys];
        const row = key === undefined ? undefined : rows.find((item) => item.id === key);
        props.onSelect(row?.figure?.accountId ?? null);
      }}
      onActivate={props.onActivate}
      onRowContextMenu={props.onContext}
      rowTone={rowTone}
      empty={
        props.basis === 'book' ? (
          <NothingHere basis={props.basis} />
        ) : (
          <EmptyState
            icon={Table2}
            title={tr('لا حسابات', 'Aucun compte', 'No accounts')}
            description={tr(
              'دليل الحسابات فارغ، فلا ميزان يُراجع.',
              'Le plan comptable est vide : il n’y a pas de balance à établir.',
              'The chart of accounts is empty, so there is no balance to strike.',
            )}
          />
        )
      }
    />
  );
}
