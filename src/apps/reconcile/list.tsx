/**
 * Reconciliation — the two grids.
 *
 * Two, not one, because the two sides of the exercise are not the same kind of list.
 * A statement is a bank's record read forwards, with debit and credit in their own
 * columns the way a bank prints them; the ledger side is a book of postings, and what
 * matters about a posting here is whether it is still available to pair with.
 *
 * The statement grid's most useful column is the one the eye lands on last: how many
 * ledger lines carry this amount. Zero means the counterpart is not on this page and
 * no amount of clicking will produce it — an entry has to be booked, or the ledger
 * page is too short. Four means somebody has to choose, and that is a different
 * afternoon. The count comes from `amountIndex`, one pass over the ledger rather than
 * a ranked list per row.
 *
 * Rows the sweep would take are tinted, and nothing else is. A grid that colours
 * every open line has said nothing; a grid that colours the seven the machine is
 * about to handle has said exactly one thing.
 */
import { CircleSlash, Landmark } from 'lucide-react';
import { type MouseEvent, useMemo } from 'react';
import { Badge, type Column, DataGrid, EmptyState, fmt, toneColor, useApp } from '@/platform/sdk';
import {
  type BankTransaction,
  type Currency,
  MATCH_STATE_LABEL,
  matchTone,
} from '../shared/ledger';
import { type AmountIndex, candidateCount, isEligible, type LedgerRow } from './match';
import type { ReconcileView } from './model';

/** Two lines per row: a bank line has a reference under its description. */
const ROW_HEIGHT = 44;

const NO_SELECTION: ReadonlySet<string> = new Set<string>();

type Locale = ReturnType<typeof useApp>['locale'];

/* ------------------------------------------------------------------ *
 * Shared cells
 * ------------------------------------------------------------------ */

interface DetailCellProps {
  readonly title: string;
  readonly under: string;
}

/** What the line says, with its reference under it in the quieter ink. */
function DetailCell({ title, under }: DetailCellProps) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span className="fx-title-ellipsis">{title === '' ? '—' : title}</span>
      <span className="fx-mono fx-title-ellipsis" style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>
        {under === '' ? '—' : under}
      </span>
    </span>
  );
}

/**
 * One side of the money, blank on the other side.
 *
 * A bank statement puts debits and credits in separate columns, and so does this: a
 * single signed column reads faster to a programmer and slower to everybody who
 * reconciles bank statements for a living.
 */
function sideColumn<T extends { readonly kind: 'debit' | 'credit'; readonly amount: number }>(
  id: 'debit' | 'credit',
  header: string,
  currency: Currency,
  locale: Locale,
): Column<T> {
  return {
    id,
    header,
    width: 128,
    align: 'end',
    mono: true,
    render: (row) => (row.kind === id ? fmt.money(row.amount, currency, locale.lang) : '—'),
    sort: (a, b) => (a.kind === id ? a.amount : 0) - (b.kind === id ? b.amount : 0),
  };
}

/* ------------------------------------------------------------------ *
 * The statement
 * ------------------------------------------------------------------ */

interface HintCellProps {
  readonly count: number;
  readonly locale: Locale;
}

/**
 * How many ledger lines could legally take this one.
 *
 * Zero is the interesting number and gets the warning ink: the counterpart is not on
 * this page, so this is a missing entry or a page too short — either way, not a
 * clicking problem. One is the quiet good case. More than one is a choice, stated
 * plainly rather than resolved silently.
 */
function HintCell({ count, locale }: HintCellProps) {
  const tone = count === 0 ? 'warning' : count === 1 ? 'success' : 'accent';
  return (
    <span className="fx-num" style={{ color: toneColor(tone) }} title={locale.tr(
      'أسطر دفتر معتمدة وغير مطابقة بنفس المبلغ (± سنتيم).',
      'Lignes comptabilisées, non rapprochées, du même montant (± 1 centime).',
      'Posted, unreconciled ledger lines of the same amount (± 1 centime).',
    )}>
      {count === 0 ? '—' : fmt.integer(count, locale.lang)}
    </span>
  );
}

function stateColumn(locale: Locale): Column<BankTransaction> {
  return {
    id: 'state',
    header: locale.tr('الحالة', 'État', 'State'),
    width: 116,
    render: (row) => <Badge tone={matchTone(row.state)}>{locale.t(MATCH_STATE_LABEL[row.state])}</Badge>,
    sort: (a, b) => a.state.localeCompare(b.state),
  };
}

/**
 * The columns of a statement, and the one that changes with the view.
 *
 * The open view needs to know what could pair; the matched view needs to know what
 * did. Neither wants the other's column, and a grid carrying both would carry a
 * column of dashes half the time.
 */
