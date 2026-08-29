/**
 * Treasury — the table.
 *
 * One grid, three lenses, and the columns follow the lens rather than the other way
 * round: a bank account has a book side and no due date, a bill has a due date and no
 * book side, and a grid that showed all of both would be two thirds empty on every row.
 *
 * **Nothing here sorts by column.** The ranking is part of the question the rail asks,
 * and the grid prints rows in the order the model ranked them. A click on the amount
 * header that re-sorted the list without touching the rail would leave the window saying
 * two different things about what matters most.
 *
 * The second amount column — the dinar restatement — appears only when the lens actually
 * holds more than one currency. A column of numbers identical to the one beside it is a
 * column that teaches a reader to ignore both, and the day it stops being identical is
 * the day that habit costs them.
 *
 * Colour is spent twice: on a row whose two sides disagree by more than a rounding, and
 * on a row that is late. Not on an amount, not on a currency — a large bill and a small
 * one are both bills, and a grid that paints the large one red has made a judgement the
 * arithmetic did not.
 */
import type { MouseEvent } from 'react';
import { Filter, Wallet } from 'lucide-react';
import {
  Badge,
  type Column,
  DataGrid,
  EmptyState,
  fmt,
  type Localized,
  type Tone,
  useLocale,
} from '@/platform/sdk';
import {
  BUCKET_LABEL,
  bucketTone,
  type CashRow,
  type Lens,
  LENS_UNIT,
  NOTE_LABEL,
} from './cash';
import { REPORTING } from './rates';

/**
 * Two rows wear a colour, and both of them are questions somebody has to answer today.
 *
 * A row the model already called `danger` is a bank balance that disagrees with the book
 * by more than two percent of itself. A row past its due date is late whatever its status
 * column says. Everything else — including a balance that agrees — is left plain, because
 * a grid where most rows are painted is a grid where none of them are.
 */
const rowTone = (row: CashRow): Tone | undefined => {
  if (row.tone === 'danger') return 'danger';
  if (row.bucket === 'overdue') return 'warning';
  return undefined;
};
/**
 * Nothing to show, in the words of whichever reason there was nothing.
 *
 * An empty book and an over-narrow find box are the same empty grid and two completely
 * different problems, and only one of them is fixed by typing less. The horizon is named
 * in the filtered case because it is the filter a reader forgets they set.
 */
function NothingHere({ lens, filtered }: { readonly lens: Lens; readonly filtered: boolean }) {
  const { t, tr } = useLocale();
  if (filtered) {
    return (
      <EmptyState
        icon={Filter}
        title={tr('لا شيء يطابق', 'Aucune correspondance', 'Nothing matches')}
        description={tr(
          'كل السطور مُخفية بالبحث أو بالأفق. الأرقام في الشريط لا تزال تحتسبها.',
          'Toutes les lignes sont masquées par la recherche ou l’horizon. Les nombres du volet les comptent encore.',
          'Every row is hidden by the find box or the horizon. The figures in the rail still count them.',
        )}
      />
    );
  }
  return (
    <EmptyState
      icon={Wallet}
      title={tr('لا شيء هنا', 'Rien ici', 'Nothing here')}
      description={tr(
        `لا ${t(LENS_UNIT[lens])} في متناول هذه النافذة.`,
        `Aucune donnée de type « ${t(LENS_UNIT[lens])} » n’est à la portée de cette fenêtre.`,
        `No ${t(LENS_UNIT[lens])} are within this window's reach.`,
      )}
    />
  );
}

/**
 * What the row is, over what identifies it further.
 *
 * The detail line is where each lens admits its naming problem: a bank account carries its
 * institution, a bill the note somebody typed because nothing exposed to an app names a
 * supplier, and an invoice the stem of its booking id.
 */
function RowCell({ row }: { readonly row: CashRow }) {
  return (
    <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
      <span className="fx-title-ellipsis" style={{ fontWeight: 600 }}>
        {row.title}
      </span>
      {row.detail === '' ? null : (
        <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
          {row.detail}
        </span>
      )}
    </div>
  );
}
/** An amount in the currency it is actually held in, which is what its statement says. */
function Money({
  value,
  currency,
  strong = false,
}: {
  readonly value: number;
  readonly currency: 'DZD' | 'SAR';
  readonly strong?: boolean;
}) {
  const { lang } = useLocale();
  return <span style={{ fontWeight: strong ? 600 : 400 }}>{fmt.money(value, currency, lang)}</span>;
}

/**
 * A figure that needed a rate, or the admission that none was on record.
 *
 * The dash is not a zero and is not styled like one: a riyal balance nobody has priced is
 * money the agency holds, and printing it as nothing in the dinar column would understate
 * the position by exactly its own size.
 */
