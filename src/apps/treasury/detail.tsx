/**
 * Treasury — the two panes.
 *
 * The position pane is the case for the figures in the rail: what was read, at what rate,
 * how much of the paper is counted at more than it will collect, and which of the numbers
 * is a floor rather than a fact. It is what the export writes into the file and what the
 * clipboard writes into a message, shown on screen so nobody has to export a report to
 * find out what it was about.
 *
 * The row pane is the same courtesy for one line, and which facts it prints depends on
 * what the row is. A bank account gets its two sides and the evidence they were read
 * from — the statement, the lines still unmatched — because a gap is a question and those
 * are the two places its answer lives. A bill gets what has been paid against it, an
 * invoice gets the rate it was raised at, which is not the rate this window reports in
 * and is the commonest reason two people disagree about the same invoice.
 *
 * A note prints here as the whole sentence and in the grid as three words. The grid has a
 * hundred rows and no room for a paragraph; the pane has one row and nothing better to do.
 */
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CircleHelp,
  ClipboardCopy,
  Coins,
  ExternalLink,
  FileDown,
  Gauge,
  Landmark,
  ListChecks,
  PiggyBank,
  Scale,
  Timer,
  Wallet,
} from 'lucide-react';
import {
  Button,
  Card,
  fmt,
  InfoBar,
  KpiTile,
  PropertyRow,
  Section,
  type Tone,
  useLocale,
} from '@/platform/sdk';
import type { Currency } from '../shared/ledger';
import type { TreasuryBusy } from './actions';
import {
  BUCKET_LABEL,
  bucketTone,
  type CashRow,
  type Forecast,
  gapTone,
  type Liquidity,
  LENS_LABEL,
  NOTE_LABEL,
  type NoteId,
  NOTE_REASON,
  type Position,
  runwayTone,
} from './cash';
import { REPORTING, reported } from './rates';
import { basisLine, type Provenance, rateLine } from './report';
import type { Bill, Invoice } from './sources';

/**
 * The four figures a treasurer asks for by name, in the order they are asked for.
 *
 * What is in the bank, what leaves, what should arrive, what that leaves at the end of the
 * horizon. The last one is the only one that is not a fact, and it is the only one that
 * carries a tone: a projection that goes negative is the whole point of the window, and a
 * projection merely smaller than this morning's balance is the thing to watch.
 */
function PositionTiles({ outlook }: { readonly outlook: Forecast }) {
  const { tr, lang } = useLocale();
  const cash = (value: number | null) =>
    value === null ? tr('غير قابل للتحديد', 'Indéterminable', 'Not statable') : fmt.money(value, REPORTING, lang);
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      <KpiTile
        label={tr('رصيد البنوك', 'Solde bancaire', 'Bank balance')}
        value={cash(outlook.opening)}
        icon={Banknote}
      />
      <KpiTile
        label={tr('يخرج', 'Sorties', 'Out')}
        value={cash(outlook.outgoing)}
        icon={ArrowUpRight}
        tone="warning"
      />
      <KpiTile
        label={tr('يدخل', 'Entrées', 'In')}
        value={cash(outlook.incoming)}
        icon={ArrowDownRight}
        tone="neutral"
      />
      <KpiTile
        label={tr('الرصيد المتوقَّع', 'Solde projeté', 'Projected balance')}
        value={cash(outlook.closing)}
        icon={PiggyBank}
        tone={runwayTone(outlook.closing, outlook.opening)}
      />
    </div>
  );
}

/**
 * The riyals nothing prices, which is the one gap that stops a total being a total.
 *
 * Danger rather than warning, because every cross-currency figure in the window is `null`
 * while this is true — not approximate, not stale, absent. The fix is a row in
 * `exchange_rates`, and naming the table is the most useful thing this bar can do.
 */
function RateBar() {
  const { tr } = useLocale();
  return (
    <InfoBar
      icon={Coins}
      tone="danger"
      title={tr('لا سعر صرف على السجل', 'Aucun taux enregistré', 'No rate on record')}
    >
      {tr(
        'النافذة تحمل أرصدة بالريال ولا شيء في جدول أسعار الصرف يسعّر الزوج، فكل مجموع مشترك بين العملتين يبقى غير قابل للتحديد. سطر واحد في exchange_rates يكفي.',
        'La fenêtre porte des soldes en riyals et rien dans la table des taux ne cote la paire : tout total mêlant les deux monnaies reste indéterminable. Une seule ligne dans exchange_rates suffit.',
        'The window holds riyal balances and nothing in the exchange-rate table quotes the pair, so every total that mixes the two currencies stays unstatable. One row in exchange_rates is enough.',
      )}
    </InfoBar>
  );
}