function statementColumns(
  view: ReconcileView,
  currency: Currency,
  amounts: AmountIndex,
  counterpartOf: (row: BankTransaction) => string,
  locale: Locale,
): readonly Column<BankTransaction>[] {
  const head: readonly Column<BankTransaction>[] = [
    {
      id: 'date',
      header: locale.tr('التاريخ', 'Date', 'Date'),
      width: 108,
      mono: true,
      render: (row) => fmt.date(row.date, locale.lang),
      sort: (a, b) => a.date.localeCompare(b.date),
    },
    {
      id: 'detail',
      header: locale.tr('البيان', 'Libellé', 'Detail'),
      render: (row) => <DetailCell title={row.description} under={row.reference} />,
      sort: (a, b) => a.description.localeCompare(b.description),
    },
  ];
  const money: readonly Column<BankTransaction>[] = [
    sideColumn<BankTransaction>('debit', locale.tr('مدين', 'Débit', 'Debit'), currency, locale),
    sideColumn<BankTransaction>('credit', locale.tr('دائن', 'Crédit', 'Credit'), currency, locale),
  ];
  if (view === 'matched') {
    return [
      ...head,
      ...money,
      {
        id: 'counterpart',
        header: locale.tr('المقابل', 'Contrepartie', 'Counterpart'),
        width: 188,
        render: (row) => (
          <span className="fx-mono fx-title-ellipsis" style={{ color: 'var(--fx-text-secondary)' }}>
            {counterpartOf(row)}
          </span>
        ),
        sort: (a, b) => counterpartOf(a).localeCompare(counterpartOf(b)),
      },
      stateColumn(locale),
    ];
  }
  return [
    ...head,
    ...money,
    {
      id: 'hint',
      header: locale.tr('مرشّحون', 'Candidats', 'Candidates'),
      width: 104,
      align: 'end',
      render: (row) => <HintCell count={candidateCount(amounts, row.amount)} locale={locale} />,
      sort: (a, b) => candidateCount(amounts, a.amount) - candidateCount(amounts, b.amount),
    },
    stateColumn(locale),
  ];
}

export interface StatementGridProps {
  readonly view: ReconcileView;
  readonly rows: readonly BankTransaction[];
  readonly loading: boolean;
  readonly currency: Currency;
  readonly amounts: AmountIndex;
  /** Line ids the sweep would take, tinted so the batch is visible before it runs. */
  readonly planned: ReadonlySet<string>;
  readonly selectedId: string | null;
  /** The ledger row a matched line points at, named for the counterpart column. */
  counterpartOf: (row: BankTransaction) => string;
  onSelect: (row: BankTransaction | null) => void;
  onActivate: (row: BankTransaction) => void;
  onContextMenu: (row: BankTransaction, event: MouseEvent) => void;
  /** True when the search box is narrowing the view, so "empty" can say which. */
  readonly filtered: boolean;
  readonly hasStatement: boolean;
}

