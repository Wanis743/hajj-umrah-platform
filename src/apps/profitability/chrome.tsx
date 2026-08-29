/**
 * Profitability — the chrome.
 *
 * The rail holds the question, the grid holds the answer, and one figure outranks
 * both: coverage. A margin per package is arithmetic over the postings that carry a
 * package tag, and the postings that carry none are not missing from the book — they
 * are missing from the report. So the share of the ledger this window can actually
 * see is printed beside the totals, repeated in the status bar, travels in every
 * export, and is said in words when it is low.
 *
 * Two dimensions, and only two, because `package_id` and `branch_id` are the only
 * allocation tags the projections carry on money. Per-departure margin is not a
 * greyed-out control waiting for a better query: nothing an app can read joins a
 * departure to an amount, so the rail says so in a sentence rather than implying it
 * with a disabled tab.
 *
 * Nothing here writes to the book, so nothing greys out to protect it. A control is
 * disabled only when it has nothing to act on, and when it is, the pane says why —
 * the comparison picker on the whole-book basis is not broken, it is meaningless,
 * because an inception-to-date figure has no period before it.
 */
import type { Ref } from 'react';
import {
  AlertTriangle,
  Boxes,
  Building2,
  CalendarRange,
  ChartPie,
  CircleHelp,
  Clock,
  Copy,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  Filter,
  Gauge,
  Landmark,
  Layers,
  Percent,
  RefreshCw,
  ShieldAlert,
  Sigma,
  Tags,
  TrendingDown,
  TrendingUp,
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
  useLocale,
} from '@/platform/sdk';
import { type Basis, type FiscalPeriod, PERIOD_STATUS_LABEL } from '../shared/ledger';
import type { ProfitabilityBusy } from './actions';
import {
  concentration,
  coverageTone,
  type Dimension,
  laggard,
  leader,
  type MemberFigure,
  type Slice,
  type Sort,
} from './figures';
import { DIMENSION_LABEL, DIMENSION_UNIT, type Question, SORT_LABEL } from './question';

type Translate = (ar: string, fr: string, en: string) => string;

/** A period as one string: what it is called, and the dates that settles. */
const periodName = (period: FiscalPeriod, tr: Translate): string =>
  `${period.label === '' ? tr('بلا اسم', 'Sans nom', 'Untitled') : period.label} · ${period.start} → ${period.end}`;

/**
 * The window, short enough to sit in a status bar beside six other facts.
 *
 * The coverage grade this file paints with is `coverageTone`, which lives beside the
 * arithmetic in `figures` so the badge, the status bar and the pane cannot disagree
 * about what "well covered" means.
 */
const periodSpan = (period: FiscalPeriod | null, tr: Translate): string =>
  period === null ? tr('لا فترة', 'Aucune période', 'No period') : `${period.start} → ${period.end}`;

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ *
 * The dimension comes first, because which one is on screen is the identity of the
 * window rather than a setting inside it: "margin by package" and "margin by branch"
 * are two reports that happen to share a grid.
 *
 * Then the one control that leaves — opening an account in the ledger, which is where
 * a figure somebody disbelieves is settled. There is no Save and no Open, because this
 * window owns no document: the question is two clicks to restate and a saved copy of
 * it would only go stale against a book that moves.
 */

interface ToolbarProps {
  readonly dimension: Dimension;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: ProfitabilityBusy;
  readonly loading: boolean;
  /** Members that did nothing this window are in the grid. */
  readonly showSilent: boolean;
  /** A member is selected and carries at least one account, so the ledger has a target. */
  readonly canDrill: boolean;
  onSearch: (next: string) => void;
  onSilent: (next: boolean) => void;
  onCommand: (id: string) => void;
}