/** Invoices counted at face value: the sharpest overstatement the app is capable of. */
function WholeBar({ count }: { readonly count: number }) {
  const { tr } = useLocale();
  return (
    <InfoBar
      icon={CircleHelp}
      tone="warning"
      title={tr('مبالغ محسوبة بالكامل', 'Comptées en entier', 'Counted whole')}
    >
      {tr(
        `${count} فاتورة مسدَّدة جزئيًا محسوبة بقيمتها الكاملة: ما حُصِّل منها غير متاح للتطبيقات، فالمنتظر أعلاه أكبر من الحقيقة بمقدار ما وصل.`,
        `${count} facture(s) partiellement réglée(s) comptée(s) à leur valeur totale : ce qui a été encaissé n’est pas exposé aux applications, donc l’attendu ci-dessus dépasse la réalité de ce qui est déjà arrivé.`,
        `${count} partly settled invoice(s) are counted at face value: what has been collected against them is not exposed to an app, so the expected figure above overstates by however much has already arrived.`,
      )}
    </InfoBar>
  );
}

/**
 * Accounts whose two sides disagree, and where the answer is.
 *
 * The bar names reconciliation rather than offering it, because the hand-off takes one
 * account and this figure is about several. Opening the right one is a click on its row.
 */
function GapsBar({ count }: { readonly count: number }) {
  const { tr } = useLocale();
  return (
    <InfoBar icon={Scale} tone="warning" title={tr('فروق قائمة', 'Écarts ouverts', 'Open gaps')}>
      {tr(
        `${count} حسابًا يختلف فيه رصيد البنك عن الدفتر. اختر الحساب من الجدول لفتح المطابقة عليه.`,
        `${count} compte(s) où le solde bancaire diffère du grand livre. Sélectionnez le compte dans le tableau pour ouvrir son rapprochement.`,
        `${count} account(s) where the bank's balance differs from the book's. Pick the account in the table to open its reconciliation.`,
      )}
    </InfoBar>
  );
}

/** A page came back full, so every figure above is a floor. */
function BoundedBar() {
  const { tr } = useLocale();
  return (
    <InfoBar
      icon={Gauge}
      tone="warning"
      title={tr('حدّ أدنى لا حصيلة', 'Un minorant, pas un total', 'A floor, not a total')}
    >
      {tr(
        'وصلت إحدى الصفحات إلى سقفها، فما بعدها لم يُقرأ — وهو ليس صفرًا. كل مبلغ أعلاه قد يكون أكبر.',
        'Une page a atteint son plafond : ce qui suit n’a pas été lu, et ce n’est pas zéro. Chaque montant ci-dessus peut être plus grand.',
        'A page came back at its ceiling, so what lay beyond it was never read — which is not the same as zero. Every amount above may be larger.',
      )}
    </InfoBar>
  );
}

interface PositionPaneProps {
  readonly figures: Liquidity;
  readonly outlook: Forecast;
  /** Exactly what the export writes into the file, shown before anybody writes it. */
  readonly source: Provenance;
  /** Riyals are in play and nothing on record prices them. */
  readonly unpriced: boolean;
  readonly busy: TreasuryBusy;
  onCommand: (id: string) => void;
}

/**
 * The whole position, and everything that qualifies it.
 *
 * The pane a window with nothing selected shows, and the one a treasurer reads before
 * quoting a figure out loud. The rail states the same numbers in a narrower column; what
 * this adds is the provenance — how many accounts, how many of them have no book side,
 * how many statement lines are still unmatched — because those are what somebody will ask
 * about the moment the figure is challenged.
 */