export function StatementGrid({
  view,
  rows,
  loading,
  currency,
  amounts,
  planned,
  selectedId,
  counterpartOf,
  onSelect,
  onActivate,
  onContextMenu,
  filtered,
  hasStatement,
}: StatementGridProps) {
  const { locale } = useApp();
  const { tr } = locale;
  const columns = useMemo(
    () => statementColumns(view, currency, amounts, counterpartOf, locale),
    [view, currency, amounts, counterpartOf, locale],
  );
  const selection = useMemo(
    () => (selectedId === null ? NO_SELECTION : new Set([selectedId])),
    [selectedId],
  );

  return (
    <DataGrid<BankTransaction>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      selectedKeys={selection}
      onSelectionChange={(keys) => {
        for (const key of keys) {
          const found = rows.find((row) => row.id === key);
          if (found !== undefined) {
            onSelect(found);
            return;
          }
        }
        onSelect(null);
      }}
      onActivate={onActivate}
      onRowContextMenu={(row, event) => onContextMenu(row, event)}
      loading={loading}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      // The one thing worth colouring: what the machine is about to do on its own.
      rowTone={(row) => (planned.has(row.id) ? 'success' : undefined)}
      empty={
        <EmptyState
          icon={hasStatement ? undefined : Landmark}
          title={
            !hasStatement
              ? tr('لا كشف محدّد', 'Aucun relevé sélectionné', 'No statement selected')
              : filtered
                ? tr('لا نتائج للبحث', 'Aucun résultat', 'Nothing matches')
                : view === 'open'
                  ? tr('لا سطر معلّق', 'Rien en suspens', 'Nothing open')
                  : tr('لا سطر مطابق بعد', 'Rien de rapproché', 'Nothing matched yet')
          }
          description={
            !hasStatement
              ? tr(
                  'اختر بنكًا ثم كشفًا من الشريط الجانبي.',
                  'Choisissez une banque puis un relevé dans le volet.',
                  'Pick a bank, then one of its statements, in the rail.',
                )
              : filtered
                ? tr(
                    'وسّع البحث لعرض المزيد من الأسطر.',
                    'Élargissez la recherche pour voir plus de lignes.',
                    'Widen the search to see more lines.',
                  )
                : view === 'open'
                  ? tr(
                      'كل أسطر هذا الكشف حُسمت.',
                      'Chaque ligne de ce relevé est décidée.',
                      'Every line of this statement has been decided.',
                    )
                  : undefined
          }
        />
      }
      style={{ flex: 1, minHeight: 0 }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The ledger side
 * ------------------------------------------------------------------ */

/**
 * The mirrored account's postings.
 *
 * This view answers the other half of the question. A posted line nobody has
 * reconciled is money the book says moved and the bank has not confirmed — which by
 * the end of the month is either a cheque in the post or an entry booked to the wrong
 * account. Unposted and already-reconciled lines are shown too, greyed by their
 * badge, because their absence would read as a shorter ledger rather than as a filter.
 */
function ledgerColumns(currency: Currency, locale: Locale): readonly Column<LedgerRow>[] {
  return [
    {
      id: 'date',
      header: locale.tr('التاريخ', 'Date', 'Date'),
      width: 108,
      mono: true,
      render: (row) => (row.date === '' ? '—' : fmt.date(row.date, locale.lang)),
      sort: (a, b) => a.date.localeCompare(b.date),
    },
    {
      id: 'detail',
      header: locale.tr('البيان', 'Libellé', 'Detail'),
      render: (row) => <DetailCell title={row.line.memo} under={row.reference} />,
      sort: (a, b) => a.line.memo.localeCompare(b.line.memo),
    },
    sideColumn<LedgerRow>('debit', locale.tr('مدين', 'Débit', 'Debit'), currency, locale),
    sideColumn<LedgerRow>('credit', locale.tr('دائن', 'Crédit', 'Credit'), currency, locale),
    {
      id: 'state',
      header: locale.tr('الحالة', 'État', 'State'),
      width: 148,
      render: (row) =>
        !row.posted ? (
          <Badge tone="warning">{locale.tr('غير مرحّل', 'Non comptabilisée', 'Not posted')}</Badge>
        ) : row.line.reconciled ? (
          <Badge tone="neutral">{locale.tr('مطابق', 'Rapprochée', 'Reconciled')}</Badge>
        ) : (
          <Badge tone="accent">{locale.tr('متاح', 'Disponible', 'Available')}</Badge>
        ),
      sort: (a, b) => Number(isEligible(b)) - Number(isEligible(a)),
    },
  ];
}

export interface LedgerGridProps {
  readonly rows: readonly LedgerRow[];
  readonly loading: boolean;
  readonly currency: Currency;
  readonly accountName: string;
  readonly filtered: boolean;
  onActivate: (row: LedgerRow) => void;
}

export function LedgerGrid({ rows, loading, currency, accountName, filtered, onActivate }: LedgerGridProps) {
  const { locale } = useApp();
  const { tr } = locale;
  const columns = useMemo(() => ledgerColumns(currency, locale), [currency, locale]);

  return (
    <DataGrid<LedgerRow>
      rows={rows}
      columns={columns}
      rowKey={(row) => row.line.id}
      onActivate={onActivate}
      loading={loading}
      density="compact"
      rowHeight={ROW_HEIGHT}
      virtualized
      empty={
        <EmptyState
          icon={CircleSlash}
          title={
            accountName === ''
              ? tr('البنك لا يشير إلى حساب', 'La banque ne pointe aucun compte', 'This bank names no ledger account')
              : filtered
                ? tr('لا نتائج للبحث', 'Aucun résultat', 'Nothing matches')
                : tr('لا قيود على الحساب', 'Aucune écriture', 'No postings')
          }
          description={
            accountName === ''
              ? tr(
                  'اضبط الحساب المرآة على البنك ليصبح الرأس الآخر للمطابقة قابلًا للقراءة.',
                  'Renseignez le compte miroir de la banque pour que l’autre côté du rapprochement soit lisible.',
                  'Set the bank’s mirrored ledger account so the other side of the reconciliation can be read.',
                )
              : undefined
          }
        />
      }
      style={{ flex: 1, minHeight: 0 }}
    />
  );
}
