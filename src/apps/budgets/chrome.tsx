/**
 * Budgets — the chrome.
 *
 * The toolbar leads with the only act this window has — setting an amount — and states
 * the number that decides whether it is needed: how many accounts came out adverse. A
 * badge rather than a disabled button, because the server owns the rules and a window
 * that refuses a write the server would accept is a window lying about who is in charge.
 *
 * The rail is the budgets, with the plan's own consumption pinned above them so it stays
 * visible in every view. A locked budget carries a padlock, which is also the answer to
 * why the amount field has gone grey.
 *
 * The status bar says which basis the actuals came from. That sentence is the difference
 * between a report about March and a report about the whole book, and it is the one thing
 * a reader cannot recover from the numbers.
 */
import type { Ref } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  FileDown,
  Layers,
  Lock,
  Pencil,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sigma,
  Target,
} from 'lucide-react';
import {
  Badge,
  Button,
  fmt,
  IconButton,
  type MenuEntry,
  MenuFlyout,
  NavGroupLabel,
  NavItem,
  ProgressBar,
  SearchBox,
  Segmented,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  useLocale,
} from '@/platform/sdk';
import type { Budget, FiscalPeriod } from '../shared/ledger';
import type { BudgetBusy } from './actions';
import type { BudgetView } from './model';
import { type BudgetAssessment, VARIANCE_STATE_LABEL, type VarianceRow } from './variance';

interface ToolbarProps {
  readonly view: BudgetView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: BudgetBusy;
  readonly loading: boolean;
  /** False when there is no account selected, or the budget is signed and closed. */
  readonly canSet: boolean;
  /** False additionally when the account has no posted activity to copy from. */
  readonly canSeed: boolean;
  /** Accounts on the wrong side of the plan, shown beside the button rather than blocking it. */
  readonly adverse: number;
  onSearch: (next: string) => void;
  onCommand: (id: string) => void;
}

