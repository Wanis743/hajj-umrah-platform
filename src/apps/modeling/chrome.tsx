/**
 * Modeling — the chrome.
 *
 * The rail is the scenario, and the scenario is the whole argument. A forecast is not a
 * number; it is a number plus the sentence that produced it, so the drivers live in a
 * permanent left pane rather than behind a dialog. Moving the lookback from six months to
 * three is not a preference — it is a different claim about the business — which is why
 * each driver carries a sentence saying what it does underneath it.
 *
 * The toolbar leads with the override, the one control here that replaces a computed number
 * with a typed one, and counts how many are in force beside it. An override is the honest
 * answer to a model that cannot know about the contract signed last week; it is also the
 * thing a reader most needs told, so it is never silent.
 *
 * Nothing in this window writes to the book, so nothing goes grey to protect it. A control
 * is disabled only when it has nothing to act on, and the status bar spends its room on how
 * much history the window actually had — a six-month lookback drawn from four months of
 * postings is a weaker claim than the same lookback drawn from six, and that is the one
 * thing a reader cannot recover from the figures.
 */
import type { Ref } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  Gauge,
  History,
  LineChart,
  Lock,
  Pencil,
  Percent,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sigma,
  SlidersHorizontal,
  Target,
  TrendingDown,
  TrendingUp,
  Undo2,
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
  NavItem,
  SearchBox,
  Segmented,
  Select,
  Slider,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  useLocale,
} from '@/platform/sdk';
import { ACCOUNT_TYPE_LABEL, type Budget } from '../shared/ledger';
import type { ModelingBusy } from './actions';
import {
  type ForecastRow,
  HORIZONS,
  LOOKBACKS,
  type Method,
  METHOD_HINT,
  METHOD_LABEL,
  METHODS,
  type Projection,
  type Scenario,
} from './forecast';
import type { Month } from './history';
import type { ModelingView } from './model';

type Translate = (ar: string, fr: string, en: string) => string;

/** `2026-09 → 2027-02`, the only honest way to name a window of months in three languages. */
function span(months: readonly Month[], tr: Translate): string {
  if (months.length === 0) return tr('لا شيء', 'Aucun', 'None');
  const first = months[0];
  const last = months[months.length - 1];
  return first === last ? first : `${first} → ${last}`;
}

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ */

interface ToolbarProps {
  readonly view: ModelingView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: ModelingBusy;
  readonly loading: boolean;
  /** An account is selected, so there is a row for a typed number to land on. */
  readonly canOverride: boolean;
  /** That account already carries one. */
  readonly canRelease: boolean;
  /** How many are in force across the whole model. */
  readonly overrides: number;
  /** Whether accounts that never moved are in the grid. */
  readonly showQuiet: boolean;
  onSearch: (next: string) => void;
  onQuiet: (next: boolean) => void;
  onCommand: (id: string) => void;
}

