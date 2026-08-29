/**
 * Treasury — the chrome.
 *
 * The toolbar owns the lens, because the lens is the window's identity rather than a
 * setting inside it: "what we hold", "what leaves" and "what should arrive" are three
 * reports that happen to share a grid. The rail owns the horizon and the ranking, since
 * those change what the figures *mean*; the one control that merely hides rows sits in
 * the toolbar, beside the grid it acts on.
 *
 * One input outranks every balance here, and it is the rate. A position stated in dinars
 * out of a riyal account is an opinion with a date on it, so the quote, the day it was
 * made and its source are printed in the rail, restated in the status bar and carried in
 * every export. Where no quote exists the totals say they cannot be stated, which is the
 * one honest answer and the only figure this window refuses to round.
 *
 * Nothing here writes to the book, so nothing greys out to protect it. A control is dark
 * only when it has nothing to act on, and the pane says why: the horizon on the cash lens
 * is not broken but meaningless — a balance is not due on a date — and the two hand-offs
 * wait for a row that actually has somewhere to go.
 */
import type { Ref } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarRange,
  CircleHelp,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  Filter,
  Gauge,
  ListChecks,
  RefreshCw,
  Scale,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Badge,
  Button,
  Field,
  fmt,
  IconButton,
  type MenuEntry,
  MenuFlyout,
  NavGroupLabel,
  SearchBox,
  Segmented,
  Select,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  type Tone,
  useLocale,
} from '@/platform/sdk';
import type { TreasuryBusy } from './actions';
import {
  type Bucket,
  BUCKET_LABEL,
  bucketTone,
  type CashRow,
  type Forecast,
  type Horizon,
  HORIZONS,
  type Lens,
  LENS_LABEL,
  LENS_UNIT,
  type Liquidity,
  runwayTone,
  type Sort,
  SORT_LABEL,
} from './cash';
import { type Question, timed } from './question';
import { type RateBook, REPORTING, reported } from './rates';
import { rateLine } from './report';

/** The lens wears the direction its money moves, in the toolbar and in the status bar. */
const LENS_ICON: Readonly<Record<Lens, typeof Wallet>> = {
  cash: Wallet,
  payable: ArrowUpRight,
  receivable: ArrowDownRight,
};

/**
 * A tone as the colour it already means everywhere else in the OS.
 *
 * Spelled out rather than interpolated, so a reader — and the stylesheet audit — can see
 * every token this file is able to paint with.
 */
const TONE_COLOR: Readonly<Record<Tone, string>> = {
  accent: 'var(--fx-accent)',
  danger: 'var(--fx-danger)',
  info: 'var(--fx-accent)',
  neutral: 'var(--fx-text-primary)',
  success: 'var(--fx-success)',
  warning: 'var(--fx-warning)',
};
interface LineProps {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
  readonly tone?: Tone;
  readonly title?: string;
}