export function PositionPane(props: PositionPaneProps) {
  const { t, tr, lang } = useLocale();
  const { figures, outlook, source } = props;
  const cash = (value: number | null) =>
    value === null ? tr('غير قابل للتحديد', 'Indéterminable', 'Not statable') : fmt.money(value, REPORTING, lang);
  const count = (value: number) => fmt.integer(value, lang);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <PositionTiles outlook={outlook} />
      <Card
        icon={Wallet}
        title={tr('الموقف النقدي', 'Position de trésorerie', 'Cash position')}
        subtitle={basisLine(source, t, tr)}
      >
        <PropertyRow label={tr('بتاريخ', 'Au', 'As of')} mono>
          {source.today}
        </PropertyRow>
        <PropertyRow label={tr('سعر الريال', 'Taux du riyal', 'Rate per SAR')}>
          {rateLine(source.rates, tr)}
        </PropertyRow>
        <PropertyRow label={tr('الحسابات', 'Comptes', 'Accounts')} mono>
          {count(figures.accounts)}
        </PropertyRow>
        {figures.unlinked === 0 ? null : (
          <PropertyRow label={tr('بلا طرف دفتري', 'Sans contrepartie', 'No book side')} mono>
            <span style={{ color: 'var(--fx-warning)' }}>{count(figures.unlinked)}</span>
          </PropertyRow>
        )}
        {figures.gaps === 0 ? null : (
          <PropertyRow label={tr('حسابات متفارقة', 'Comptes en écart', 'Accounts in gap')} mono>
            <span style={{ color: 'var(--fx-warning)' }}>{count(figures.gaps)}</span>
          </PropertyRow>
        )}
        {figures.unmatched === 0 ? null : (
          <PropertyRow label={tr('أسطر غير مطابقة', 'Lignes non rapprochées', 'Unmatched lines')} mono>
            <span style={{ color: 'var(--fx-warning)' }}>{count(figures.unmatched)}</span>
          </PropertyRow>
        )}
        <PropertyRow label={tr('الدفتر', 'Grand livre', 'Book')} mono>
          {cash(reported(figures.book, source.rates))}
        </PropertyRow>
        <PropertyRow label={tr('الفرق', 'Écart', 'Gap')} mono>
          <span style={{ fontWeight: 600 }}>{cash(outlook.gap)}</span>
        </PropertyRow>
        <PropertyRow label={tr('منه متأخّر خارج', 'Dont en retard, sorties', 'Of which overdue, out')} mono>
          {cash(reported(figures.outflow.overdue, source.rates))}
        </PropertyRow>
        <PropertyRow label={tr('منه متأخّر داخل', 'Dont en retard, entrées', 'Of which overdue, in')} mono>
          {cash(reported(figures.inflow.overdue, source.rates))}
        </PropertyRow>
        <PropertyRow
          label={tr('محصَّل خلال الأفق المنصرم', 'Encaissé sur l’horizon écoulé', 'Collected, trailing horizon')}
          mono
        >
          {cash(reported(figures.collected, source.rates))}
          <span style={{ color: 'var(--fx-text-tertiary)', marginInlineStart: 6 }}>
            {`×${count(figures.collections)}`}
          </span>
        </PropertyRow>
        {figures.setAside === 0 ? null : (
          <PropertyRow label={tr('مستندات مستثناة', 'Documents écartés', 'Set aside')} mono>
            {count(figures.setAside)}
          </PropertyRow>
        )}
      </Card>
      {props.unpriced ? <RateBar /> : null}
      {figures.whole === 0 ? null : <WholeBar count={figures.whole} />}
      {figures.gaps === 0 ? null : <GapsBar count={figures.gaps} />}
      {source.bounded ? <BoundedBar /> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => props.onCommand('copy')}>
          {tr('نسخ الملخّص', 'Copier la synthèse', 'Copy the summary')}
        </Button>
        <Button
          block
          icon={FileDown}
          busy={props.busy === 'export'}
          disabled={props.busy !== null}
          onClick={() => props.onCommand('export')}
        >
          {tr('تصدير الجدول', 'Exporter le tableau', 'Export the table')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One row
 * ------------------------------------------------------------------ */

/**
 * The two figures one row is, and the second one differs by what the row is.
 *
 * A bank account's second figure is its gap, because a balance nobody has agreed with the
 * book is the only balance worth a second look. A bill's or an invoice's is the number of
 * days, because an amount that is merely large is a plan and an amount that is late is a
 * phone call.
 */
function RowTiles({ row }: { readonly row: CashRow }) {
  const { tr, lang } = useLocale();
  const position = row.position;
  const days =
    row.days === null
      ? tr('بلا تاريخ', 'Sans date', 'No date')
      : row.days < 0
        ? `−${fmt.integer(Math.abs(row.days), lang)}`
        : fmt.integer(row.days, lang);
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      <KpiTile
        label={
          row.lens === 'cash'
            ? tr('رصيد البنك', 'Solde bancaire', 'Bank balance')
            : row.lens === 'payable'
              ? tr('المتبقّي', 'Restant dû', 'Outstanding')
              : tr('المنتظر', 'Attendu', 'Expected')
        }
        value={fmt.money(row.amount, row.currency, lang)}
        icon={Banknote}
      />
      {position === null ? (
        <KpiTile
          label={tr('الأيام حتى الاستحقاق', 'Jours avant échéance', 'Days to due')}
          value={days}
          icon={Timer}
          tone={row.bucket === null ? 'neutral' : bucketTone(row.bucket)}
        />
      ) : (
        <KpiTile
          label={tr('الفرق', 'Écart', 'Gap')}
          value={
            position.gap === null
              ? tr('لا طرف دفتري', 'Sans contrepartie', 'No book side')
              : fmt.money(position.gap, row.currency, lang)
          }
          icon={Scale}
          tone={gapTone(position.gap, position.bank)}
        />
      )}
    </div>
  );
}

/**
 * A tone as the colour it already means everywhere else in the OS.
 *
 * Spelled out rather than built by interpolation, so that a reader — and the stylesheet
 * audit — can see every token this file is able to paint with.
 */
const TONE_COLOR: Readonly<Record<Tone, string>> = {
  accent: 'var(--fx-accent)',
  danger: 'var(--fx-danger)',
  info: 'var(--fx-accent)',
  neutral: 'var(--fx-text-primary)',
  success: 'var(--fx-success)',
  warning: 'var(--fx-warning)',
};

/** Nothing to print, in the colour the rest of the OS uses for nothing. */
function Nothing() {
  return <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>;
}

/**
 * The bank's side, the book's side, and the evidence either was read from.
 *
 * Printed together because the gap between the first two is only ever explained by the
 * third. The unmatched count is the one figure on this card that names its own next step:
 * lines nobody has tied to a posting are where a difference of this size usually lives.
 */
function AccountFacts({
  position,
  currency,
}: {
  readonly position: Position;
  readonly currency: Currency;
}) {
  const { tr, lang } = useLocale();
  const money = (value: number) => fmt.money(value, currency, lang);
  const account = position.account;
  const detail = [account.institution, account.reference].filter((part) => part !== '').join(' · ');
  return (
    <Card
      icon={ListChecks}
      title={tr('الطرفان والدليل', 'Les deux côtés et la preuve', 'The two sides and the evidence')}
      subtitle={detail === '' ? account.name : detail}
    >
      <PropertyRow label={tr('رصيد البنك', 'Solde bancaire', 'Bank balance')} mono>
        <span style={{ fontWeight: 600 }}>{money(position.bank)}</span>
      </PropertyRow>
      <PropertyRow label={tr('الدفتر', 'Grand livre', 'Book')} mono>
        {position.book === null ? <Nothing /> : money(position.book)}
      </PropertyRow>
      <PropertyRow label={tr('الفرق', 'Écart', 'Gap')} mono>
        {position.gap === null ? (
          <Nothing />
        ) : (
          <span style={{ color: TONE_COLOR[gapTone(position.gap, position.bank)], fontWeight: 600 }}>
            {money(position.gap)}
          </span>
        )}
      </PropertyRow>
      <PropertyRow label={tr('حساب الدفتر', 'Compte du livre', 'Ledger account')} mono>
        {position.trial !== null ? (
          `${position.trial.code} · ${position.trial.name}`
        ) : position.linked ? (
          <span style={{ color: 'var(--fx-warning)' }}>
            {tr('مربوط بحساب لم يرد', 'Lié à un compte absent', 'Mapped to an account that did not come back')}
          </span>
        ) : (
          <span style={{ color: 'var(--fx-text-tertiary)' }}>
            {tr('غير مربوط', 'Non lié', 'Not mapped')}
          </span>
        )}
      </PropertyRow>
      <PropertyRow label={tr('كشوف محمَّلة', 'Relevés chargés', 'Statements loaded')} mono>
        {fmt.integer(position.statements, lang)}
      </PropertyRow>
      <PropertyRow label={tr('أسطر مطابقة', 'Lignes rapprochées', 'Matched lines')} mono>
        {fmt.integer(position.matched, lang)}
      </PropertyRow>
      <PropertyRow label={tr('أسطر غير مطابقة', 'Lignes non rapprochées', 'Unmatched lines')} mono>
        <span style={{ color: position.unmatched === 0 ? undefined : 'var(--fx-warning)' }}>
          {fmt.integer(position.unmatched, lang)}
        </span>
      </PropertyRow>
      <PropertyRow label={tr('آخر كشف', 'Dernier relevé', 'Last statement')} mono>
        {position.statement === null ? (
          <Nothing />
        ) : (
          <>
            {fmt.date(position.statement.date, lang)}
            <span style={{ color: 'var(--fx-text-tertiary)', marginInlineStart: 6 }}>
              {money(position.statement.closing)}
            </span>
          </>
        )}
      </PropertyRow>
    </Card>
  );
}

/**
 * The bill's own figures, including the one the lens does not show.
 *
 * The grid prints what is still owed, because that is what leaves the bank. The face value
 * and what has already been paid are here, because "we owe them 400 000" and "we owe them
 * 400 000 of 2 000 000, the rest settled" are two different conversations with a supplier.
 */
function BillFacts({ bill }: { readonly bill: Bill }) {
  const { tr, lang } = useLocale();
  const money = (value: number) => fmt.money(value, bill.currency, lang);
  return (
    <Card
      icon={Banknote}
      title={tr('الفاتورة نفسها', 'La facture elle-même', 'The bill itself')}
      subtitle={bill.number === '' ? tr('بلا رقم', 'Sans numéro', 'No number') : bill.number}
    >
      <PropertyRow label={tr('تاريخ الفاتورة', 'Date de facture', 'Bill date')} mono>
        {bill.date === '' ? <Nothing /> : fmt.date(bill.date, lang)}
      </PropertyRow>
      <PropertyRow label={tr('الاستحقاق', 'Échéance', 'Due')} mono>
        {bill.due === null ? <Nothing /> : fmt.date(bill.due, lang)}
      </PropertyRow>
      <PropertyRow label={tr('القيمة', 'Montant', 'Face value')} mono>
        {money(bill.amount)}
      </PropertyRow>
      <PropertyRow label={tr('المدفوع', 'Réglé', 'Paid')} mono>
        {money(bill.paid)}
      </PropertyRow>
      <PropertyRow label={tr('المتبقّي', 'Restant dû', 'Outstanding')} mono>
        <span style={{ fontWeight: 600 }}>{money(bill.outstanding)}</span>
      </PropertyRow>
      {bill.notes === '' ? null : (
        <PropertyRow label={tr('ملاحظات', 'Notes', 'Notes')}>{bill.notes}</PropertyRow>
      )}
    </Card>
  );
}

/**
 * The invoice's own figures, and the rate that is not this window's rate.
 *
 * An invoice raised in riyals carries the rate it was raised at. The window converts at
 * today's quote instead, so the two dinar figures for one invoice legitimately differ —
 * and that difference is the commonest reason two people arguing about a receivable are
 * both reading correctly. Printing the invoice's own rate is what ends the argument.
 */
function InvoiceFacts({ invoice }: { readonly invoice: Invoice }) {
  const { tr, lang } = useLocale();
  const money = (value: number) => fmt.money(value, invoice.currency, lang);
  return (
    <Card
      icon={Banknote}
      title={tr('الفاتورة نفسها', 'La facture elle-même', 'The invoice itself')}
      subtitle={invoice.number === '' ? tr('بلا رقم', 'Sans numéro', 'No number') : invoice.number}
    >
      <PropertyRow label={tr('تاريخ الإصدار', 'Date d’émission', 'Issued')} mono>
        {invoice.issued === '' ? <Nothing /> : fmt.date(invoice.issued, lang)}
      </PropertyRow>
      <PropertyRow label={tr('الاستحقاق', 'Échéance', 'Due')} mono>
        {invoice.due === null ? <Nothing /> : fmt.date(invoice.due, lang)}
      </PropertyRow>
      <PropertyRow label={tr('القيمة', 'Montant', 'Face value')} mono>
        <span style={{ fontWeight: 600 }}>{money(invoice.total)}</span>
      </PropertyRow>
      <PropertyRow label={tr('سعرها عند الإصدار', 'Taux à l’émission', 'Rate when raised')} mono>
        {invoice.rate === null ? <Nothing /> : invoice.rate.toFixed(4)}
      </PropertyRow>
      {invoice.restated ? (
        <PropertyRow label={tr('العملة', 'Monnaie', 'Currency')}>
          <span style={{ color: 'var(--fx-warning)' }}>
            {tr(
              'مستنتجة من العمود المعبَّأ',
              'Déduite de la colonne renseignée',
              'Inferred from the column that was filled',
            )}
          </span>
        </PropertyRow>
      ) : null}
    </Card>
  );
}

/**
 * The row's one qualification, at the length it deserves.
 *
 * Warning on all eight, because every note in this window is a reason a figure beside it
 * is not quite what it looks like — and a note nobody has to act on would not have been
 * worth writing. The grid gives the label; this gives the sentence.
 */
function NoteBar({ note }: { readonly note: NoteId }) {
  const { t } = useLocale();
  return (
    <InfoBar icon={CircleHelp} tone="warning" title={t(NOTE_LABEL[note])}>
      {t(NOTE_REASON[note])}
    </InfoBar>
  );
}

interface RowPaneProps {
  readonly row: CashRow;
  readonly source: Provenance;
  onCommand: (id: string) => void;
}

/**
 * One row, and the two questions it can be handed on to somebody else.
 *
 * Which facts print depends on what the row is, and the pane simply prints the sides it
 * has: a bank account has a position, a bill has a bill, an invoice has an invoice, and
 * none of them has the other two. The hand-offs are dark when the row cannot use them —
 * a supplier bill has no ledger account to open and nothing to reconcile.
 */
export function RowPane({ row, source, onCommand }: RowPaneProps) {
  const { t, tr, lang } = useLocale();
  const lens = t(LENS_LABEL[row.lens]);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <RowTiles row={row} />
      <Card
        icon={row.lens === 'cash' ? Landmark : row.lens === 'payable' ? ArrowUpRight : ArrowDownRight}
        title={row.title}
        subtitle={row.detail === '' ? lens : `${lens} · ${row.detail}`}
      >
        <PropertyRow label={tr('الحالة', 'Statut', 'Status')}>{t(row.badge)}</PropertyRow>
        {row.bucket === null ? null : (
          <PropertyRow label={tr('التوقيت', 'Calendrier', 'Timing')}>
            {t(BUCKET_LABEL[row.bucket])}
          </PropertyRow>
        )}
        {row.date === null ? null : (
          <PropertyRow
            label={
              row.lens === 'cash'
                ? tr('آخر كشف', 'Dernier relevé', 'Last statement')
                : tr('الاستحقاق', 'Échéance', 'Due')
            }
            mono
          >
            {fmt.date(row.date, lang)}
          </PropertyRow>
        )}
        {row.currency === REPORTING ? null : (
          <PropertyRow label={tr('بالدينار', 'En dinars', 'In dinars')} mono>
            {row.reported === null ? <Nothing /> : fmt.money(row.reported, REPORTING, lang)}
          </PropertyRow>
        )}
      </Card>
      {row.position === null ? null : (
        <AccountFacts position={row.position} currency={row.currency} />
      )}
      {row.bill === null ? null : <BillFacts bill={row.bill} />}
      {row.invoice === null ? null : <InvoiceFacts invoice={row.invoice} />}
      {row.note === null ? null : <NoteBar note={row.note} />}
      <Section title={tr('الأساس', 'Base', 'Basis')}>
        <span style={{ color: 'var(--fx-text-secondary)', fontSize: 'var(--fx-caption)' }}>
          {basisLine(source, t, tr)}
        </span>
      </Section>
      <div style={{ display: 'grid', gap: 8 }}>
        <Button
          block
          variant="accent"
          icon={ExternalLink}
          disabled={row.accountId === null}
          title={tr(
            'يفتح حساب الدفتر المقابل في دفتر اليومية.',
            'Ouvre le compte du grand livre correspondant.',
            'Opens the matching ledger account in the general ledger.',
          )}
          onClick={() => onCommand('ledger')}
        >
          {tr('فتح الحساب في الدفتر', 'Ouvrir le compte du livre', 'Open the ledger account')}
        </Button>
        <Button
          block
          icon={Scale}
          disabled={row.position === null}
          title={tr(
            'يفتح المطابقة على هذا الحساب البنكي، حيث تُقرأ أسطر الكشف غير المطابقة.',
            'Ouvre le rapprochement de ce compte bancaire, où se lisent les lignes non rapprochées.',
            'Opens reconciliation for this bank account, where the unmatched statement lines are read.',
          )}
          onClick={() => onCommand('reconcile')}
        >
          {tr('فتح المطابقة', 'Ouvrir le rapprochement', 'Open reconciliation')}
        </Button>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copyRow')}>
          {tr('نسخ هذا السطر', 'Copier cette ligne', 'Copy this row')}
        </Button>
      </div>
    </div>
  );
}










