/**
 * Statements — the chrome.
 *
 * The rail holds the question and the grid holds nothing but the answer. Which statement, on
 * which basis, over which window, against which comparison: those four decide what every
 * figure on screen means, so they live in a permanent pane rather than behind a dialog, and
 * each one carries a sentence saying what it does.
 *
 * The basis is the honest control of this window. **Whole book** reads one aggregate the
 * kernel computed over every posted line, and it is complete. **Period** walks a page of
 * entries in the app, and it is a floor. Both are offered, neither hides behind the other,
 * and the status bar says which of them drew the numbers — because a balance sheet cropped
 * out of its window is a column of figures with no date attached.
 *
 * Nothing here writes to the book, so nothing greys out to protect it. A control is disabled
 * only when it has nothing to act on, and when it is, the pane says why in words: the
 * comparison picker on the whole-book basis is not broken, it is meaningless, since the
 * period before inception is the empty book.
 */
import type { Ref } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  Filter,
  FolderOpen,
  Gauge,
  Landmark,
  Layers,
  LineChart,
  Percent,
  RefreshCw,
  Save,
  Scale,
  ShieldAlert,
  Sigma,
  Table2,
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
import { EPSILON, type FiscalPeriod, PERIOD_STATUS_LABEL } from '../shared/ledger';
import type { StatementsBusy } from './actions';
import type { Basis } from './balances';
import type { SavedReport } from './document';
import { rowLabel, ROW_KIND_LABEL, type StatementRow, type StatementView, type Summary } from './statement';

type Translate = (ar: string, fr: string, en: string) => string;

/** A period as one string: what it is called, and the dates that settles. */
const periodName = (period: FiscalPeriod, tr: Translate): string =>
  `${period.label === '' ? tr('بلا اسم', 'Sans nom', 'Untitled') : period.label} · ${period.start} → ${period.end}`;

/** The window, short enough to sit in a status bar beside six other facts. */
const periodSpan = (period: FiscalPeriod | null, tr: Translate): string =>
  period === null ? tr('لا فترة', 'Aucune période', 'No period') : `${period.start} → ${period.end}`;

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ *
 * The three statements come first, because which one is on screen is the identity of the
 * window rather than a setting inside it. Then the one control that leaves: opening the
 * selected account in the ledger, which is where a figure somebody disbelieves is settled.
 *
 * Save and Open wear icons and no words. They are the document verbs every window in this OS
 * spells the same way, and the words would cost the room the search box needs.
 */

interface ToolbarProps {
  readonly view: StatementView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: StatementsBusy;
  readonly loading: boolean;
  /** Accounts that never moved are in the grid. */
  readonly showZero: boolean;
  /** An account row is selected, so there is something for the ledger to open. */
  readonly canDrill: boolean;
  onSearch: (next: string) => void;
  onZero: (next: boolean) => void;
  onCommand: (id: string) => void;
}