/** A label and a figure on one row. The figure is `fx-num`, so a column of them lines up. */
function RailLine({ label, value, strong = false, tone, title }: LineProps) {
  return (
    <div
      title={title}
      style={{
        alignItems: 'baseline',
        display: 'flex',
        fontSize: 'var(--fx-caption)',
        gap: 10,
        justifyContent: 'space-between',
      }}
    >
      <span style={{ color: 'var(--fx-text-secondary)', minWidth: 0 }}>{label}</span>
      <span
        className="fx-num"
        style={{
          color: tone === undefined ? undefined : TONE_COLOR[tone],
          fontWeight: strong ? 600 : 400,
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** A sentence in the rail, for the things a control cannot say on its own. */
function RailNote({ tone, children }: { readonly tone: string; readonly children: string }) {
  return <span style={{ color: tone, fontSize: 'var(--fx-caption)' }}>{children}</span>;
}
/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ *
 * The three lenses first, because which one is on screen is what the window *is*. Then
 * the two hand-offs, in the order a treasurer asks for them: the postings behind the
 * book balance, and then the statement lines that explain why the two sides differ.
 *
 * There is no Save and no Open. This window owns no document — a saved copy of a cash
 * position is wrong by the afternoon, and the question it answers is three keys to
 * restate.
 */

interface ToolbarProps {
  readonly lens: Lens;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: TreasuryBusy;
  readonly loading: boolean;
  /** Rows the horizon excludes are printed under the ones it includes. */
  readonly beyond: boolean;
  /** How many rows that toggle is holding back, so the control can say so. */
  readonly outside: number;
  /** A row is selected and it names a ledger account. */
  readonly canDrill: boolean;
  /** A bank row is selected, so reconciliation has an account to open. */
  readonly canReconcile: boolean;
  onSearch: (next: string) => void;
  onBeyond: (next: boolean) => void;
  onCommand: (id: string) => void;
}

export function TreasuryToolbar(props: ToolbarProps) {
  const { tr, lang } = useLocale();
  const { busy, onCommand } = props;
  const working = busy !== null;
  const lenses: readonly { value: Lens; label: string; icon: typeof Wallet }[] = [
    { value: 'cash', label: tr('النقدية', 'Trésorerie', 'Cash'), icon: Wallet },
    { value: 'payable', label: tr('للدفع', 'À payer', 'Payable'), icon: ArrowUpRight },
    { value: 'receivable', label: tr('للتحصيل', 'À encaisser', 'Receivable'), icon: ArrowDownRight },
  ];
  return (
    <div className="fx-commandbar">
      <Segmented value={props.lens} onChange={(next) => onCommand(`lens:${next}`)} options={lenses} />
      <ToolbarSeparator />
      <Button
        icon={ExternalLink}
        variant="accent"
        disabled={!props.canDrill}
        onClick={() => onCommand('ledger')}
        title={tr(
          'فتح حساب الدفتر المقابل لهذا السطر في دفتر الأستاذ',
          'Ouvrir dans le grand livre le compte comptable de cette ligne',
          'Open this row’s ledger account in the general ledger',
        )}
      >
        {tr('الدفتر', 'Grand livre', 'Ledger')}
      </Button>
      <Button
        icon={Scale}
        disabled={!props.canReconcile}
        onClick={() => onCommand('reconcile')}
        title={tr(
          'فتح المطابقة على هذا الحساب البنكي لتفسير الفرق',
          'Ouvrir le rapprochement de ce compte bancaire pour expliquer l’écart',
          'Open reconciliation on this bank account to explain the gap',
        )}
      >
        {tr('المطابقة', 'Rapprochement', 'Reconcile')}
      </Button>
      <ToolbarSpacer />
      <IconButton
        icon={props.beyond ? Eye : EyeOff}
        label={
          props.outside === 0
            ? tr('إظهار ما بعد الأفق', 'Afficher au-delà de l’horizon', 'Show beyond the horizon')
            : tr(
                `إظهار ${fmt.integer(props.outside, lang)} سطرًا بعد الأفق أو بلا تاريخ`,
                `Afficher ${fmt.integer(props.outside, lang)} ligne(s) au-delà de l’horizon ou sans échéance`,
                `Show ${fmt.integer(props.outside, lang)} row(s) beyond the horizon or with no due date`,
              )
        }
        active={props.beyond}
        disabled={props.lens === 'cash'}
        onClick={() => props.onBeyond(!props.beyond)}
      />
      <SearchBox
        ref={props.searchRef}
        value={props.search}
        onChange={props.onSearch}
        width={210}
        placeholder={tr('بحث في السطور', 'Rechercher une ligne', 'Search the rows')}
      />
      <Button
        icon={Copy}
        disabled={working}
        onClick={() => onCommand('copy')}
        title={tr(
          'نسخ الموقف كاملًا مع سعر الصرف الذي سعّره (Ctrl+Shift+C)',
          'Copier la position entière avec le taux qui l’a valorisée (Ctrl+Maj+C)',
          'Copy the whole position, with the rate that priced it (Ctrl+Shift+C)',
        )}
      >
        {tr('نسخ', 'Copier', 'Copy')}
      </Button>
      <Button
        icon={FileDown}
        busy={busy === 'export'}
        disabled={working}
        onClick={() => onCommand('export')}
        title={tr('تصدير CSV (Ctrl+E)', 'Exporter en CSV (Ctrl+E)', 'Export to CSV (Ctrl+E)')}
      >
        {tr('تصدير', 'Exporter', 'Export')}
      </Button>
      <ToolbarSeparator />
      <IconButton
        icon={RefreshCw}
        label={tr('تحديث (F5)', 'Actualiser (F5)', 'Refresh (F5)')}
        disabled={props.loading}
        onClick={() => onCommand('refresh')}
      />
    </div>
  );
}
/* ------------------------------------------------------------------ *
 * Rail — the question
 * ------------------------------------------------------------------ *
 * Two controls, and both of them change what the figures mean rather than which rows
 * appear: how far ahead the window looks, and what the table is ranked by. The horizon
 * is a list of four rather than a box to type in, because a horizon somebody can type is
 * a horizon somebody will tune until the forecast survives.
 */

interface QuestionProps {
  readonly question: Question;
  onHorizon: (next: Horizon) => void;
  onSort: (next: Sort) => void;
}
/**
 * The two controls that decide what the figures mean.
 *
 * The horizon is offered on the flow lenses and disabled on the cash one, where a
 * balance is not due on a date and every window would return the same number. The hint
 * says which of the two situations you are in, so a dark control never reads as a broken
 * one.
 */
function QuestionBlock({ question, onHorizon, onSort }: QuestionProps) {
  const { t, tr } = useLocale();
  const windowed = timed(question.lens);
  const horizons = HORIZONS.map((days) => ({
    value: String(days),
    label: tr(`${days} يومًا`, `${days} jours`, `${days} days`),
  }));
  const sorts: readonly { value: Sort; label: string }[] = [
    { value: 'amount', label: t(SORT_LABEL.amount) },
    { value: 'due', label: t(SORT_LABEL.due) },
    { value: 'name', label: t(SORT_LABEL.name) },
  ];
  return (
    <div style={{ display: 'grid', gap: 12, padding: '0 10px 12px' }}>
      <Field
        label={tr('الأفق', 'Horizon', 'Horizon')}
        hint={
          windowed
            ? tr(
                'ما يقع استحقاقه داخل هذا المدى يُحتسب؛ وما تأخّر يُحتسب دائمًا.',
                'Ce qui échoit dans cette étendue est compté ; ce qui est en retard l’est toujours.',
                'What falls due inside this stretch is counted, and what is already late always is.',
              )
            : tr(
                'الرصيد ليس مستحقًّا في تاريخ، فلا أفق ينطبق على النقدية.',
                'Un solde n’échoit à aucune date : aucun horizon ne s’applique à la trésorerie.',
                'A balance is not due on a date, so no horizon applies to the cash lens.',
              )
        }
      >
        <Select
          value={String(question.horizon)}
          onChange={(next) => onHorizon(HORIZONS.find((days) => String(days) === next) ?? 30)}
          options={horizons}
          disabled={!windowed}
        />
      </Field>
      <Field
        label={tr('الترتيب', 'Classement', 'Ranking')}
        hint={tr(
          'الأكبر أولًا: هو السطر الذي يستحقّ نقاشًا. السطور بلا تاريخ تأتي آخرًا في ترتيب الاستحقاق.',
          'Le plus gros d’abord : c’est la ligne qui mérite une discussion. Les lignes sans échéance passent en dernier.',
          'Biggest first, because that is the row worth an argument. Undated rows sort last by due date.',
        )}
      >
        <Segmented value={question.sort} onChange={onSort} options={sorts} size="sm" />
      </Field>
    </div>
  );
}
interface ReadProps {
  readonly lens: Lens;
  readonly today: string;
  readonly rates: RateBook;
  readonly figures: Liquidity;
  /** Rows in the lens in force, before the find box and the horizon narrowed them. */
  readonly count: number;
  readonly bounded: boolean;
  readonly unpriced: boolean;
}

/**
 * What was actually read, and what that costs the reader.
 *
 * The rate heads the block rather than sitting under the totals, because it is the one
 * fact that changes every converted figure below it and the one nobody remembers to ask
 * about. Its date and its source come with it: a quote from a bank's board and one
 * somebody typed off a screen last March are not the same evidence.
 *
 * Then four counts and up to four sentences, each a limit a reader would otherwise
 * discover by reconciling this window against a bank statement by hand.
 */
function ReadBlock(props: ReadProps) {
  const { t, tr, lang } = useLocale();
  const { figures, rates } = props;
  const count = (value: number) => fmt.integer(value, lang);
  return (
    <div style={{ display: 'grid', gap: 6, padding: '0 10px 12px' }}>
      <RailLine label={tr('بتاريخ', 'Au', 'As of')} value={props.today} />
      <RailLine
        label={tr('سعر الريال', 'Taux du riyal', 'Rate per SAR')}
        value={
          rates.perSar === null
            ? tr('لا يوجد', 'Aucun', 'None')
            : `${rates.perSar.toFixed(4)} ${REPORTING}`
        }
        tone={rates.perSar === null ? 'warning' : undefined}
        title={rateLine(rates, tr)}
      />
      {rates.at === null ? null : (
        <RailNote tone="var(--fx-text-tertiary)">{rateLine(rates, tr)}</RailNote>
      )}
      <RailLine label={tr('حسابات بنكية', 'Comptes bancaires', 'Bank accounts')} value={count(figures.accounts)} />
      {figures.unlinked === 0 ? null : (
        <RailLine
          label={tr('بلا طرف دفتري', 'Sans contrepartie', 'No book side')}
          value={count(figures.unlinked)}
          tone="warning"
          title={tr(
            'أرصدة لا يمكن مقارنتها بالدفتر لأنها لا تشير إلى حساب فيه.',
            'Des soldes incomparables au livre : ils ne désignent aucun compte comptable.',
            'Balances that cannot be compared to the book, because they name no account in it.',
          )}
        />
      )}
      {figures.gaps === 0 ? null : (
        <RailLine
          label={tr('فروق', 'Écarts', 'Gaps')}
          value={count(figures.gaps)}
          tone="warning"
          title={tr(
            'حسابات يختلف فيها البنك عن الدفتر بأكثر من سنتيم.',
            'Comptes où la banque et le livre diffèrent de plus d’un centime.',
            'Accounts where the bank and the book disagree by more than a centime.',
          )}
        />
      )}
      {figures.unmatched === 0 ? null : (
        <RailLine
          label={tr('أسطر غير مطابقة', 'Lignes non rapprochées', 'Unmatched lines')}
          value={count(figures.unmatched)}
          title={tr(
            'الفرق بين البنك والدفتر يُقرأ من خلالها أولًا.',
            'L’écart banque / livre se lit d’abord à travers elles.',
            'The gap between bank and book is read through these first.',
          )}
        />
      )}
      <RailLine label={t(LENS_UNIT[props.lens])} value={count(props.count)} />
      {props.unpriced ? (
        <RailNote tone="var(--fx-danger)">
          {tr(
            'أرصدة بالريال ولا سعر مسجَّل للزوج، فالمجاميع الجامعة بين العملتين لا تُذكَر.',
            'Des montants en riyals et aucun taux enregistré : les totaux qui mêlent les deux monnaies ne sont pas énoncés.',
            'Riyals are in play and nothing on record prices the pair, so any total that mixes the two currencies is left unstated.',
          )}
        </RailNote>
      ) : null}
      {figures.whole === 0 ? null : (
        <RailNote tone="var(--fx-warning)">
          {tr(
            `${fmt.integer(figures.whole, lang)} فاتورة محصَّلة جزئيًا تُحتسب بقيمتها الكاملة: ما دُفع مقابلها غير متاح للتطبيقات.`,
            `${fmt.integer(figures.whole, lang)} facture(s) partiellement réglée(s) comptée(s) en entier : ce qui a été encaissé dessus n’est pas exposé aux applications.`,
            `${fmt.integer(figures.whole, lang)} partly settled invoice(s) counted at face value: what has been collected against them is not exposed to an app.`,
          )}
        </RailNote>
      )}
      {figures.setAside === 0 ? null : (
        <RailNote tone="var(--fx-text-tertiary)">
          {tr(
            `${fmt.integer(figures.setAside, lang)} مستندًا مسوّدة أو ملغى يحمل مبلغًا، مستثنى من كل رقم أعلاه.`,
            `${fmt.integer(figures.setAside, lang)} document(s) brouillon ou annulé(s) portant un montant, écarté(s) de chaque nombre ci-dessus.`,
            `${fmt.integer(figures.setAside, lang)} draft or cancelled document(s) carry an amount and are excluded from every figure above.`,
          )}
        </RailNote>
      )}
      {props.bounded ? (
        <RailNote tone="var(--fx-warning)">
          {tr(
            'صفحة وصلت إلى سقفها: كل رقم أدناه حدّ أدنى.',
            'Une page a atteint son plafond : chaque nombre ci-dessous est un minorant.',
            'A page came back full, so every figure below is a lower bound.',
          )}
        </RailNote>
      ) : null}
    </div>
  );
}
/**
 * The figures, in the order a treasurer says them out loud.
 *
 * What is in the bank, what the book thinks, the difference between them, what leaves,
 * what should arrive, what was actually collected — and only then what that leaves at the
 * end of the horizon. The projected balance comes last on purpose: it is the only figure
 * here that is not a fact, and a forecast printed first is a forecast that gets quoted as
 * a balance.
 *
 * Every figure is summed over the whole lens rather than the rows on screen, so nothing
 * in this pane moves while somebody is typing in the find box.
 */
function FigureBlock({
  figures,
  outlook,
  rates,
}: {
  readonly figures: Liquidity;
  readonly outlook: Forecast;
  readonly rates: RateBook;
}) {
  const { tr, lang } = useLocale();
  const cash = (value: number | null) =>
    value === null
      ? tr('غير قابل للتحديد', 'Indéterminable', 'Not statable')
      : fmt.money(value, REPORTING, lang);
  return (
    <div style={{ display: 'grid', gap: 6, padding: '0 10px 12px' }}>
      <RailLine
        label={tr('رصيد البنوك', 'Solde bancaire', 'Bank balance')}
        value={cash(outlook.opening)}
        strong
        title={tr(
          'ما تقوله البنوك إنها تحمله، كما هو مسجَّل على الحسابات.',
          'Ce que les banques déclarent détenir, tel qu’enregistré sur les comptes.',
          'What the banks say they hold, as recorded on the accounts.',
        )}
      />
      <RailLine label={tr('الدفتر', 'Livre', 'Book')} value={cash(reported(figures.book, rates))} />
      <RailLine
        label={tr('الفرق', 'Écart', 'Gap')}
        value={cash(outlook.gap)}
        tone={figures.gaps === 0 ? undefined : 'warning'}
        title={tr(
          'البنك ناقص الدفتر، على الحسابات المرتبطة وحدها.',
          'Banque moins livre, sur les seuls comptes rattachés.',
          'Bank less book, over the linked accounts alone.',
        )}
      />
      <RailLine
        label={tr('يخرج خلال الأفق', 'Sorties sur l’horizon', 'Out over the horizon')}
        value={cash(outlook.outgoing)}
        title={tr(
          'فواتير الموردين المستحقّة داخل الأفق، والمتأخّرة منها ضمنها.',
          'Les factures fournisseurs échéant dans l’horizon, retards inclus.',
          'Supplier bills falling due inside the horizon, the overdue ones included.',
        )}
      />
      <RailLine
        label={tr('منها متأخّر', 'dont en retard', 'of which overdue')}
        value={cash(reported(figures.outflow.overdue, rates))}
        tone={figures.outflow.overdue.dzd + figures.outflow.overdue.sar === 0 ? undefined : 'danger'}
      />
      <RailLine
        label={tr('يدخل خلال الأفق', 'Entrées sur l’horizon', 'In over the horizon')}
        value={cash(outlook.incoming)}
        title={tr(
          'فواتير العملاء غير المسدَّدة والمستحقّة داخل الأفق.',
          'Les factures clients non réglées échéant dans l’horizon.',
          'Unsettled customer invoices falling due inside the horizon.',
        )}
      />
      <RailLine
        label={tr('منها متأخّر', 'dont en retard', 'of which overdue')}
        value={cash(reported(figures.inflow.overdue, rates))}
        tone={figures.inflow.overdue.dzd + figures.inflow.overdue.sar === 0 ? undefined : 'warning'}
      />
      <RailLine
        label={tr('محصَّل سابقًا', 'Encaissé', 'Collected')}
        value={cash(reported(figures.collected, rates))}
        title={tr(
          'مدفوعات مؤكَّدة خلال الأفق المنصرم: تحصيل واقع، لا خطة.',
          'Paiements confirmés sur l’horizon écoulé : de l’encaissement constaté, pas un plan.',
          'Confirmed payments over the trailing horizon: collection as evidence rather than plan.',
        )}
      />
      <RailLine
        label={tr('الرصيد المتوقَّع', 'Solde projeté', 'Projected balance')}
        value={cash(outlook.closing)}
        strong
        tone={runwayTone(outlook.closing, outlook.opening)}
        title={tr(
          'الرصيد ناقص ما يخرج زائد ما يدخل. طرح واحد، ولا نمذجة لموسم أو رحلة.',
          'Le solde moins les sorties plus les entrées. Une soustraction, sans modéliser saison ni départ.',
          'The balance less what leaves plus what arrives. One subtraction, and nothing about a season or a departure.',
        )}
      />
    </div>
  );
}
const BUCKETS: readonly Bucket[] = ['overdue', 'soon', 'later', 'undated'];

/**
 * How the lens's rows fall either side of the horizon.
 *
 * Counts rather than amounts, because the amounts are already above and this block
 * answers a different question: how much of what the window is looking at is late, and
 * how much of it the horizon is not looking at yet. A zero wears no colour — four
 * coloured zeros are four warnings about nothing.
 */
function TimingBlock({ buckets }: { readonly buckets: Readonly<Record<Bucket, number>> }) {
  const { t, lang } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 6, padding: '0 10px 12px' }}>
      {BUCKETS.map((bucket) => (
        <RailLine
          key={bucket}
          label={t(BUCKET_LABEL[bucket])}
          value={fmt.integer(buckets[bucket], lang)}
          tone={buckets[bucket] === 0 ? undefined : bucketTone(bucket)}
        />
      ))}
    </div>
  );
}

interface RailProps {
  readonly question: Question;
  readonly figures: Liquidity;
  readonly outlook: Forecast;
  readonly rates: RateBook;
  readonly buckets: Readonly<Record<Bucket, number>>;
  readonly today: string;
  readonly count: number;
  readonly bounded: boolean;
  readonly unpriced: boolean;
  readonly busy: TreasuryBusy;
  onHorizon: (next: Horizon) => void;
  onSort: (next: Sort) => void;
  onCommand: (id: string) => void;
}
/**
 * The pane, and the one badge worth trusting at a glance.
 *
 * The badge grades the projected balance against today's, because that comparison is the
 * whole point of the window: a position that survives the horizon and one that does not
 * are two different mornings. It says nothing at all when no rate prices the pair —
 * a runway computed out of half the currencies would be the most flattering number here.
 */
export function TreasuryRail(props: RailProps) {
  const { tr } = useLocale();
  const { outlook, question } = props;
  const tone = runwayTone(outlook.closing, outlook.opening);
  return (
    <>
      <NavGroupLabel>{tr('السؤال', 'La question', 'The question')}</NavGroupLabel>
      <QuestionBlock question={question} onHorizon={props.onHorizon} onSort={props.onSort} />

      <NavGroupLabel>{tr('ما قُرئ', 'Ce qui a été lu', 'What was read')}</NavGroupLabel>
      <ReadBlock
        lens={question.lens}
        today={props.today}
        rates={props.rates}
        figures={props.figures}
        count={props.count}
        bounded={props.bounded}
        unpriced={props.unpriced}
      />

      <NavGroupLabel>{tr('الأرقام', 'Les nombres', 'The figures')}</NavGroupLabel>
      <FigureBlock figures={props.figures} outlook={outlook} rates={props.rates} />

      {timed(question.lens) ? (
        <>
          <NavGroupLabel>{tr('التوقيت', 'Échéancier', 'Timing')}</NavGroupLabel>
          <TimingBlock buckets={props.buckets} />
        </>
      ) : null}
      <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
        {outlook.closing === null ? (
          <Badge
            tone="neutral"
            icon={CircleHelp}
            title={tr(
              'لا سعر صرف يسمح بجمع العملتين في رقم واحد.',
              'Aucun taux ne permet de réunir les deux monnaies en un seul nombre.',
              'No rate on record lets the two currencies be added into one figure.',
            )}
          >
            {tr('لا يمكن تحديد المتوقَّع', 'Projection impossible', 'No projection statable')}
          </Badge>
        ) : (
          <Badge
            tone={tone}
            icon={tone === 'success' ? Coins : TrendingDown}
            title={tr(
              'الرصيد المتوقَّع في نهاية الأفق، مقابل رصيد اليوم.',
              'Le solde projeté en fin d’horizon, face au solde du jour.',
              'The projected balance at the end of the horizon, against today’s.',
            )}
          >
            {tone === 'danger'
              ? tr('الأفق لا يُغطَّى', 'Horizon non couvert', 'The horizon is not covered')
              : tone === 'warning'
                ? tr('ينقص خلال الأفق', 'En baisse sur l’horizon', 'Falling over the horizon')
                : tr('الأفق مُغطّى', 'Horizon couvert', 'The horizon is covered')}
          </Badge>
        )}
        <Button
          icon={FileDown}
          block
          busy={props.busy === 'export'}
          disabled={props.busy !== null}
          onClick={() => props.onCommand('export')}
          title={tr(
            'كل سطر في الملف يحمل الأفق والتاريخ والسعر الذي سعّره.',
            'Chaque ligne du fichier porte l’horizon, la date et le taux qui l’a valorisée.',
            'Every row in the file carries the horizon, the date and the rate that priced it.',
          )}
        >
          {tr('تصدير الجدول', 'Exporter le tableau', 'Export the table')}
        </Button>
        <Button icon={Copy} block variant="subtle" onClick={() => props.onCommand('copy')}>
          {tr('نسخ الموقف', 'Copier la position', 'Copy the position')}
        </Button>
      </div>
    </>
  );
}
/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ *
 * The lens, the horizon, the date and the rate are all restated here even though the rail
 * shows every one of them, because the status bar is what a screenshot keeps. "We have
 * 12 million" is a sentence somebody will repeat to a bank, and the only defence against
 * it being repeated wrongly is that the picture it came from said, along its own bottom
 * edge, as of when and at what rate.
 */

interface ScopeProps {
  readonly lens: Lens;
  readonly horizon: Horizon;
  readonly today: string;
  readonly rates: RateBook;
  /** Rows printed in the grid, and rows the find box and the horizon are holding back. */
  readonly printed: number;
  readonly hidden: number;
}

/** Which question, over what stretch, as of when, and priced by what. */
function ScopeItems(props: ScopeProps) {
  const { t, tr, lang } = useLocale();
  const { lens, rates } = props;
  return (
    <>
      <StatusItem
        icon={LENS_ICON[lens]}
        title={tr(
          'السؤال الذي تجيب عنه هذه القائمة.',
          'La question à laquelle cette liste répond.',
          'The question this list answers.',
        )}
      >
        {t(LENS_LABEL[lens])}
      </StatusItem>
      <StatusItem
        icon={CalendarRange}
        title={tr(
          'كل تقادم وكل أفق في هذه النافذة يُقاس من هذا اليوم.',
          'Chaque âge et chaque horizon de cette fenêtre sont mesurés depuis ce jour.',
          'Every age and every horizon in this window is measured from this day.',
        )}
      >
        {timed(lens)
          ? tr(
              `${props.horizon} يومًا · ${props.today}`,
              `${props.horizon} j · ${props.today}`,
              `${props.horizon} days · ${props.today}`,
            )
          : props.today}
      </StatusItem>
      <StatusItem
        icon={Coins}
        tone={rates.perSar === null ? 'warning' : 'neutral'}
        title={rateLine(rates, tr)}
      >
        {rates.perSar === null
          ? tr('لا سعر صرف', 'Aucun taux', 'No rate')
          : `1 SAR = ${rates.perSar.toFixed(4)} ${REPORTING}`}
      </StatusItem>
      <StatusItem
        icon={ListChecks}
        title={tr('سطور مطبوعة في الجدول.', 'Lignes imprimées dans le tableau.', 'Rows printed in the table.')}
      >
        {`${fmt.integer(props.printed, lang)} ${t(LENS_UNIT[lens])}`}
      </StatusItem>
      {props.hidden === 0 ? null : (
        <StatusItem
          icon={Filter}
          title={tr(
            'سطور أخفاها البحث أو الأفق. كل رقم في الشريط لا يزال يحتسبها.',
            'Lignes masquées par la recherche ou l’horizon. Chaque nombre du volet les compte encore.',
            'Rows hidden by the find box or the horizon. Every figure in the rail still counts them.',
          )}
        >
          {tr(
            `${fmt.integer(props.hidden, lang)} مُخفى`,
            `${fmt.integer(props.hidden, lang)} masqués`,
            `${fmt.integer(props.hidden, lang)} hidden`,
          )}
        </StatusItem>
      )}
    </>
  );
}
/**
 * What the position comes to, in three figures.
 *
 * Today's balance, the difference against the book, and where the horizon leaves it. The
 * projected balance wears the colour, because it is the figure a reader is deciding on —
 * and it is graded against the opening balance rather than against zero, so a position
 * that is merely shrinking cannot be mistaken for one that is safe.
 */
function ShapeItems({
  figures,
  outlook,
}: {
  readonly figures: Liquidity;
  readonly outlook: Forecast;
}) {
  const { tr, lang } = useLocale();
  const cash = (value: number | null) =>
    value === null
      ? tr('غير قابل للتحديد', 'Indéterminable', 'Not statable')
      : fmt.money(value, REPORTING, lang);
  const tone = runwayTone(outlook.closing, outlook.opening);
  return (
    <>
      <StatusItem
        icon={Banknote}
        title={tr('ما تحمله البنوك اليوم.', 'Ce que les banques détiennent aujourd’hui.', 'What the banks hold today.')}
      >
        {cash(outlook.opening)}
      </StatusItem>
      {figures.gaps === 0 ? null : (
        <StatusItem
          icon={Scale}
          tone="warning"
          title={tr(
            `البنك ناقص الدفتر، على ${fmt.integer(figures.gaps, lang)} حسابًا مختلفًا.`,
            `Banque moins livre, sur ${fmt.integer(figures.gaps, lang)} compte(s) en désaccord.`,
            `Bank less book, over ${fmt.integer(figures.gaps, lang)} account(s) that disagree.`,
          )}
        >
          {cash(outlook.gap)}
        </StatusItem>
      )}
      <StatusItem
        icon={tone === 'success' ? TrendingUp : TrendingDown}
        tone={tone}
        title={tr(
          'الرصيد ناقص ما يخرج زائد ما يدخل، في نهاية الأفق.',
          'Le solde moins les sorties plus les entrées, en fin d’horizon.',
          'The balance less what leaves plus what arrives, at the end of the horizon.',
        )}
      >
        {cash(outlook.closing)}
      </StatusItem>
    </>
  );
}
interface StatusProps extends ScopeProps {
  readonly figures: Liquidity;
  readonly outlook: Forecast;
  readonly unpriced: boolean;
  readonly bounded: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

export function TreasuryStatus(props: StatusProps) {
  const { tr, lang } = useLocale();
  return (
    <>
      <ScopeItems
        lens={props.lens}
        horizon={props.horizon}
        today={props.today}
        rates={props.rates}
        printed={props.printed}
        hidden={props.hidden}
      />
      <ShapeItems figures={props.figures} outlook={props.outlook} />
      {props.unpriced ? (
        <StatusItem
          icon={CircleHelp}
          tone="warning"
          title={tr(
            'مبالغ بالريال ولا سعر مسجَّل للزوج: كل مجموع يجمع العملتين تُرك دون ذكر.',
            'Des montants en riyals et aucun taux enregistré : tout total mêlant les deux monnaies est laissé sans énoncé.',
            'Riyal amounts with no rate on record, so every total that mixes the two currencies is left unstated.',
          )}
        >
          {tr('ريالات بلا سعر', 'Riyals non valorisés', 'Riyals unpriced')}
        </StatusItem>
      ) : null}
      {props.bounded ? (
        <StatusItem
          icon={Gauge}
          tone="warning"
          title={tr(
            'صفحة وصلت إلى سقفها، فما بعدها لم يُقرأ وكل رقم أعلاه حدّ أدنى.',
            'Une page a atteint son plafond : la suite n’a pas été lue, chaque nombre ci-dessus est un minorant.',
            'A page came back at its ceiling, so what follows it was never read and every figure above is a floor.',
          )}
        >
          {tr('حدّ أدنى', 'Minorant', 'Lower bound')}
        </StatusItem>
      ) : null}
      {props.error === null ? null : (
        <StatusItem icon={ShieldAlert} tone="danger" title={props.error}>
          {tr('تعذّرت القراءة', 'Lecture impossible', 'Read failed')}
        </StatusItem>
      )}
      {props.fetchedAt === null ? null : (
        <StatusItem icon={Clock} title={tr('آخر قراءة', 'Dernière lecture', 'Last read')}>
          {fmt.relativeTime(props.fetchedAt, lang)}
        </StatusItem>
      )}
    </>
  );
}
/* ------------------------------------------------------------------ *
 * Row context menu
 * ------------------------------------------------------------------ *
 * Three entries, and the two hand-offs are greyed rather than gone on a row that cannot
 * use them: a menu that changes shape between rows is a menu whose last entry gets clicked
 * by accident. None of the three touches the book, so none asks for confirmation — the
 * worst any of them can do is open a window or fill the clipboard.
 */

interface RowMenuProps {
  readonly x: number;
  readonly y: number;
  readonly row: CashRow;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}

export function RowMenu({ x, y, row, onSelect, onDismiss }: RowMenuProps) {
  const { t, tr } = useLocale();
  const entries: readonly MenuEntry[] = [
    { id: 'header', kind: 'header', label: `${row.title} — ${t(LENS_LABEL[row.lens])}` },
    {
      id: 'ledger',
      label: tr('فتح الحساب في الدفتر', 'Ouvrir le compte dans le grand livre', 'Open the account in the ledger'),
      icon: ExternalLink,
      disabled: row.accountId === null,
    },
    {
      id: 'reconcile',
      label: tr('فتح المطابقة', 'Ouvrir le rapprochement', 'Open reconciliation'),
      icon: Scale,
      disabled: row.position === null,
    },
    {
      id: 'copyRow',
      label: tr('نسخ السطر', 'Copier la ligne', 'Copy this row'),
      icon: Copy,
    },
  ];
  return <MenuFlyout x={x} y={y} entries={entries} onSelect={onSelect} onDismiss={onDismiss} minWidth={300} />;
}



















