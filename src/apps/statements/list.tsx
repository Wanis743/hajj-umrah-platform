/**
 * Statements — the sheet and the trial-balance register.
 *
 * The income statement and the balance sheet share one renderer, because they are the same
 * shape: a heading, the accounts under it, the line those accounts add to, and at the foot
 * the one figure the exercise exists to produce. Both are printed on a page — paper width,
 * centred, with a running header — because their final form is a printed page and a
 * statement laid out edge to edge in a window cannot be checked against the copy in the
 * binder. The trial balance gets a grid instead: it is the only statement with two columns
 * per row and no structure at all, which is to say it is a register and not a statement.
 *
 * **Nothing here sorts.** A statement's row order *is* its meaning — a subtotal that has
 * floated three rows up from the accounts it closes is a subtotal of nothing, and the trial
 * balance's grand total belongs at the bottom rather than wherever its debit column happens
 * to rank. Sorting lives in the registers, where a row is a row.
 *
 * Structure is carried by indentation and weight, which is how a printed statement carries
 * it. Colour is spent on one row only: a check line that does not come out at zero. Not on
 * losses, not on variances — an expense that grew and a revenue that grew are both positive
 * numbers, and a sheet that paints one of them red has picked a side the arithmetic did not.
 */
import { type CSSProperties, type MouseEvent } from 'react';
import { Scale, Table2 } from 'lucide-react';
import {
  type Column,
  DataGrid,
  DocumentPage,
  EmptyState,
  Spinner,
  fmt,
  toneColor,
  useLocale,
} from '@/platform/sdk';
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
  /** The account the pane is describing, which may be filtered out of the sheet. */
  readonly selectedId: string | null;
  /** A comparison was asked for, so the sheet carries two money columns and a change. */
  readonly comparing: boolean;
  readonly loading: boolean;
  /** Printed in the running header: which statement, over what period, on what basis. */
  readonly title: string;
  readonly period: string;
  readonly footnote?: string;
  onSelect: (accountId: string | null) => void;
  onActivate: (row: StatementRow) => void;
  onContext: (row: StatementRow, event: MouseEvent) => void;
}

/** The cell geometry, declared once so the head, the body and the rule agree. */
const CELL: CSSProperties = { padding: '3px 0', fontSize: 'var(--fx-body)', verticalAlign: 'baseline' };
const NUM: CSSProperties = { ...CELL, textAlign: 'end', width: 150, whiteSpace: 'nowrap', paddingInlineStart: 16 };
const HEAD: CSSProperties = {
  padding: '0 0 6px',
  fontSize: 'var(--fx-caption)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fx-text-tertiary)',
  borderBottom: '1px solid var(--fx-divider)',
};

/**
 * The income statement and the balance sheet, on a sheet of paper.
 *
 * These are the one output in the suite whose final form is a printed page. A
 * statement laid out edge to edge in a resizable window is a statement nobody can
 * check against the copy in the binder: the line breaks are different, the columns
 * are somewhere else, and the eye has to re-find every figure. So the column is
 * fixed at paper width on a desk surface, with the margins and the running header
 * the print will have.
 *
 * It is a real `<table>` with column headers and `scope`, which is what the grid
 * could not be. A statement's rows are not peers — a heading, the accounts under
 * it, the line those accounts add to — and the one instrument that can say so to a
 * screen reader is markup. `DataGrid` is right for ten thousand rows of anything;
 * this is sixty rows of something with a shape.
 *
 * **Nothing here sorts.** A statement's row order *is* its meaning: a subtotal that
 * has floated three rows up from the accounts it closes is a subtotal of nothing.
 * Structure is carried by indentation and weight, which is how a printed statement
 * carries it, and colour is spent on one row only — a check line that does not come
 * out at zero.
 */
export function StatementList(props: StatementListProps) {
  const { rows, selectedId, comparing } = props;
  const { tr } = useLocale();
  // Resolved against every row rather than remembered as a key, because the account the pane
  // describes can be hidden by the search box while still being the selected one.
  const selectedRow = selectedId === null ? undefined : rows.find((row) => row.figure?.accountId === selectedId);

  if (props.loading && rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  if (rows.length === 0) return <NothingHere basis={props.basis} />;

  return (
    <DocumentPage
      label={props.title}
      header={
        <>
          <span style={{ fontWeight: 600, color: 'var(--fx-text-primary)' }}>{props.title}</span>
          <span style={{ marginInlineStart: 'auto' }}>{props.period}</span>
        </>
      }
      footer={props.footnote === undefined ? undefined : <span>{props.footnote}</span>}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...HEAD, textAlign: 'start' }}>
              {tr('السطر', 'Ligne', 'Line')}
            </th>
            <th scope="col" style={{ ...HEAD, textAlign: 'end', paddingInlineStart: 16 }}>
              {tr('المبلغ', 'Montant', 'Amount')}
            </th>
            {comparing ? (
              <>
                <th scope="col" style={{ ...HEAD, textAlign: 'end', paddingInlineStart: 16 }}>
                  {tr('المقارنة', 'Comparaison', 'Prior')}
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'end', paddingInlineStart: 16 }}>
                  {tr('الفرق', 'Écart', 'Change')}
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = rowTone(row);
            const held = selectedRow !== undefined && row.id === selectedRow.id;
            return (
              <tr
                key={row.id}
                aria-selected={held}
                onClick={() => props.onSelect(row.figure?.accountId ?? null)}
                onDoubleClick={() => props.onActivate(row)}
                onContextMenu={(event) => props.onContext(row, event)}
                style={{
                  background: held ? 'var(--fx-control)' : undefined,
                  color: tone === undefined ? undefined : toneColor(tone),
                  cursor: row.figure === null ? 'default' : 'pointer',
                  // A closing line is ruled above, the way it is on paper.
                  borderTop: row.kind === 'total' ? '1px solid var(--fx-divider)' : undefined,
                }}
              >
                <th scope="row" style={{ ...CELL, textAlign: 'start', fontWeight: 400 }}>
                  <RowName row={row} />
                </th>
                <td className="fx-mono" style={NUM}>
                  <Figure row={row} value={row.amount} />
                </td>
                {comparing ? (
                  <>
                    <td className="fx-mono" style={NUM}>
                      <Figure row={row} value={row.prior} />
                    </td>
                    <td className="fx-mono" style={NUM}>
                      <Figure row={row} value={moved(row)} />
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </DocumentPage>
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