export function StatementsToolbar(props: ToolbarProps) {
  const { tr } = useLocale();
  const { busy, onCommand } = props;
  const working = busy !== null;
  const views: readonly { value: StatementView; label: string; icon: typeof LineChart }[] = [
    { value: 'income', label: tr('النتيجة', 'Résultat', 'Income'), icon: LineChart },
    { value: 'balance', label: tr('الميزانية', 'Bilan', 'Balance'), icon: Scale },
    { value: 'trial', label: tr('المراجعة', 'Balance générale', 'Trial'), icon: Table2 },
  ];

  return (
    <div className="fx-commandbar">
      <Segmented value={props.view} onChange={(next) => onCommand(`view:${next}`)} options={views} />
      <ToolbarSeparator />
      <Button
        icon={ExternalLink}
        variant="accent"
        disabled={!props.canDrill}
        onClick={() => onCommand('ledger')}
        title={tr(
          'فتح الحساب المحدَّد في الدفتر',
          'Ouvrir le compte sélectionné dans le grand livre',
          'Open the selected account in the ledger',
        )}
      >
        {tr('الدفتر', 'Grand livre', 'Ledger')}
      </Button>
      <ToolbarSpacer />
      <IconButton
        icon={props.showZero ? Eye : EyeOff}
        label={tr(
          'إظهار الحسابات بلا حركة',
          'Afficher les comptes sans mouvement',
          'Show accounts with no movement',
        )}
        active={props.showZero}
        onClick={() => props.onZero(!props.showZero)}
      />
      <SearchBox
        ref={props.searchRef}
        value={props.search}
        onChange={props.onSearch}
        width={210}
        placeholder={tr('بحث في السطور', 'Rechercher une ligne', 'Search the lines')}
      />
      <Button
        icon={Copy}
        disabled={working}
        onClick={() => onCommand('copy')}
        title={tr(
          'نسخ المعروض مع أساسه (Ctrl+Shift+C)',
          'Copier la vue avec sa base (Ctrl+Maj+C)',
          'Copy this view with its basis (Ctrl+Shift+C)',
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
        icon={Save}
        label={tr('حفظ السؤال (Ctrl+S)', 'Enregistrer la question (Ctrl+S)', 'Save the question (Ctrl+S)')}
        disabled={working}
        onClick={() => onCommand('save')}
      />
      <IconButton
        icon={FolderOpen}
        label={tr('فتح تقرير محفوظ (Ctrl+O)', 'Ouvrir un rapport (Ctrl+O)', 'Open a saved report (Ctrl+O)')}
        disabled={working}
        onClick={() => onCommand('open')}
      />
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
 * Read top to bottom this pane is a sentence: this statement, on this basis, over this
 * window, against this comparison. Every control in it changes what the figures *mean*
 * rather than which of them are shown — the two controls that only hide rows live in the
 * toolbar, next to the grid they act on.
 *
 * Underneath, the figures the whole book adds up to, and then the one line this window
 * exists to be trusted for: whether the book balances.
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

interface FigureProps {
  readonly view: StatementView;
  readonly summary: Summary;
  /** Postings the basis actually proved, which is not always `summary.lines`. */
  readonly postings: number;
}

/**
 * The headline figures, following the statement on screen.
 *
 * Over every account rather than the printed ones, so typing in the search box moves nothing
 * here. The last two rows are the evidence: how many accounts carry a posting, and how many
 * postings that is. A result drawn from four entries and one drawn from four thousand read
 * identically on the line above them.
 */
function FigureBlock({ view, summary, postings }: FigureProps) {
  const { tr, lang } = useLocale();
  const cash = (value: number) => fmt.money(value, 'DZD', lang);
  const gap = summary.debit - summary.credit;
  return (
    <div style={{ display: 'grid', gap: 6, padding: '0 10px 12px' }}>
      {view === 'trial' ? (
        <>
          <RailLine label={tr('مدين', 'Débit', 'Debit')} value={cash(summary.debit)} />
          <RailLine label={tr('دائن', 'Crédit', 'Credit')} value={cash(summary.credit)} />
          <RailLine
            label={tr('الفرق', 'Différence', 'Difference')}
            value={cash(gap)}
            strong
            danger={Math.abs(gap) >= EPSILON}
          />
        </>
      ) : view === 'balance' ? (
        <>
          <RailLine label={tr('الأصول', 'Actif', 'Assets')} value={cash(summary.assets)} />
          <RailLine label={tr('الخصوم', 'Passif', 'Liabilities')} value={cash(summary.liabilities)} />
          <RailLine label={tr('رأس المال', 'Capitaux propres', 'Equity')} value={cash(summary.equity)} />
          <RailLine label={tr('نتيجة الفترة', 'Résultat', 'Result')} value={cash(summary.result)} />
          <RailLine
            label={tr('فرق غير مفسَّر', 'Écart inexpliqué', 'Out of balance')}
            value={cash(summary.drift)}
            strong
            danger={!summary.balanced}
          />
        </>
      ) : (
        <>
          <RailLine label={tr('الإيرادات', 'Produits', 'Revenue')} value={cash(summary.revenue)} />
          <RailLine label={tr('التكاليف', 'Charges', 'Expenses')} value={cash(summary.expense)} />
          <RailLine
            label={tr('النتيجة', 'Résultat', 'Result')}
            value={cash(summary.result)}
            strong
            danger={summary.result < 0}
          />
          <RailLine
            label={tr('الهامش', 'Marge', 'Margin')}
            value={summary.margin === null ? tr('لا ينطبق', 'S. O.', 'n/a') : fmt.percent(summary.margin, lang, 1)}
            title={tr(
              'النتيجة على الإيرادات.',
              'Résultat rapporté aux produits.',
              'Result over revenue.',
            )}
          />
        </>
      )}
      <RailLine
        label={tr('حسابات بحركة', 'Comptes actifs', 'Accounts with activity')}
        value={fmt.integer(summary.accounts, lang)}
      />
      <RailLine label={tr('قيود', 'Écritures', 'Postings')} value={fmt.integer(postings, lang)} />
    </div>
  );
}

interface RailProps {
  readonly report: SavedReport;
  readonly periods: readonly FiscalPeriod[];
  /** The window in force, which may be a month the app synthesised. */
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  readonly summary: Summary;
  readonly postings: number;
  readonly bounded: boolean;
  readonly busy: StatementsBusy;
  onBasis: (next: Basis) => void;
  onPeriod: (id: string | null) => void;
  onCompare: (next: boolean) => void;
  onCommand: (id: string) => void;
}

export function ReportRail(props: RailProps) {
  const { t, tr } = useLocale();
  const { period, report, summary } = props;
  const walking = report.basis === 'period';
  const bases: readonly { value: Basis; label: string; icon: typeof Landmark }[] = [
    { value: 'book', label: tr('الدفتر', 'Livre', 'Book'), icon: Landmark },
    { value: 'period', label: tr('فترة', 'Période', 'Period'), icon: CalendarRange },
  ];
  // A synthetic month carries no id, so the empty string is what "whichever is newest" is
  // called going in and coming out. When the book keeps no periods at all, that option is
  // named after the month itself — a picker whose only entry says "Newest" tells nobody
  // which window they are reading.
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
    <>
      <NavGroupLabel>{tr('السؤال', 'La question', 'The question')}</NavGroupLabel>
      <div style={{ display: 'grid', gap: 12, padding: '0 10px 12px' }}>
        <Field
          label={tr('الأساس', 'Base', 'Basis')}
          hint={
            walking
              ? tr(
                  'صفحة قيود تُقرأ هنا وتُقصَر على النافذة. الأرقام حدّ أدنى.',
                  'Une page d’écritures lue ici puis restreinte à la fenêtre. Les nombres sont un minorant.',
                  'A page of entries read here and cut to the window. The figures are a lower bound.',
                )
              : tr(
                  'مجموع واحد على كل قيد مُرحَّل، من بداية الدفتر. كامل.',
                  'Un agrégat sur toutes les écritures comptabilisées, depuis l’origine. Complet.',
                  'One aggregate over every posted line, since inception. Complete.',
                )
          }
        >
          <Segmented value={report.basis} onChange={props.onBasis} options={bases} size="sm" />
        </Field>
        <Field
          label={tr('النافذة', 'Fenêtre', 'Window')}
          hint={
            walking
              ? tr(
                  'الفترة التي تُقاس عليها الأرقام.',
                  'La période sur laquelle les nombres sont mesurés.',
                  'The period the figures are measured over.',
                )
              : tr(
                  'الدفتر بالكامل يُقرأ، فلا نافذة تُطبَّق.',
                  'Le livre entier est lu : aucune fenêtre ne s’applique.',
                  'The whole book is read, so no window applies.',
                )
          }
        >
          <Select
            value={report.periodId ?? ''}
            onChange={(next) => props.onPeriod(next === '' ? null : next)}
            options={options}
            disabled={!walking}
          />
        </Field>
        <Field
          label={tr('المقارنة', 'Comparaison', 'Comparison')}
          hint={
            walking
              ? tr(
                  'الفترة التي تسبقها مباشرة. لا شيء إن كانت أقدم ما في الدفتر.',
                  'La période qui la précède immédiatement. Rien si c’est la plus ancienne du livre.',
                  'The period immediately before it. Nothing when it is the oldest the book has.',
                )
              : tr(
                  'رصيد من بداية الدفتر لا شيء قبله يُقارن به: الدفتر بدأ فارغًا.',
                  'Un solde depuis l’origine n’a rien avant lui : le livre a commencé vide.',
                  'An inception-to-date balance has nothing before it — the book started empty.',
                )
          }
        >
          <Select
            value={report.compare ? 'on' : 'off'}
            onChange={(next) => props.onCompare(next === 'on')}
            options={comparisons}
            disabled={!walking}
          />
        </Field>
      </div>

      <NavGroupLabel>{tr('ما قُرئ', 'Ce qui a été lu', 'What was read')}</NavGroupLabel>
      <div style={{ display: 'grid', gap: 6, padding: '0 10px 12px' }}>
        <RailLine
          label={tr('النافذة', 'Fenêtre', 'Window')}
          value={walking ? periodSpan(period, tr) : tr('كل التواريخ', 'Toutes dates', 'All dates')}
        />
        {walking && period !== null && period.id !== '' ? (
          <RailLine label={tr('الحالة', 'État', 'Status')} value={t(PERIOD_STATUS_LABEL[period.status])} />
        ) : null}
        {props.comparison === null ? null : (
          <RailLine label={tr('مقابل', 'Face à', 'Against')} value={periodSpan(props.comparison, tr)} />
        )}
        {walking && period !== null && period.id === '' ? (
          <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
            {tr(
              'لا فترات محاسبية في الدفتر: النافذة هي شهر آخر قيد.',
              'Aucune période comptable dans le livre : la fenêtre est le mois de la dernière écriture.',
              'The book keeps no fiscal periods, so the window is the month of the newest entry.',
            )}
          </span>
        ) : null}
        {props.bounded ? (
          <span style={{ color: 'var(--fx-warning)', fontSize: 'var(--fx-caption)' }}>
            {tr(
              'صفحة وصلت إلى سقفها: كل مجموع أعلاه حدّ أدنى.',
              'Une page a atteint son plafond : chaque total ci-dessus est un minorant.',
              'A page came back full, so every total above is a lower bound.',
            )}
          </span>
        ) : null}
      </div>

      <NavGroupLabel>{tr('الأرقام', 'Les nombres', 'The figures')}</NavGroupLabel>
      <FigureBlock view={report.view} summary={summary} postings={props.postings} />

      <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px' }}>
        {summary.balanced ? (
          <Badge
            tone="success"
            icon={Scale}
            title={tr(
              'الأصول تساوي الخصوم ورأس المال ونتيجة الفترة.',
              'L’actif égale le passif, les capitaux propres et le résultat.',
              'Assets equal liabilities plus equity plus the result.',
            )}
          >
            {tr('الدفتر متوازن', 'Le livre est équilibré', 'The book balances')}
          </Badge>
        ) : (
          <Badge
            tone="danger"
            icon={AlertTriangle}
            title={tr(
              'الفرق مطبوع في سطره الخاص أسفل الميزانية، لا مُوزَّعًا على الأقسام.',
              'L’écart est imprimé sur sa propre ligne au bas du bilan, il n’est pas réparti.',
              'The difference prints on its own line at the foot of the balance sheet rather than being spread.',
            )}
          >
            {tr('الدفتر غير متوازن', 'Le livre n’est pas équilibré', 'The book does not balance')}
          </Badge>
        )}
        <Button
          icon={Save}
          block
          busy={props.busy === 'save'}
          disabled={props.busy !== null}
          onClick={() => props.onCommand('save')}
          title={tr('حفظ السؤال لا الأرقام', 'Enregistrer la question, pas les nombres', 'Saves the question, not the figures')}
        >
          {tr('حفظ السؤال', 'Enregistrer la question', 'Save the question')}
        </Button>
        <Button
          icon={FolderOpen}
          block
          variant="subtle"
          busy={props.busy === 'open'}
          disabled={props.busy !== null}
          onClick={() => props.onCommand('open')}
        >
          {tr('فتح تقرير', 'Ouvrir un rapport', 'Open a report')}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ *
 * The basis and the window are restated here, even though the rail already shows both,
 * because the status bar is what a screenshot keeps. A statement quoted out of this window
 * with no basis attached is a figure somebody will read as the whole book when it was one
 * quarter — and the person quoting it will not be in the room to be asked.
 *
 * The hidden count is here for the same reason. A filtered grid whose subtotals still count
 * every account is honest only if it says so.
 */

/**
 * The bottom line, or the check that stands in for one.
 *
 * The income statement has a bottom line and prints it. The other two have none — a balance
 * sheet's whole content is that two sides agree — so they print whether they hold together
 * instead: debit less credit across every account, or assets less everything claimed against
 * them. Both are the same gesture: the one number a reader would otherwise work out by hand.
 */
function ResultItem({
  view,
  summary,
  off,
}: {
  readonly view: StatementView;
  readonly summary: Summary;
  readonly off: boolean;
}) {
  const { tr, lang } = useLocale();
  if (view === 'income') {
    return (
      <StatusItem
        icon={summary.result < 0 ? TrendingDown : TrendingUp}
        tone={summary.result < 0 ? 'danger' : 'success'}
        title={tr('الإيرادات ناقص التكاليف.', 'Produits moins charges.', 'Revenue less expenses.')}
      >
        {fmt.money(summary.result, 'DZD', lang)}
      </StatusItem>
    );
  }
  const trial = view === 'trial';
  return (
    <StatusItem
      icon={Scale}
      tone={off ? 'danger' : 'success'}
      title={
        trial
          ? tr(
              'المدين ناقص الدائن على كل الحسابات.',
              'Débit moins crédit sur tous les comptes.',
              'Debit less credit across every account.',
            )
          : tr(
              'الأصول ناقص الخصوم ورأس المال والنتيجة.',
              'Actif moins passif, capitaux propres et résultat.',
              'Assets less liabilities, equity and the result.',
            )
      }
    >
      {fmt.money(trial ? summary.debit - summary.credit : summary.drift, 'DZD', lang)}
    </StatusItem>
  );
}

interface StatusProps {
  readonly view: StatementView;
  readonly basis: Basis;
  readonly period: FiscalPeriod | null;
  readonly comparison: FiscalPeriod | null;
  /** Account rows printed, and account rows the filter is holding back. */
  readonly accounts: number;
  readonly hidden: number;
  readonly postings: number;
  readonly summary: Summary;
  readonly bounded: boolean;
  readonly coveredFrom: string | null;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

export function StatementsStatus(props: StatusProps) {
  const { tr, lang } = useLocale();
  const { basis, summary, view } = props;
  const walking = basis === 'period';
  const gap = summary.debit - summary.credit;
  const off = view === 'trial' ? Math.abs(gap) >= EPSILON : !summary.balanced;
  return (
    <>
      <StatusItem
        icon={walking ? CalendarRange : Landmark}
        title={
          walking
            ? tr(
                'الأرقام مقصورة على نافذة، ومحسوبة في التطبيق.',
                'Les nombres sont restreints à une fenêtre et calculés dans l’application.',
                'The figures are cut to a window and computed in the app.',
              )
            : tr(
                'الأرقام من مجموع النواة على كل قيد مُرحَّل.',
                'Les nombres viennent de l’agrégat du noyau sur toutes les écritures comptabilisées.',
                'The figures come from the kernel’s aggregate over every posted line.',
              )
        }
      >
        {walking ? periodSpan(props.period, tr) : tr('الدفتر بالكامل', 'Livre entier', 'Whole book')}
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
        icon={ClipboardList}
        title={tr('سطور حسابات مطبوعة.', 'Lignes de comptes imprimées.', 'Account lines printed.')}
      >
        {`${fmt.integer(props.accounts, lang)} ${tr('حساب', 'comptes', 'accounts')}`}
      </StatusItem>
      {props.hidden === 0 ? null : (
        <StatusItem
          icon={Filter}
          title={tr(
            'سطور أخفاها البحث أو مرشّح الصفر. كل مجموع فرعي لا يزال يحتسبها.',
            'Lignes masquées par la recherche ou le filtre des zéros. Chaque sous-total les compte encore.',
            'Lines hidden by the search box or the zero filter. Every subtotal still counts them.',
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
      <ResultItem view={view} summary={summary} off={off} />
      {view !== 'income' || summary.margin === null ? null : (
        <StatusItem icon={Percent} title={tr('النتيجة على الإيرادات.', 'Résultat sur produits.', 'Result over revenue.')}>
          {fmt.percent(summary.margin, lang, 1)}
        </StatusItem>
      )}
      {off ? (
        <StatusItem
          icon={AlertTriangle}
          tone="danger"
          title={tr(
            'الفرق مطبوع في سطره الخاص، لا مُوزَّعًا على الأقسام.',
            'L’écart est imprimé sur sa propre ligne, il n’est pas réparti.',
            'The difference prints on its own line rather than being spread across the sections.',
          )}
        >
          {tr('غير متوازن', 'Non équilibré', 'Out of balance')}
        </StatusItem>
      ) : null}
      {props.bounded ? (
        <StatusItem
          icon={Gauge}
          tone="warning"
          title={
            walking
              ? tr(
                  'صفحة قيود أو سطور وصلت إلى سقفها: النافذة قُرئت جزئيًا.',
                  'Une page d’écritures ou de lignes a atteint son plafond : la fenêtre n’a été lue qu’en partie.',
                  'An entry or posting page came back at its ceiling: the window was only partly read.',
                )
              : tr(
                  'صفحة ميزان المراجعة وصلت إلى سقفها: حسابات ناقصة من أسفل البيان.',
                  'La page de balance a atteint son plafond : des comptes manquent au bas de l’état.',
                  'The trial-balance page came back at its ceiling: accounts are missing from the foot of the statement.',
                )
          }
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
 * Two entries, and the first is greyed rather than gone on a row that is arithmetic instead
 * of an account: a menu that changes shape between rows is a menu whose second entry gets
 * clicked by accident. Neither entry touches the book, so neither asks for confirmation —
 * the worst either can do is open a window or fill the clipboard.
 */

interface RowMenuProps {
  readonly x: number;
  readonly y: number;
  readonly row: StatementRow;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}

export function RowMenu({ x, y, row, onSelect, onDismiss }: RowMenuProps) {
  const { t, tr } = useLocale();
  const entries: readonly MenuEntry[] = [
    { id: 'header', kind: 'header', label: `${rowLabel(row, t)} — ${t(ROW_KIND_LABEL[row.kind])}` },
    {
      id: 'ledger',
      label: tr('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger'),
      icon: ExternalLink,
      disabled: row.figure === null,
    },
    {
      id: 'copyRow',
      label: tr('نسخ السطر', 'Copier la ligne', 'Copy this line'),
      icon: Copy,
      accelerator: 'Ctrl+Shift+C',
    },
  ];
  return <MenuFlyout x={x} y={y} entries={entries} onSelect={onSelect} onDismiss={onDismiss} minWidth={260} />;
}