export function BudgetToolbar(props: ToolbarProps) {
  const { tr } = useLocale();
  const { busy, onCommand } = props;
  const working = busy !== null;
  const views: readonly { value: BudgetView; label: string; icon: typeof Scale }[] = [
    { value: 'variance', label: tr('الفروق', 'Écarts', 'Variance'), icon: Scale },
    { value: 'plan', label: tr('الخطة', 'Plan', 'Plan'), icon: ClipboardList },
    { value: 'rollup', label: tr('التجميع', 'Synthèse', 'Rollup'), icon: Layers },
  ];

  return (
    <div className="fx-commandbar">
      <Button
        icon={Pencil}
        variant="accent"
        busy={busy === 'set'}
        disabled={working || !props.canSet}
        onClick={() => onCommand('set')}
        title={tr('تعيين المبلغ (Ctrl+Enter)', 'Définir le montant (Ctrl+Entrée)', 'Set the amount (Ctrl+Enter)')}
      >
        {tr('تعيين', 'Définir', 'Set')}
      </Button>
      {props.adverse > 0 ? (
        <Badge tone="danger" icon={AlertTriangle} title={tr('حسابات غير مواتية', 'Comptes défavorables', 'Adverse accounts')}>
          {props.adverse}
        </Badge>
      ) : null}
      <Button
        icon={ArrowRight}
        busy={busy === 'seed'}
        disabled={working || !props.canSeed}
        onClick={() => onCommand('seed')}
        title={tr(
          'أخذ المنفَّذ كخطة (Ctrl+Shift+S)',
          'Reprendre le réalisé comme plan (Ctrl+Maj+S)',
          'Take the actual as the plan (Ctrl+Shift+S)',
        )}
      >
        {tr('من المنفَّذ', 'Depuis le réalisé', 'From actual')}
      </Button>
      <ToolbarSeparator />
      <Segmented value={props.view} onChange={(next) => onCommand(`view:${next}`)} options={views} />
      <ToolbarSpacer />
      {props.view === 'rollup' ? null : (
        <SearchBox
          ref={props.searchRef}
          value={props.search}
          onChange={props.onSearch}
          width={200}
          placeholder={tr('بحث في الحسابات', 'Rechercher un compte', 'Search accounts')}
        />
      )}
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
 * Rail
 * ------------------------------------------------------------------ */

interface RailProps {
  readonly budgets: readonly Budget[];
  readonly budget: Budget | null;
  readonly assessment: BudgetAssessment;
  onBudget: (id: string) => void;
}

export function BudgetRail({ budgets, budget, assessment, onBudget }: RailProps) {
  const { tr, lang } = useLocale();
  const used = assessment.planned === 0 ? null : assessment.actual / assessment.planned;
  // Adverse accounts are the only reason to paint this red. The ratio alone says nothing:
  // a book holds accounts that ought to be under plan and accounts that ought to be over.
  const tone = assessment.adverse > 0 ? 'danger' : 'accent';
  return (
    <>
      <NavGroupLabel>{tr('حالة الخطة', 'État du plan', 'Plan status')}</NavGroupLabel>
      <div style={{ display: 'grid', gap: 5, padding: '0 10px 10px' }}>
        <div style={{ display: 'flex', fontSize: 'var(--fx-caption)', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fx-text-secondary)' }}>{tr('المنفَّذ', 'Consommé', 'Used')}</span>
          <span className="fx-num" style={{ fontWeight: 600 }}>
            {used === null ? '—' : fmt.percent(used, lang, 0)}
          </span>
        </div>
        <ProgressBar value={used ?? 0} tone={tone} height={6} />
        <div style={{ display: 'flex', fontSize: 'var(--fx-caption)', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fx-text-secondary)' }}>{tr('سطور الخطة', 'Lignes', 'Plan lines')}</span>
          <span className="fx-num" style={{ color: 'var(--fx-text-primary)' }}>
            {`${fmt.integer(assessment.lines, lang)} / ${fmt.integer(assessment.accounts, lang)}`}
          </span>
        </div>
      </div>
      <NavGroupLabel>{tr('الموازنات', 'Budgets', 'Budgets')}</NavGroupLabel>
      {budgets.length === 0 ? (
        <NavItem icon={Target} label={tr('لا موازنات', 'Aucun budget', 'No budgets')} disabled />
      ) : (
        budgets.map((row) => (
          <NavItem
            key={row.id}
            icon={row.lockedAt === null ? Target : Lock}
            label={row.name === '' ? tr('بلا اسم', 'Sans nom', 'Untitled') : row.name}
            selected={row.id === budget?.id}
            onClick={() => onBudget(row.id)}
            depth={1}
          />
        ))
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

interface StatusProps {
  readonly view: BudgetView;
  /** Rows the active view is showing, after the search box has had its say. */
  readonly shown: number;
  readonly budget: Budget | null;
  readonly period: FiscalPeriod | null;
  readonly assessment: BudgetAssessment;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

type Translate = (ar: string, fr: string, en: string) => string;

const NOUN: Readonly<Record<BudgetView, (tr: Translate) => string>> = {
  variance: (tr) => tr('حساب', 'comptes', 'accounts'),
  plan: (tr) => tr('حساب', 'comptes', 'accounts'),
  rollup: (tr) => tr('مجموعة', 'groupes', 'groups'),
};

export function BudgetStatus({ view, shown, budget, period, assessment, error, fetchedAt }: StatusProps) {
  const { tr, lang } = useLocale();
  return (
    <>
      <StatusItem icon={assessment.locked ? Lock : Target}>
        {budget === null ? tr('لا موازنة', 'Aucun budget', 'No budget') : budget.name}
      </StatusItem>
      <StatusItem
        icon={assessment.basis === 'period' ? CalendarRange : Layers}
        title={tr(
          'المنفَّذ محسوب على هذا النطاق.',
          'Le réalisé est calculé sur ce périmètre.',
          'The actual is computed over this scope.',
        )}
      >
        {assessment.basis === 'period' && period !== null
          ? period.label
          : tr('الدفتر كاملًا', 'Tout le livre', 'Whole book')}
      </StatusItem>
      <StatusItem icon={ClipboardList}>{`${fmt.integer(shown, lang)} ${NOUN[view](tr)}`}</StatusItem>
      <StatusItem icon={Sigma} title={tr('مجموع الخطة', 'Total du budget', 'Planned total')}>
        {fmt.money(assessment.planned, 'DZD', lang)}
      </StatusItem>
      <StatusItem
        icon={Scale}
        title={tr(
          'الخطة ناقص المنفَّذ، بالعملة الأساسية للدفتر. إشارته وحدها لا تعني جيدًا أو سيئًا.',
          'Budget moins réalisé, dans la monnaie de tenue. Son signe seul ne dit ni bien ni mal.',
          'Planned less actual, in the book’s base currency. Its sign alone means neither good nor bad.',
        )}
      >
        {fmt.money(assessment.variance, 'DZD', lang)}
      </StatusItem>
      {assessment.adverse === 0 ? null : (
        <StatusItem
          icon={AlertTriangle}
          tone="danger"
          title={tr(
            'حسابات الفرق فيها ليس في مصلحة النتيجة.',
            'Comptes dont l’écart ne va pas dans le bon sens.',
            'Accounts whose gap runs the wrong way.',
          )}
        >
          {tr(
            `${fmt.integer(assessment.adverse, lang)} غير مواتٍ`,
            `${fmt.integer(assessment.adverse, lang)} défavorables`,
            `${fmt.integer(assessment.adverse, lang)} adverse`,
          )}
        </StatusItem>
      )}
      {assessment.unplanned === 0 ? null : (
        <StatusItem
          icon={ShieldAlert}
          tone="warning"
          title={tr(
            'حسابات فيها حركة ولا سطر خطة لها.',
            'Comptes avec des mouvements et sans ligne de budget.',
            'Accounts with activity and no budget line.',
          )}
        >
          {tr(
            `${fmt.integer(assessment.unplanned, lang)} غير مخطَّط`,
            `${fmt.integer(assessment.unplanned, lang)} hors plan`,
            `${fmt.integer(assessment.unplanned, lang)} unplanned`,
          )}
        </StatusItem>
      )}
      {assessment.complete ? null : (
        <StatusItem
          icon={AlertTriangle}
          tone="warning"
          title={tr(
            'صفحة وصلت إلى سقفها: المنفَّذ محسوب على جزء من الدفتر.',
            'Une page a atteint son plafond : le réalisé porte sur une partie du livre.',
            'A page came back at its ceiling: the actual covers part of the book only.',
          )}
        >
          {tr('نتائج جزئية', 'Résultats partiels', 'Partial')}
        </StatusItem>
      )}
      {error === null ? null : (
        <StatusItem icon={ShieldAlert} tone="danger" title={error}>
          {tr('تعذّرت القراءة', 'Lecture impossible', 'Read failed')}
        </StatusItem>
      )}
      {fetchedAt === null ? null : (
        <StatusItem icon={Clock} title={tr('آخر قراءة للدفتر', 'Dernière lecture du livre', 'Book last read')}>
          {fmt.relativeTime(fetchedAt, lang)}
        </StatusItem>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Account context menu
 * ------------------------------------------------------------------ *
 * `set` and `seed` are the same write from different sources, so they sit together and
 * both go grey on a locked budget. `seed` additionally needs something to copy: an
 * account with no posted activity would seed a zero, which is a plan nobody entered.
 */

interface RowMenuProps {
  readonly x: number;
  readonly y: number;
  readonly row: VarianceRow;
  readonly busy: boolean;
  readonly locked: boolean;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}

export function RowMenu({ x, y, row, busy, locked, onSelect, onDismiss }: RowMenuProps) {
  const { t, tr } = useLocale();
  const entries: readonly MenuEntry[] = [
    {
      id: 'header',
      kind: 'header',
      label: `${row.account.code} · ${row.account.name} — ${t(VARIANCE_STATE_LABEL[row.state])}`,
    },
    {
      id: 'set',
      label: tr('تعيين المبلغ', 'Définir le montant', 'Set the amount'),
      icon: Pencil,
      accelerator: 'Ctrl+Enter',
      disabled: busy || locked,
    },
    {
      id: 'seed',
      label: tr('أخذ المنفَّذ كخطة', 'Reprendre le réalisé', 'Take the actual as the plan'),
      icon: ArrowRight,
      accelerator: 'Ctrl+Shift+S',
      disabled: busy || locked || row.lines === 0,
    },
    { id: 'sep', kind: 'separator' },
    {
      id: 'ledger',
      label: tr('فتح في الدفتر', 'Ouvrir dans le grand livre', 'Open in the ledger'),
      icon: ExternalLink,
    },
    { id: 'copyRow', label: tr('نسخ', 'Copier', 'Copy'), icon: Copy, accelerator: 'Ctrl+C' },
  ];
  return <MenuFlyout x={x} y={y} entries={entries} onSelect={onSelect} onDismiss={onDismiss} minWidth={250} />;
}