export function ProfitabilityToolbar(props: ToolbarProps) {
  const { tr } = useLocale();
  const { busy, onCommand } = props;
  const working = busy !== null;
  const dimensions: readonly { value: Dimension; label: string; icon: typeof Boxes }[] = [
    { value: 'package', label: tr('الباقات', 'Forfaits', 'Packages'), icon: Boxes },
    { value: 'branch', label: tr('الفروع', 'Succursales', 'Branches'), icon: Building2 },
  ];

  return (
    <div className="fx-commandbar">
      <Segmented
        value={props.dimension}
        onChange={(next) => onCommand(`dimension:${next}`)}
        options={dimensions}
      />
      <ToolbarSeparator />
      <Button
        icon={ExternalLink}
        variant="accent"
        disabled={!props.canDrill}
        onClick={() => onCommand('ledger')}
        title={tr(
          'فتح أكبر حساب في العضو المحدَّد داخل الدفتر',
          'Ouvrir dans le grand livre le plus gros compte du membre sélectionné',
          'Open the selected member’s largest account in the ledger',
        )}
      >
        {tr('الدفتر', 'Grand livre', 'Ledger')}
      </Button>
      <ToolbarSpacer />
      <IconButton
        icon={props.showSilent ? Eye : EyeOff}
        label={tr(
          'إظهار الأعضاء بلا حركة في هذه النافذة',
          'Afficher les membres sans mouvement sur cette fenêtre',
          'Show members with no movement in this window',
        )}
        active={props.showSilent}
        onClick={() => props.onSilent(!props.showSilent)}
      />
      <SearchBox
        ref={props.searchRef}
        value={props.search}
        onChange={props.onSearch}
        width={210}
        placeholder={tr('بحث في الأعضاء', 'Rechercher un membre', 'Search the members')}
      />
      <Button
        icon={Copy}
        disabled={working}
        onClick={() => onCommand('copy')}
        title={tr(
          'نسخ التقرير مع تغطيته (Ctrl+Shift+C)',
          'Copier le rapport avec sa couverture (Ctrl+Maj+C)',
          'Copy this report with its coverage (Ctrl+Shift+C)',
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
 * Read top to bottom the pane is a sentence: this dimension, on this basis, over this
 * window, against this comparison, ranked this way. Every control in it changes what
 * the figures *mean*; the two that only hide rows live in the toolbar, next to the grid
 * they act on.
 *
 * Underneath it, the figures — and coverage among them rather than beneath them.
 */

interface LineProps {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
  readonly danger?: boolean;
  readonly title?: string;
}

/** A label and a figure on one row. The figure is `fx-num`, so a column of them lines up. */
function RailLine({ label, value, strong = false, danger = false, title }: LineProps) {
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
          color: danger ? 'var(--fx-danger)' : undefined,
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
interface QuestionProps {
  readonly question: Question;
  readonly periods: readonly FiscalPeriod[];
  /** The window in force, which may be a month the app synthesised. */
  readonly period: FiscalPeriod | null;
  onBasis: (next: Basis) => void;
  onPeriod: (id: string | null) => void;
  onCompare: (next: boolean) => void;
  onSort: (next: Sort) => void;
}

/**
 * The four controls that decide what the figures mean.
 *
 * The basis is offered without a recommendation and without a warning, because here —
 * unlike the statements window — neither one is complete: no derive carries an
 * analytical tag, so both bases walk the same page of entries and both are a floor.
 * "Whole book" costs exactly what "period" costs, and answers a different question.
 */
function QuestionBlock(props: QuestionProps) {
  const { t, tr } = useLocale();
  const { period, question } = props;
  const windowed = question.basis === 'period';
  const bases: readonly { value: Basis; label: string; icon: typeof Landmark }[] = [
    { value: 'book', label: tr('الدفتر', 'Livre', 'Book'), icon: Landmark },
    { value: 'period', label: tr('فترة', 'Période', 'Period'), icon: CalendarRange },
  ];
  const sorts: readonly { value: Sort; label: string }[] = [
    { value: 'margin', label: t(SORT_LABEL.margin) },
    { value: 'revenue', label: t(SORT_LABEL.revenue) },
    { value: 'name', label: t(SORT_LABEL.name) },
  ];
  // A synthetic month carries no id, so the empty string is what "whichever is newest"
  // is called going in and coming out.
  const auto =
    props.periods.length > 0
      ? tr('الأحدث', 'La plus récente', 'Newest')
      : period === null
        ? tr('لا فترة', 'Aucune période', 'No period')
        : period.label;
  const options = [
    { value: '', label: auto },
    ...props.periods.map((row) => ({ value: row.id, label: periodName(row, tr) })),
  ];
  const comparisons = [
    { value: 'off', label: tr('بدون', 'Aucune', 'None') },
    { value: 'on', label: tr('الفترة السابقة', 'Période précédente', 'Previous period') },
  ];
  return (
    <div style={{ display: 'grid', gap: 12, padding: '0 10px 12px' }}>
      <Field
        label={tr('الأساس', 'Base', 'Basis')}
        hint={
          windowed
            ? tr(
                'الهامش على فترة، وهو ما يُسأل عنه عادةً.',
                'La marge sur une période, ce qui est la question habituelle.',
                'Margin over a stretch of time, which is the usual question.',
              )
            : tr(
                'كل ما تحمله الصفحة من قيود مُرحَّلة، دون نافذة.',
                'Toutes les écritures comptabilisées de la page, sans fenêtre.',
                'Every posted entry the page carries, with no window applied.',
              )
        }
      >
        <Segmented value={question.basis} onChange={props.onBasis} options={bases} size="sm" />
      </Field>
      <Field
        label={tr('النافذة', 'Fenêtre', 'Window')}
        hint={
          windowed
            ? tr(
                'الفترة التي تُقاس عليها الأرقام.',
                'La période sur laquelle les nombres sont mesurés.',
                'The period the figures are measured over.',
              )
            : tr(
                'لا نافذة على أساس الدفتر.',
                'Aucune fenêtre sur la base « livre ».',
                'No window applies on the whole-book basis.',
              )
        }
      >
        <Select
          value={question.periodId ?? ''}
          onChange={(next) => props.onPeriod(next === '' ? null : next)}
          options={options}
          disabled={!windowed}
        />
      </Field>
      <Field
        label={tr('المقارنة', 'Comparaison', 'Comparison')}
        hint={
          windowed
            ? tr(
                'هامش الفترة التي تسبقها مباشرة، عمودًا إلى جانب هذه.',
                'La marge de la période qui précède, en colonne à côté de celle-ci.',
                'The margin of the period immediately before, as a column beside this one.',
              )
            : tr(
                'رصيد من بداية الدفتر لا شيء قبله يُقارن به.',
                'Un solde depuis l’origine n’a rien avant lui à comparer.',
                'An inception-to-date figure has nothing before it to compare against.',
              )
        }
      >
        <Select
          value={question.compare ? 'on' : 'off'}
          onChange={(next) => props.onCompare(next === 'on')}
          options={comparisons}
          disabled={!windowed}
        />
      </Field>
      <Field
        label={tr('الترتيب', 'Classement', 'Ranking')}
        hint={tr(
          'غير المخصَّص يُلحَق دائمًا في الأسفل: هو ليس منافسًا في الترتيب.',
          'Le non affecté est toujours ajouté en bas : il ne concourt pas au classement.',
          'The unallocated remainder is always appended last — it is not competing in the ranking.',
        )}
      >
        <Segmented value={question.sort} onChange={props.onSort} options={sorts} size="sm" />
      </Field>
    </div>
  );
}
interface ReadProps {
  readonly dimension: Dimension;
  readonly basis: Basis;
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  readonly bounded: boolean;
  /** Members nothing could put a name to, printed by the stem of their id. */
  readonly unnamed: number;
}

/**
 * What was actually read, and what that costs the reader.
 *
 * Four sentences can appear under the dates, and each of them is a limit somebody would
 * otherwise discover by reconciling this report against the income statement by hand:
 * the window was synthesised, the page hit its ceiling, some members could not be
 * named, and no finer dimension than these two exists to slice by.
 */
function ReadBlock(props: ReadProps) {
  const { t, tr, lang } = useLocale();
  const { dimension, period } = props;
  const windowed = props.basis === 'period';
  return (
    <div style={{ display: 'grid', gap: 6, padding: '0 10px 12px' }}>
      <RailLine
        label={tr('النافذة', 'Fenêtre', 'Window')}
        value={windowed ? periodSpan(period, tr) : tr('كل التواريخ', 'Toutes dates', 'All dates')}
      />
      {windowed && period !== null && period.id !== '' ? (
        <RailLine label={tr('الحالة', 'État', 'Status')} value={t(PERIOD_STATUS_LABEL[period.status])} />
      ) : null}
      {props.comparison === null ? null : (
        <RailLine label={tr('مقابل', 'Face à', 'Against')} value={periodSpan(props.comparison, tr)} />
      )}
      {windowed && period !== null && period.id === '' ? (
        <RailNote tone="var(--fx-text-tertiary)">
          {tr(
            'لا فترات محاسبية في الدفتر: النافذة هي شهر آخر قيد.',
            'Aucune période comptable dans le livre : la fenêtre est le mois de la dernière écriture.',
            'The book keeps no fiscal periods, so the window is the month of the newest entry.',
          )}
        </RailNote>
      ) : null}
      {props.bounded ? (
        <RailNote tone="var(--fx-warning)">
          {tr(
            'صفحة وصلت إلى سقفها: كل رقم أدناه حدّ أدنى.',
            'Une page a atteint son plafond : chaque nombre ci-dessous est un minorant.',
            'A page came back full, so every figure below is a lower bound.',
          )}
        </RailNote>
      ) : null}
      {props.unnamed === 0 ? null : (
        <RailNote tone="var(--fx-text-tertiary)">
          {dimension === 'package'
            ? tr(
                `${fmt.integer(props.unnamed, lang)} باقة لا رحلة مسجَّلة عليها، فتُطبَع بمعرّفها.`,
                `${fmt.integer(props.unnamed, lang)} forfait(s) sans départ enregistré : imprimés par leur identifiant.`,
                `${fmt.integer(props.unnamed, lang)} package(s) have no departure booked against them, so they print by id.`,
              )
            : tr(
                'لا مصدر لأسماء الفروع، فتُطبَع ببداية معرّفها.',
                'Aucune source ne nomme les succursales : elles sont imprimées par le début de leur identifiant.',
                'Nothing exposed to an app names a branch, so they print by the stem of their id.',
              )}
        </RailNote>
      )}
      <RailNote tone="var(--fx-text-tertiary)">
        {tr(
          'الباقة والفرع هما الوسمان الوحيدان على المال؛ لا يمكن حساب هامش لكل رحلة.',
          'Forfait et succursale sont les seules affectations portées par les montants : aucune marge par départ n’est calculable.',
          'Package and branch are the only tags money carries, so a margin per departure is not calculable.',
        )}
      </RailNote>
    </div>
  );
}
/**
 * The figures, in the order they have to be read in.
 *
 * Revenue, cost, margin — then immediately how much of the book that margin rests on,
 * because the two numbers underneath it are the ones that decide whether the three
 * above it mean anything. `totals` counts everything the window saw and `allocated`
 * counts only what carried a tag; printing both is the only way a reader can see the
 * gap without doing the subtraction themselves.
 *
 * Every figure here is summed over every member, so nothing in this pane moves while
 * somebody is typing in the search box.
 */
function FigureBlock({ dimension, slice }: { readonly dimension: Dimension; readonly slice: Slice }) {
  const { t, tr, lang } = useLocale();
  const cash = (value: number) => fmt.money(value, 'DZD', lang);
  const share = (value: number | null) =>
    value === null ? tr('لا ينطبق', 'S. O.', 'n/a') : fmt.percent(value, lang, 1);
  const best = leader(slice);
  const worst = laggard(slice);
  const top = concentration(slice);
  return (
    <div style={{ display: 'grid', gap: 6, padding: '0 10px 12px' }}>
      <RailLine label={tr('الإيرادات', 'Produits', 'Revenue')} value={cash(slice.totals.revenue)} />
      <RailLine label={tr('التكاليف', 'Charges', 'Cost')} value={cash(slice.totals.cost)} />
      <RailLine
        label={tr('الهامش', 'Marge', 'Margin')}
        value={cash(slice.totals.margin)}
        strong
        danger={slice.totals.margin < 0}
      />
      <RailLine
        label={tr('نسبة الهامش', 'Taux de marge', 'Margin rate')}
        value={share(slice.totals.rate)}
        title={tr('الهامش على الإيرادات.', 'Marge rapportée aux produits.', 'Margin over revenue.')}
      />
      <RailLine
        label={tr('التغطية', 'Couverture', 'Coverage')}
        value={share(slice.coverage)}
        strong
        danger={slice.coverage !== null && coverageTone(slice.coverage) === 'danger'}
        title={tr(
          'الحركة الموسومة على كل الحركة. ما دونها لا يمكن نسبته إلى أحد.',
          'L’activité affectée rapportée à toute l’activité. Le reste n’est attribuable à personne.',
          'Tagged activity over all activity. The rest cannot be attributed to anybody.',
        )}
      />
      <RailLine
        label={tr('هامش موسوم', 'Marge affectée', 'Allocated margin')}
        value={cash(slice.allocated.margin)}
        title={tr(
          'الأعضاء وحدهم، دون البقية غير المخصَّصة.',
          'Les membres seuls, sans le reste non affecté.',
          'The members alone, without the unallocated remainder.',
        )}
      />
      {slice.untagged === null ? null : (
        <RailLine
          label={tr('غير مخصَّص', 'Non affecté', 'Unallocated')}
          value={cash(slice.untagged.margin)}
          danger={slice.untagged.margin < 0}
          title={tr(
            'قيود لا تحمل وسمًا: تُطبَع كسطر ولا تُوزَّع على الأعضاء.',
            'Des écritures sans affectation : imprimées sur une ligne, jamais réparties sur les membres.',
            'Postings that carry no tag: printed as a row, never spread across the members.',
          )}
        />
      )}
      <RailLine
        label={tr('التركّز', 'Concentration', 'Concentration')}
        value={share(top)}
        title={tr(
          'حصة الأعلى من الهامش الموسوم.',
          'Part du meilleur dans la marge affectée.',
          'The leader’s share of the allocated margin.',
        )}
      />
      <RailLine label={t(DIMENSION_UNIT[dimension])} value={fmt.integer(slice.members.length, lang)} />
      <RailLine label={tr('قيود', 'Écritures', 'Postings')} value={fmt.integer(slice.lines, lang)} />
      {best === null ? null : (
        <RailLine
          label={`${tr('الأعلى', 'Meilleur', 'Best')} · ${best.label}`}
          value={cash(best.margin)}
        />
      )}
      {worst === null ? null : (
        <RailLine
          label={`${tr('الأدنى', 'Pire', 'Worst')} · ${worst.label}`}
          value={cash(worst.margin)}
          danger
        />
      )}
    </div>
  );
}
interface RailProps {
  readonly question: Question;
  readonly slice: Slice;
  readonly periods: readonly FiscalPeriod[];
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  readonly bounded: boolean;
  readonly unnamed: number;
  readonly busy: ProfitabilityBusy;
  onBasis: (next: Basis) => void;
  onPeriod: (id: string | null) => void;
  onCompare: (next: boolean) => void;
  onSort: (next: Sort) => void;
  onCommand: (id: string) => void;
}

/**
 * The pane, and the one badge it is worth trusting at a glance.
 *
 * The badge grades coverage rather than margin, because a bad margin is news and a bad
 * coverage is a warning about the news. A report that covers half the book is not half
 * a report — it is a report about a different, smaller business than the one whose name
 * is on the window.
 */
export function ProfitabilityRail(props: RailProps) {
  const { tr, lang } = useLocale();
  const { question, slice } = props;
  const coverage = slice.coverage;
  return (
    <>
      <NavGroupLabel>{tr('السؤال', 'La question', 'The question')}</NavGroupLabel>
      <QuestionBlock
        question={question}
        periods={props.periods}
        period={props.period}
        onBasis={props.onBasis}
        onPeriod={props.onPeriod}
        onCompare={props.onCompare}
        onSort={props.onSort}
      />

      <NavGroupLabel>{tr('ما قُرئ', 'Ce qui a été lu', 'What was read')}</NavGroupLabel>
      <ReadBlock
        dimension={question.dimension}
        basis={question.basis}
        period={props.period}
        comparison={props.comparison}
        bounded={props.bounded}
        unnamed={props.unnamed}
      />

      <NavGroupLabel>{tr('الأرقام', 'Les nombres', 'The figures')}</NavGroupLabel>
      <FigureBlock dimension={question.dimension} slice={slice} />
      <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
        {coverage === null ? (
          <Badge
            tone="neutral"
            icon={CircleHelp}
            title={tr(
              'لا إيرادات ولا تكاليف في هذه النافذة.',
              'Aucun produit ni charge sur cette fenêtre.',
              'No revenue and no cost in this window.',
            )}
          >
            {tr('لا حركة', 'Aucun mouvement', 'No activity')}
          </Badge>
        ) : (
          <Badge
            tone={coverageTone(coverage)}
            icon={coverageTone(coverage) === 'success' ? ChartPie : AlertTriangle}
            title={tr(
              'الأرقام أعلاه تخصّ هذا الجزء من الدفتر فقط.',
              'Les nombres ci-dessus ne concernent que cette part du livre.',
              'The figures above describe this share of the book and no more.',
            )}
          >
            {tr(
              `التغطية ${fmt.percent(coverage, lang, 1)}`,
              `Couverture ${fmt.percent(coverage, lang, 1)}`,
              `Coverage ${fmt.percent(coverage, lang, 1)}`,
            )}
          </Badge>
        )}
        <Button
          icon={FileDown}
          block
          busy={props.busy === 'export'}
          disabled={props.busy !== null}
          onClick={() => props.onCommand('export')}
          title={tr(
            'كل سطر في الملف يحمل الأساس والنافذة والتغطية.',
            'Chaque ligne du fichier porte la base, la fenêtre et la couverture.',
            'Every row in the file carries the basis, the window and the coverage.',
          )}
        >
          {tr('تصدير الجدول', 'Exporter le tableau', 'Export the table')}
        </Button>
        <Button icon={Copy} block variant="subtle" onClick={() => props.onCommand('copy')}>
          {tr('نسخ التقرير', 'Copier le rapport', 'Copy the report')}
        </Button>
      </div>
    </>
  );
}
/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ *
 * The dimension, the window and the coverage are restated here even though the rail
 * already shows all three, because the status bar is what a screenshot keeps. "The
 * Ramadan package made 400 000" is a sentence somebody will repeat in a meeting, and
 * the only defence against it being false is that the picture it came from said, on its
 * own bottom edge, by what and over what and over how much of the book.
 */

interface ScopeProps {
  readonly dimension: Dimension;
  readonly basis: Basis;
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  /** Member rows printed, and member rows the filter is holding back. */
  readonly printed: number;
  readonly hidden: number;
  readonly postings: number;
}

/** By what, over what, against what, and how much of it is on screen. */
function ScopeItems(props: ScopeProps) {
  const { t, tr, lang } = useLocale();
  const { dimension } = props;
  const windowed = props.basis === 'period';
  return (
    <>
      <StatusItem
        icon={dimension === 'package' ? Boxes : Building2}
        title={tr(
          'البُعد الذي جُمعت عليه الأرقام.',
          'La dimension sur laquelle les nombres sont agrégés.',
          'The dimension the figures were summed over.',
        )}
      >
        {t(DIMENSION_LABEL[dimension])}
      </StatusItem>
      <StatusItem
        icon={windowed ? CalendarRange : Landmark}
        title={tr(
          'كل رقم محسوب في التطبيق من صفحة قيود، على هذا المدى.',
          'Chaque nombre est calculé dans l’application depuis une page d’écritures, sur cette étendue.',
          'Every figure is computed in the app from a page of entries, over this stretch.',
        )}
      >
        {windowed ? periodSpan(props.period, tr) : tr('الدفتر بالكامل', 'Livre entier', 'Whole book')}
      </StatusItem>
      {props.comparison === null ? null : (
        <StatusItem
          icon={Layers}
          title={tr(
            'عمود المقارنة يقرأ هذه الفترة.',
            'La colonne de comparaison lit cette période.',
            'The comparison column reads this period.',
          )}
        >
          {periodSpan(props.comparison, tr)}
        </StatusItem>
      )}
      <StatusItem
        icon={Tags}
        title={tr('سطور مطبوعة في الجدول.', 'Lignes imprimées dans le tableau.', 'Rows printed in the table.')}
      >
        {`${fmt.integer(props.printed, lang)} ${t(DIMENSION_UNIT[dimension])}`}
      </StatusItem>
      {props.hidden === 0 ? null : (
        <StatusItem
          icon={Filter}
          title={tr(
            'سطور أخفاها البحث أو مرشّح السكون. كل مجموع لا يزال يحتسبها.',
            'Lignes masquées par la recherche ou le filtre d’inactivité. Chaque total les compte encore.',
            'Rows hidden by the search box or the silence filter. Every total still counts them.',
          )}
        >
          {tr(
            `${fmt.integer(props.hidden, lang)} مُخفى`,
            `${fmt.integer(props.hidden, lang)} masqués`,
            `${fmt.integer(props.hidden, lang)} hidden`,
          )}
        </StatusItem>
      )}
      <StatusItem
        icon={Sigma}
        title={tr(
          'القيود التي أثبتت هذه الأرقام.',
          'Les écritures qui prouvent ces nombres.',
          'The postings these figures were proven from.',
        )}
      >
        {`${fmt.integer(props.postings, lang)} ${tr('قيد', 'écritures', 'postings')}`}
      </StatusItem>
    </>
  );
}
/**
 * What the report says, in four figures.
 *
 * The margin is the bottom line and wears the colour. Coverage sits beside it wearing a
 * colour of its own, because it is the figure that decides how much the first one is
 * worth — and it is graded rather than merely printed, so a report over two thirds of a
 * book cannot be mistaken for one over all of it at a glance.
 */
function ShapeItems({ slice }: { readonly slice: Slice }) {
  const { tr, lang } = useLocale();
  const { margin, rate } = slice.totals;
  const top = concentration(slice);
  return (
    <>
      <StatusItem
        icon={margin < 0 ? TrendingDown : TrendingUp}
        tone={margin < 0 ? 'danger' : 'success'}
        title={tr('الإيرادات ناقص التكاليف.', 'Produits moins charges.', 'Revenue less cost.')}
      >
        {fmt.money(margin, 'DZD', lang)}
      </StatusItem>
      {rate === null ? null : (
        <StatusItem
          icon={Percent}
          title={tr('الهامش على الإيرادات.', 'Marge sur produits.', 'Margin over revenue.')}
        >
          {fmt.percent(rate, lang, 1)}
        </StatusItem>
      )}
      {slice.coverage === null ? null : (
        <StatusItem
          icon={ChartPie}
          tone={coverageTone(slice.coverage)}
          title={tr(
            'حصة الدفتر التي تحمل وسمًا في هذا البُعد. الباقي لا يُنسب إلى أحد.',
            'La part du livre portant une affectation sur cette dimension. Le reste n’est attribué à personne.',
            'The share of the book that carries a tag on this dimension. The rest is attributed to nobody.',
          )}
        >
          {fmt.percent(slice.coverage, lang, 1)}
        </StatusItem>
      )}
      {top === null ? null : (
        <StatusItem
          icon={Crosshair}
          title={tr(
            'حصة الأعلى من الهامش الموسوم.',
            'Part du meilleur dans la marge affectée.',
            'The leader’s share of the allocated margin.',
          )}
        >
          {fmt.percent(top, lang, 1)}
        </StatusItem>
      )}
    </>
  );
}
interface StatusProps extends ScopeProps {
  readonly slice: Slice;
  readonly unnamed: number;
  readonly bounded: boolean;
  readonly coveredFrom: string | null;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

export function ProfitabilityStatus(props: StatusProps) {
  const { tr, lang } = useLocale();
  return (
    <>
      <ScopeItems
        dimension={props.dimension}
        basis={props.basis}
        period={props.period}
        comparison={props.comparison}
        printed={props.printed}
        hidden={props.hidden}
        postings={props.postings}
      />
      <ShapeItems slice={props.slice} />
      {props.unnamed === 0 ? null : (
        <StatusItem
          icon={CircleHelp}
          title={tr(
            'لا شيء متاح للتطبيق يسمّي هؤلاء، فتُطبَع بداية معرّفهم.',
            'Rien d’accessible à l’application ne les nomme : le début de leur identifiant est imprimé.',
            'Nothing exposed to an app names these, so the stem of their id is printed instead.',
          )}
        >
          {tr(
            `${fmt.integer(props.unnamed, lang)} بلا اسم`,
            `${fmt.integer(props.unnamed, lang)} sans nom`,
            `${fmt.integer(props.unnamed, lang)} unnamed`,
          )}
        </StatusItem>
      )}
      {props.bounded ? (
        <StatusItem
          icon={Gauge}
          tone="warning"
          title={tr(
            'صفحة قيود أو سطور وصلت إلى سقفها: أقدم القيود لم تُقرأ، فكل هامش أعلاه حدّ أدنى.',
            'Une page d’écritures ou de lignes a atteint son plafond : les plus anciennes n’ont pas été lues, chaque marge ci-dessus est un minorant.',
            'An entry or posting page came back at its ceiling: the oldest postings were never read, so every margin above is a floor.',
          )}
        >
          {props.coveredFrom === null
            ? tr('حدّ أدنى', 'Minorant', 'Lower bound')
            : tr(
                `مُثبَت من ${props.coveredFrom}`,
                `Prouvé depuis ${props.coveredFrom}`,
                `Proven from ${props.coveredFrom}`,
              )}
        </StatusItem>
      ) : null}
      {props.error === null ? null : (
        <StatusItem icon={ShieldAlert} tone="danger" title={props.error}>
          {tr('تعذّرت القراءة', 'Lecture impossible', 'Read failed')}
        </StatusItem>
      )}
      {props.fetchedAt === null ? null : (
        <StatusItem icon={Clock} title={tr('آخر قراءة للدفتر', 'Dernière lecture du livre', 'Book last read')}>
          {fmt.relativeTime(props.fetchedAt, lang)}
        </StatusItem>
      )}
    </>
  );
}
/* ------------------------------------------------------------------ *
 * Row context menu
 * ------------------------------------------------------------------ *
 * Two entries, and the first is greyed rather than gone on a row with no accounts behind
 * it: a menu that changes shape between rows is a menu whose second entry gets clicked by
 * accident. Neither entry touches the book, so neither asks for confirmation — the worst
 * either can do is open a window or fill the clipboard.
 */

interface RowMenuProps {
  readonly x: number;
  readonly y: number;
  readonly row: MemberFigure;
  readonly dimension: Dimension;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}

export function RowMenu({ x, y, row, dimension, onSelect, onDismiss }: RowMenuProps) {
  const { t, tr } = useLocale();
  const entries: readonly MenuEntry[] = [
    { id: 'header', kind: 'header', label: `${row.label} — ${t(DIMENSION_LABEL[dimension])}` },
    {
      id: 'ledger',
      label: tr('فتح أكبر حساب في الدفتر', 'Ouvrir le plus gros compte', 'Open the largest account'),
      icon: ExternalLink,
      disabled: row.accounts.length === 0,
    },
    {
      id: 'copyRow',
      label: tr('نسخ السطر', 'Copier la ligne', 'Copy this row'),
      icon: Copy,
      accelerator: 'Ctrl+Shift+C',
    },
  ];
  return <MenuFlyout x={x} y={y} entries={entries} onSelect={onSelect} onDismiss={onDismiss} minWidth={280} />;
}


