function Dinars({ value }: { readonly value: number | null }) {
  const { lang } = useLocale();
  if (value === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  return <span>{fmt.money(value, REPORTING, lang)}</span>;
}

/** A gap, or nothing at all where there is no book side to take one from. */
function Gap({ row }: { readonly row: CashRow }) {
  const { lang } = useLocale();
  const gap = row.position?.gap ?? null;
  if (gap === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  return (
    <span style={{ color: row.tone === 'danger' ? 'var(--fx-danger)' : undefined }}>
      {fmt.money(gap, row.currency, lang)}
    </span>
  );
}

/** Days to the due date, negative once it has passed. The sign is the whole message. */
function Age({ row }: { readonly row: CashRow }) {
  const { lang } = useLocale();
  if (row.days === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  const days = fmt.integer(Math.abs(row.days), lang);
  return (
    <span style={{ color: row.days < 0 ? 'var(--fx-danger)' : undefined }}>
      {row.days < 0 ? `−${days}` : days}
    </span>
  );
}

/**
 * A date, or the admission there isn't one.
 *
 * A bill with no due date is not due today and is not due never — it is a bill somebody
 * entered in a hurry, and the dash says so where a fabricated date would not.
 */
function When({ row }: { readonly row: CashRow }) {
  const { lang } = useLocale();
  if (row.date === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  return <span>{fmt.date(row.date, lang)}</span>;
}

/**
 * The ledger's side of the same account.
 *
 * Two dashes that mean different things, and the pane spells out which: an account that
 * names no ledger account has nothing to compare against by design, while one that names
 * an account the trial balance did not return has a mapping pointing at nothing.
 */
function Book({ row }: { readonly row: CashRow }) {
  const { lang } = useLocale();
  const book = row.position?.book ?? null;
  if (book === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  return <span>{fmt.money(book, row.currency, lang)}</span>;
}

/**
 * Where the row falls against the horizon, as the badge its tone already means.
 *
 * The bucket rather than the status, because these are not the same claim: a status is
 * what somebody last set on a document, and a bucket is what its date says today. When
 * the two disagree the row carries a note saying so, and the bucket is the one to trust.
 */
function Timing({ row }: { readonly row: CashRow }) {
  const { t } = useLocale();
  if (row.bucket === null) return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
  return <Badge tone={bucketTone(row.bucket)}>{t(BUCKET_LABEL[row.bucket])}</Badge>;
}

/** The document's own status, in the tone the source module gives it. */
function Status({ row }: { readonly row: CashRow }) {
  const { t } = useLocale();
  return <Badge tone={row.tone}>{t(row.badge)}</Badge>;
}

/**
 * The reason the row is not quite what it looks like, in three words.
 *
 * The label only — the sentence behind it is in the pane, and a paragraph per row is a
 * paragraph nobody reads. It is set in the tertiary colour on purpose: a note is a
 * qualification of the figures beside it, not a finding of its own.
 */
function Note({ row }: { readonly row: CashRow }) {
  const { t } = useLocale();
  if (row.note === null) return null;
  return (
    <span className="fx-title-ellipsis" style={{ color: 'var(--fx-text-tertiary)' }}>
      {t(NOTE_LABEL[row.note])}
    </span>
  );
}

interface ListProps {
  readonly rows: readonly CashRow[];
  readonly lens: Lens;
  /** The grid is empty because the find box or the horizon emptied it, not the book. */
  readonly filtered: boolean;
  /** The lens holds more than one currency, so the dinar restatement earns a column. */
  readonly mixed: boolean;
  readonly selectedKey: string | null;
  readonly loading: boolean;
  onSelect: (key: string | null) => void;
  onActivate: (row: CashRow) => void;
  onContext: (row: CashRow, event: MouseEvent) => void;
}

/**
 * What the first column is called, which is not the same word in all three lenses.
 *
 * Singular, because a header names the thing one row is. The rail's counts are plural and
 * use {@link LENS_UNIT} instead — the two are the same subject counted two ways.
 */
const SUBJECT: Readonly<Record<Lens, Localized>> = {
  cash: { ar: 'الحساب', fr: 'Compte', en: 'Account' },
  payable: { ar: 'فاتورة المورّد', fr: 'Facture fournisseur', en: 'Supplier bill' },
  receivable: { ar: 'فاتورة العميل', fr: 'Facture client', en: 'Customer invoice' },
};

/**
 * What the amount column is called, and the three names are three different figures.
 *
 * A bank balance is money that is there. An outstanding bill is money that will leave.
 * An expected receipt is money somebody has promised. Calling all three "amount" would
 * invite a reader to add them, and the sum of those three numbers means nothing at all.
 */
const AMOUNT: Readonly<Record<Lens, Localized>> = {
  cash: { ar: 'رصيد البنك', fr: 'Solde bancaire', en: 'Bank balance' },
  payable: { ar: 'المتبقّي', fr: 'Restant dû', en: 'Outstanding' },
  receivable: { ar: 'المنتظر', fr: 'Attendu', en: 'Expected' },
};

/**
 * The grid, with the columns the lens can actually fill.
 *
 * Three column groups are conditional and each is conditional on something true rather
 * than on taste: the dinar restatement on the lens holding two currencies, the book side
 * on the lens that has one, and the whole timing group on a lens whose rows have dates.
 * A bank balance with a due date column would be a column of dashes, and a reader who
 * learns to skip a column of dashes will skip it on the day one of them is filled.
 */
export function TreasuryList(props: ListProps) {
  const { t, tr } = useLocale();
  const cash = props.lens === 'cash';

  /** Only when the lens holds both currencies; otherwise it repeats the column beside it. */
  const restated: readonly Column<CashRow>[] = props.mixed
    ? [
        {
          id: 'reported',
          header: tr('بالدينار', 'En dinars', 'In dinars'),
          width: 150,
          align: 'end',
          mono: true,
          title: tr(
            'المبلغ نفسه بالدينار، حسب السعر المُعلَن في الشريط.',
            'Le même montant en dinars, au taux annoncé dans le volet.',
            'The same amount in dinars, at the rate named in the rail.',
          ),
          render: (row) => <Dinars value={row.reported} />,
        },
      ]
    : [];

  /** The comparison the cash lens exists for, and nothing else has a book side. */
  const bookSide: readonly Column<CashRow>[] = cash
    ? [
        {
          id: 'book',
          header: tr('الدفتر', 'Grand livre', 'Book'),
          width: 150,
          align: 'end',
          mono: true,
          render: (row) => <Book row={row} />,
        },
        {
          id: 'gap',
          header: tr('الفارق', 'Écart', 'Gap'),
          width: 140,
          align: 'end',
          mono: true,
          title: tr(
            'رصيد البنك ناقص الدفتر. الفارق سؤال لا خطأ.',
            'Solde bancaire moins grand livre. Un écart est une question, pas une erreur.',
            'Bank balance less the book. A gap is a question, not an error.',
          ),
          render: (row) => <Gap row={row} />,
        },
      ]
    : [];

  /**
   * A date column either way, and the two are not the same date.
   *
   * On the flow lenses it is the due date, so the bucket and the day count earn their
   * place beside it. On the cash lens the only date a balance has is the day the last
   * statement it was read from covers, which is a fact about the reading rather than
   * about the money — one column, no bucket, no countdown.
   */
  const timing: readonly Column<CashRow>[] = cash
    ? [
        {
          id: 'statement',
          header: tr('آخر كشف', 'Dernier relevé', 'Last statement'),
          width: 130,
          title: tr(
            'تاريخ آخر كشف محمَّل لهذا الحساب، لا تاريخ الرصيد نفسه.',
            'Date du dernier relevé chargé pour ce compte, et non celle du solde lui-même.',
            "The last statement loaded for this account, not the balance's own date.",
          ),
          render: (row) => <When row={row} />,
        },
      ]
    : [
        {
          id: 'due',
          header: tr('الاستحقاق', 'Échéance', 'Due'),
          width: 130,
          render: (row) => <When row={row} />,
        },
        {
          id: 'bucket',
          header: tr('التوقيت', 'Calendrier', 'Timing'),
          width: 130,
          render: (row) => <Timing row={row} />,
        },
        {
          id: 'days',
          header: tr('الأيام', 'Jours', 'Days'),
          width: 90,
          align: 'end',
          mono: true,
          render: (row) => <Age row={row} />,
        },
      ];

  const columns: readonly Column<CashRow>[] = [
    {
      id: 'row',
      header: t(SUBJECT[props.lens]),
      render: (row) => <RowCell row={row} />,
    },
    {
      id: 'amount',
      header: t(AMOUNT[props.lens]),
      width: 160,
      align: 'end',
      mono: true,
      render: (row) => <Money value={row.amount} currency={row.currency} strong />,
    },
    ...restated,
    ...bookSide,
    ...timing,
    {
      id: 'status',
      header: tr('الحالة', 'État', 'Status'),
      width: 140,
      render: (row) => <Status row={row} />,
    },
    {
      id: 'note',
      header: tr('ملاحظة', 'Remarque', 'Note'),
      width: 170,
      render: (row) => <Note row={row} />,
    },
  ];

  return (
    <DataGrid
      rows={props.rows}
      columns={columns}
      rowKey={(row) => row.key}
      density="compact"
      virtualized
      loading={props.loading}
      rowTone={rowTone}
      selectedKeys={props.selectedKey === null ? undefined : new Set([props.selectedKey])}
      onSelectionChange={(keys) => {
        const [key] = [...keys];
        props.onSelect(key ?? null);
      }}
      onActivate={props.onActivate}
      onRowContextMenu={props.onContext}
      empty={<NothingHere lens={props.lens} filtered={props.filtered} />}
    />
  );
}