export function ModelingToolbar(props: ToolbarProps) {
  const { tr } = useLocale();
  const { busy, onCommand } = props;
  const working = busy !== null;
  const views: readonly { value: ModelingView; label: string; icon: typeof LineChart }[] = [
    { value: 'forecast', label: tr('التوقّع', 'Prévision', 'Forecast'), icon: LineChart },
    { value: 'timeline', label: tr('الأشهر', 'Mois', 'Months'), icon: Activity },
    { value: 'compare', label: tr('مقابل الخطة', 'Face au plan', 'Against plan'), icon: Scale },
  ];

  return (
    <div className="fx-commandbar">
      <Button
        icon={Pencil}
        variant="accent"
        disabled={!props.canOverride}
        onClick={() => onCommand('override')}
        title={tr(
          'إدخال رقم بدل المحسوب (Ctrl+Enter)',
          'Saisir un nombre à la place du calcul (Ctrl+Entrée)',
          'Type a number in place of the computed one (Ctrl+Enter)',
        )}
      >
        {tr('تجاوز', 'Dérogation', 'Override')}
      </Button>
      {props.overrides > 0 ? (
        <Badge
          tone="warning"
          icon={Pencil}
          title={tr(
            'أرقام مُدخلة يدويًا تحلّ محلّ المحرّك.',
            'Nombres saisis à la main, en remplacement du moteur.',
            'Hand-entered numbers standing in for the driver.',
          )}
        >
          {props.overrides}
        </Badge>
      ) : null}
      <Button
        icon={Undo2}
        disabled={!props.canRelease}
        onClick={() => onCommand('release')}
        title={tr(
          'إرجاع الحساب إلى المحرّك (Ctrl+Backspace)',
          'Rendre le compte au moteur (Ctrl+Retour arrière)',
          'Give the account back to the driver (Ctrl+Backspace)',
        )}
      >
        {tr('إرجاع', 'Rendre', 'Release')}
      </Button>
      <ToolbarSeparator />
      <Segmented value={props.view} onChange={(next) => onCommand(`view:${next}`)} options={views} />
      <ToolbarSpacer />
      {props.view === 'forecast' ? (
        <IconButton
          icon={props.showQuiet ? Eye : EyeOff}
          label={tr(
            'إظهار الحسابات بلا حركة',
            'Afficher les comptes sans mouvement',
            'Show accounts with no movement',
          )}
          active={props.showQuiet}
          onClick={() => props.onQuiet(!props.showQuiet)}
        />
      ) : null}
      {props.view === 'forecast' ? (
        <SearchBox
          ref={props.searchRef}
          value={props.search}
          onChange={props.onSearch}
          width={200}
          placeholder={tr('بحث في الحسابات', 'Rechercher un compte', 'Search accounts')}
        />
      ) : null}
      <Button
        icon={Copy}
        disabled={working}
        onClick={() => onCommand('copy')}
        title={tr(
          'نسخ الملخّص مع فروضه (Ctrl+Shift+C)',
          'Copier la synthèse avec ses hypothèses (Ctrl+Maj+C)',
          'Copy the summary with its assumptions (Ctrl+Shift+C)',
        )}
      >
        {tr('نسخ', 'Copier', 'Copy')}
      </Button>
      <Button
        icon={FileDown}
        busy={busy === 'export'}
        disabled={working}
        onClick={() => onCommand('export')}
        title={tr('تصدير المعروض (Ctrl+E)', 'Exporter la vue (Ctrl+E)', 'Export this view (Ctrl+E)')}
      >
        {tr('تصدير', 'Exporter', 'Export')}
      </Button>
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
 * Rail — the scenario
 * ------------------------------------------------------------------ *
 * Every control here changes what the numbers mean rather than which of them are shown, so
 * the pane reads top to bottom as a sentence: this driver, fitted over this much history,
 * carried this far forward, with these two adjustments.
 *
 * The plan picker is last and starts at nothing. A comparison against a budget nobody chose
 * is a variance nobody asked for, and it would arrive looking like a finding.
 */

interface RailProps {
  readonly scenario: Scenario;
  readonly projection: Projection;
  readonly budgets: readonly Budget[];
  readonly budget: Budget | null;
  onMethod: (next: Method) => void;
  onHorizon: (next: number) => void;
  onLookback: (next: number) => void;
  onGrowth: (next: number) => void;
  onUplift: (next: number) => void;
  onBudget: (id: string | null) => void;
  onCommand: (id: string) => void;
}

interface DialProps {
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  onChange: (next: number) => void;
}

/** A percent driver. The number is printed beside the slider: a slider alone is a gesture. */
function PercentDial({ label, hint, value, min, max, onChange }: DialProps) {
  const { lang } = useLocale();
  return (
    <Field label={label} hint={hint}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Slider value={value} onChange={onChange} min={min} max={max} step={0.5} />
        </div>
        <span className="fx-num" style={{ minWidth: 54, textAlign: 'end' }}>
          {fmt.percent(value / 100, lang, 1)}
        </span>
      </div>
    </Field>
  );
}

export function ScenarioRail(props: RailProps) {
  const { t, tr, lang } = useLocale();
  const { scenario } = props;
  const methods = METHODS.map((method) => ({ value: method, label: t(METHOD_LABEL[method]) }));
  const horizons = HORIZONS.map((count) => ({ value: String(count), label: String(count) }));
  const lookbacks = LOOKBACKS.map((count) => ({ value: String(count), label: String(count) }));
  // Resolved against the list rather than cast: the driver decides every number in the
  // window, and a bad string arriving here would be a silent one.
  const pickMethod = (value: string) => {
    const found = METHODS.find((method) => method === value);
    if (found !== undefined) props.onMethod(found);
  };

  return (
    <>
      <NavGroupLabel>{tr('الفرض', 'Hypothèse', 'Scenario')}</NavGroupLabel>
      <div style={{ display: 'grid', gap: 12, padding: '0 10px 12px' }}>
        <Field label={tr('المحرّك', 'Moteur', 'Driver')} hint={t(METHOD_HINT[scenario.method])}>
          <Select value={scenario.method} onChange={pickMethod} options={methods} />
        </Field>
        <Field
          label={tr('أشهر النظر', 'Fenêtre (mois)', 'Lookback (months)')}
          hint={tr(
            'كم شهرًا من الماضي يقرأه المحرّك.',
            'Combien de mois passés le moteur lit.',
            'How many past months the driver reads.',
          )}
        >
          <Segmented
            value={String(scenario.lookback)}
            onChange={(next) => props.onLookback(Number(next))}
            options={lookbacks}
            size="sm"
          />
        </Field>
        <Field
          label={tr('الأفق (أشهر)', 'Horizon (mois)', 'Horizon (months)')}
          hint={tr(
            'كم شهرًا يُرسم إلى الأمام.',
            'Combien de mois sont projetés.',
            'How many months are drawn forward.',
          )}
        >
          <Segmented
            value={String(scenario.horizon)}
            onChange={(next) => props.onHorizon(Number(next))}
            options={horizons}
            size="sm"
          />
        </Field>
        {scenario.method === 'growth' ? (
          <PercentDial
            label={tr('النمو شهريًا', 'Croissance mensuelle', 'Growth per month')}
            hint={tr(
              'يُركّب على آخر شهر، شهرًا بعد شهر.',
              'Composée sur le dernier mois, mois après mois.',
              'Compounded on the last month, month after month.',
            )}
            value={scenario.growth}
            min={-20}
            max={20}
            onChange={props.onGrowth}
          />
        ) : null}
        <PercentDial
          label={tr('زيادة التكاليف', 'Inflation des charges', 'Cost uplift')}
          hint={tr(
            'تُضاف إلى كل شهر متوقّع من التكاليف، لا إلى الإيرادات.',
            'Ajoutée à chaque mois de charges projeté, jamais aux produits.',
            'Added to every projected expense month, never to revenue.',
          )}
          value={scenario.uplift}
          min={0}
          max={30}
          onChange={props.onUplift}
        />
      </div>
      <NavGroupLabel>{tr('المقارنة مع', 'Comparer à', 'Compare against')}</NavGroupLabel>
      <NavItem
        icon={Scale}
        label={tr('بلا خطة', 'Aucun plan', 'No plan')}
        selected={props.budget === null}
        onClick={() => props.onBudget(null)}
        depth={1}
      />
      {props.budgets.map((row) => (
        <NavItem
          key={row.id}
          icon={row.lockedAt === null ? Target : Lock}
          label={row.name === '' ? tr('بلا اسم', 'Sans nom', 'Untitled') : row.name}
          selected={row.id === props.budget?.id}
          onClick={() => props.onBudget(row.id)}
          depth={1}
        />
      ))}
      <div style={{ display: 'grid', gap: 8, padding: '12px 10px 10px' }}>
        <div style={{ display: 'flex', fontSize: 'var(--fx-caption)', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fx-text-secondary)' }}>
            {tr('النتيجة المتوقّعة', 'Résultat projeté', 'Projected result')}
          </span>
          <span className="fx-num" style={{ fontWeight: 600 }}>
            {fmt.money(props.projection.result, 'DZD', lang)}
          </span>
        </div>
        <Button
          icon={Undo2}
          block
          onClick={() => props.onCommand('reset')}
          title={tr('إرجاع الفرض إلى مبدئه', 'Revenir à l’hypothèse par défaut', 'Back to the default scenario')}
        >
          {tr('إرجاع الفرض', 'Réinitialiser', 'Reset')}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ *
 * The scenario is restated here even though the rail already shows it, because the status
 * bar is what a screenshot keeps. A projection cropped out of its window is otherwise a row
 * of numbers with no method attached, and that is how a forecast becomes a promise.
 */

interface StatusProps {
  readonly view: ModelingView;
  /** Rows the active view is showing, after the search box has had its say. */
  readonly shown: number;
  readonly scenario: Scenario;
  readonly projection: Projection;
  readonly budget: Budget | null;
  /** The oldest month the fetched page proved, when it came back at its ceiling. */
  readonly coveredFrom: Month | null;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

const NOUN: Readonly<Record<ModelingView, (tr: Translate) => string>> = {
  forecast: (tr) => tr('حساب', 'comptes', 'accounts'),
  timeline: (tr) => tr('شهر', 'mois', 'months'),
  compare: (tr) => tr('نوع', 'types', 'types'),
};

export function ModelingStatus(props: StatusProps) {
  const { t, tr, lang } = useLocale();
  const { projection, scenario } = props;
  const adjusted = scenario.uplift !== 0 || (scenario.method === 'growth' && scenario.growth !== 0);
  return (
    <>
      <StatusItem
        icon={SlidersHorizontal}
        title={tr('المحرّك الذي رسم الأرقام.', 'Le moteur qui a tracé les nombres.', 'The driver that drew the numbers.')}
      >
        {t(METHOD_LABEL[scenario.method])}
      </StatusItem>
      <StatusItem
        icon={CalendarRange}
        title={tr(
          'أشهر الدفتر التي قُرئت. تنتهي عند آخر شهر مُرحَّل، لا عند اليوم.',
          'Les mois lus dans le livre. S’arrêtent au dernier mois comptabilisé, pas à aujourd’hui.',
          'The book months that were read. They end at the last posted month, not at today.',
        )}
      >
        {span(projection.historyMonths, tr)}
      </StatusItem>
      <StatusItem icon={History} title={tr('أشهر النظر', 'Fenêtre lue', 'Lookback window')}>
        {`${fmt.integer(scenario.lookback, lang)} ${tr('شهر', 'mois', 'mo')}`}
      </StatusItem>
      <StatusItem icon={CalendarClock} title={tr('الأشهر المتوقّعة', 'Mois projetés', 'Projected months')}>
        {span(projection.futureMonths, tr)}
      </StatusItem>
      {adjusted ? (
        <StatusItem
          icon={Percent}
          title={tr(
            'تعديلات مُعلنة على الأرقام المرسومة.',
            'Ajustements déclarés sur les nombres tracés.',
            'Stated adjustments on the drawn numbers.',
          )}
        >
          {scenario.method === 'growth' && scenario.growth !== 0
            ? `${fmt.percent(scenario.growth / 100, lang, 1)}${scenario.uplift === 0 ? '' : ` · +${fmt.percent(scenario.uplift / 100, lang, 1)}`}`
            : `+${fmt.percent(scenario.uplift / 100, lang, 1)}`}
        </StatusItem>
      ) : null}
      <StatusItem icon={ClipboardList}>{`${fmt.integer(props.shown, lang)} ${NOUN[props.view](tr)}`}</StatusItem>
      <StatusItem
        icon={projection.result < 0 ? TrendingDown : TrendingUp}
        tone={projection.result < 0 ? 'danger' : 'success'}
        title={tr(
          'الإيرادات ناقص التكاليف على مدى الأفق.',
          'Produits moins charges sur tout l’horizon.',
          'Revenue less expense across the whole horizon.',
        )}
      >
        {fmt.money(projection.result, 'DZD', lang)}
      </StatusItem>
      {props.budget === null || projection.planned === null ? null : (
        <StatusItem icon={Sigma} title={tr('مجموع الخطة', 'Total du plan', 'Planned total')}>
          {fmt.money(projection.planned, 'DZD', lang)}
        </StatusItem>
      )}
      {projection.overrides === 0 ? null : (
        <StatusItem
          icon={Pencil}
          tone="warning"
          title={tr(
            'حسابات أرقامها مُدخلة يدويًا.',
            'Comptes dont les nombres sont saisis à la main.',
            'Accounts whose numbers were typed by hand.',
          )}
        >
          {tr(
            `${fmt.integer(projection.overrides, lang)} تجاوز`,
            `${fmt.integer(projection.overrides, lang)} dérogations`,
            `${fmt.integer(projection.overrides, lang)} overridden`,
          )}
        </StatusItem>
      )}
      {props.coveredFrom === null ? null : (
        <StatusItem
          icon={Gauge}
          tone="warning"
          title={tr(
            'صفحة القيود وصلت إلى سقفها: ما قبل هذا الشهر لم يُقرأ، وليس صفرًا.',
            'La page d’écritures a atteint son plafond : avant ce mois rien n’a été lu, ce n’est pas zéro.',
            'The entry page came back at its ceiling: before this month nothing was read, which is not the same as zero.',
          )}
        >
          {tr(`مُثبَت من ${props.coveredFrom}`, `Prouvé depuis ${props.coveredFrom}`, `Proven from ${props.coveredFrom}`)}
        </StatusItem>
      )}
      {projection.complete ? null : (
        <StatusItem
          icon={AlertTriangle}
          tone="warning"
          title={tr(
            'التاريخ محسوب على جزء من الدفتر.',
            'L’historique porte sur une partie du livre.',
            'The history covers part of the book only.',
          )}
        >
          {tr('تاريخ جزئي', 'Historique partiel', 'Partial history')}
        </StatusItem>
      )}
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
 * Account context menu
 * ------------------------------------------------------------------ *
 * `override` and `release` are the same edit in both directions, so they sit together and
 * `release` greys out when there is nothing to take away. Neither touches the book, which is
 * why neither asks for confirmation: the worst either can do is change a number on screen.
 */

interface RowMenuProps {
  readonly x: number;
  readonly y: number;
  readonly row: ForecastRow;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}

export function RowMenu({ x, y, row, onSelect, onDismiss }: RowMenuProps) {
  const { t, tr } = useLocale();
  const entries: readonly MenuEntry[] = [
    {
      id: 'header',
      kind: 'header',
      label: `${row.account.code} · ${row.account.name} — ${t(ACCOUNT_TYPE_LABEL[row.account.type])}`,
    },
    {
      id: 'override',
      label: tr('إدخال رقم', 'Saisir un nombre', 'Type a number'),
      icon: Pencil,
      accelerator: 'Ctrl+Enter',
    },
    {
      id: 'release',
      label: tr('إرجاع إلى المحرّك', 'Rendre au moteur', 'Give back to the driver'),
      icon: Undo2,
      accelerator: 'Ctrl+Backspace',
      disabled: !row.overridden,
    },
    { id: 'sep', kind: 'separator' },
    {
      id: 'ledger',
      label: tr('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger'),
      icon: ExternalLink,
    },
    { id: 'copyRow', label: tr('نسخ', 'Copier', 'Copy'), icon: Copy, accelerator: 'Ctrl+Shift+C' },
  ];
  return <MenuFlyout x={x} y={y} entries={entries} onSelect={onSelect} onDismiss={onDismiss} minWidth={260} />;
}
