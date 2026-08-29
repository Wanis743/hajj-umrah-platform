/**
 * Period close — the chrome.
 *
 * The toolbar leads with the two acts that matter and states the count that decides
 * whether either should be pressed: a badge beside "Close" saying how many findings
 * are still open. It is a badge and not a disabled button on purpose — the server owns
 * the rules, and a window that refuses a close the server would accept is a window
 * lying about who is in charge.
 *
 * The rail is the periods, grouped by year the way Explorer groups by date, with the
 * month's task progress pinned above them so it stays visible in every view. A closed
 * period carries a padlock; that is the whole state somebody needs at a glance.
 */
import { Fragment, type Ref } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CalendarRange,
  Clock,
  Copy,
  FileDown,
  History,
  ListChecks,
  Lock,
  RefreshCw,
  RotateCw,
  Scale,
  ShieldAlert,
  Sigma,
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
import { EPSILON, type FiscalPeriod, PERIOD_STATUS_LABEL, periodTone, TASK_STATUS_LABEL } from '../shared/ledger';
import type { CloseBusy } from './actions';
import type { ChecklistRow, CloseAssessment } from './checks';
import type { CloseView } from './model';

interface ToolbarProps {
  readonly view: CloseView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: CloseBusy;
  readonly loading: boolean;
  /** False only when the period is already closed — the one rule this window enforces. */
  readonly canClose: boolean;
  readonly canReopen: boolean;
  readonly canCertify: boolean;
  /** Findings that will be argued about, shown beside the button rather than blocking it. */
  readonly failures: number;
  onSearch: (next: string) => void;
  onCommand: (id: string) => void;
}

export function CloseToolbar(props: ToolbarProps) {
  const { tr } = useLocale();
  const { busy, onCommand } = props;
  const working = busy !== null;
  const views: readonly { value: CloseView; label: string; icon: typeof ShieldAlert }[] = [
    { value: 'checks', label: tr('الفحوص', 'Contrôles', 'Checks'), icon: ShieldAlert },
    { value: 'tasks', label: tr('المهام', 'Tâches', 'Tasks'), icon: ListChecks },
    { value: 'trail', label: tr('السجل', 'Journal', 'Trail'), icon: History },
  ];

  return (
    <div className="fx-commandbar">
      <Button
        icon={Lock}
        variant="accent"
        busy={busy === 'close'}
        disabled={working || !props.canClose}
        onClick={() => onCommand('close')}
        title={tr('إقفال الفترة (Ctrl+Shift+L)', 'Clôturer la période (Ctrl+Maj+L)', 'Close the period (Ctrl+Shift+L)')}
      >
        {tr('إقفال', 'Clôturer', 'Close')}
      </Button>
      {props.failures > 0 ? (
        <Badge
          tone="danger"
          icon={AlertTriangle}
          title={tr('عوائق مفتوحة', 'Obstacles ouverts', 'Open blockers')}
        >
          {props.failures}
        </Badge>
      ) : null}
      <Button
        icon={RotateCw}
        busy={busy === 'reopen'}
        disabled={working || !props.canReopen}
        onClick={() => onCommand('reopen')}
        title={tr('إعادة الفتح (Ctrl+Shift+O)', 'Réouvrir (Ctrl+Maj+O)', 'Reopen (Ctrl+Shift+O)')}
      >
        {tr('إعادة فتح', 'Réouvrir', 'Reopen')}
      </Button>
      <ToolbarSeparator />
      <Button
        icon={BadgeCheck}
        busy={busy === 'certify'}
        disabled={working || !props.canCertify}
        onClick={() => onCommand('certify')}
        title={tr('تصديق المهمة (Ctrl+Enter)', 'Certifier la tâche (Ctrl+Entrée)', 'Certify the task (Ctrl+Enter)')}
      >
        {tr('تصديق', 'Certifier', 'Certify')}
      </Button>
      <ToolbarSeparator />
      <Segmented value={props.view} onChange={(next) => onCommand(`view:${next}`)} options={views} />
      <ToolbarSpacer />
      {props.view === 'checks' ? null : (
        <SearchBox
          ref={props.searchRef}
          value={props.search}
          onChange={props.onSearch}
          width={200}
          placeholder={
            props.view === 'tasks'
              ? tr('بحث في المهام', 'Rechercher une tâche', 'Search tasks')
              : tr('بحث في السجل', 'Rechercher dans le journal', 'Search the trail')
          }
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
  readonly periods: readonly FiscalPeriod[];
  readonly period: FiscalPeriod | null;
  readonly assessment: CloseAssessment;
  onPeriod: (id: string) => void;
}

interface YearGroup {
  readonly year: string;
  readonly rows: readonly FiscalPeriod[];
}

/** Periods arrive newest-first, so a year boundary is only a change of prefix. */
function byYear(periods: readonly FiscalPeriod[]): readonly YearGroup[] {
  const out: { year: string; rows: FiscalPeriod[] }[] = [];
  for (const row of periods) {
    const year = row.start.slice(0, 4);
    const last = out.length === 0 ? undefined : out[out.length - 1];
    if (last !== undefined && last.year === year) last.rows.push(row);
    else out.push({ year, rows: [row] });
  }
  return out;
}

export function CloseRail({ periods, period, assessment, onPeriod }: RailProps) {
  const { tr, lang } = useLocale();
  const total = assessment.taskTotal;
  const done = total > 0 && assessment.certified === total;
  const tone = done ? 'success' : assessment.blocked > 0 ? 'danger' : 'accent';
  return (
    <>
      <NavGroupLabel>{tr('قائمة الإقفال', 'Checklist', 'Checklist')}</NavGroupLabel>
      <div style={{ display: 'grid', gap: 5, padding: '0 10px 10px' }}>
        <div style={{ display: 'flex', fontSize: 'var(--fx-caption)', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fx-text-secondary)' }}>{tr('مصدّقة', 'Certifiées', 'Certified')}</span>
          <span
            className="fx-num"
            style={{ color: done ? 'var(--fx-success)' : 'var(--fx-text-primary)', fontWeight: 600 }}
          >
            {`${fmt.integer(assessment.certified, lang)} / ${fmt.integer(total, lang)}`}
          </span>
        </div>
        <ProgressBar value={total === 0 ? 0 : assessment.certified / total} tone={tone} height={6} />
      </div>
      {periods.length === 0 ? (
        <>
          <NavGroupLabel>{tr('الفترات', 'Périodes', 'Periods')}</NavGroupLabel>
          <NavItem icon={CalendarRange} label={tr('لا فترات', 'Aucune période', 'No periods')} disabled />
        </>
      ) : (
        byYear(periods).map((group) => (
          <Fragment key={group.year}>
            <NavGroupLabel>{group.year}</NavGroupLabel>
            {group.rows.map((row) => (
              <NavItem
                key={row.id}
                icon={row.status === 'closed' ? Lock : CalendarRange}
                label={row.label}
                selected={row.id === period?.id}
                onClick={() => onPeriod(row.id)}
                depth={1}
              />
            ))}
          </Fragment>
        ))
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

interface StatusProps {
  readonly view: CloseView;
  /** Rows the active view is showing, after the search box has had its say. */
  readonly shown: number;
  readonly period: FiscalPeriod | null;
  readonly assessment: CloseAssessment;
  /** A page came back at its ceiling, so at least one finding is computed over a slice. */
  readonly truncated: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
}

const NOUN: Readonly<Record<CloseView, (tr: (ar: string, fr: string, en: string) => string) => string>> = {
  checks: (tr) => tr('فحص', 'contrôles', 'checks'),
  tasks: (tr) => tr('مهمة', 'tâches', 'tasks'),
  trail: (tr) => tr('حدث', 'événements', 'events'),
};

export function CloseStatus({ view, shown, period, assessment, truncated, error, fetchedAt }: StatusProps) {
  const { t, tr, lang } = useLocale();
  const off = Math.abs(assessment.difference) > EPSILON;
  return (
    <>
      <StatusItem icon={period !== null && assessment.sealed ? Lock : CalendarRange}>
        {period === null ? tr('لا فترة', 'Aucune période', 'No period') : period.label}
      </StatusItem>
      {period === null ? null : (
        <StatusItem>
          <Badge tone={periodTone(period.status)}>{t(PERIOD_STATUS_LABEL[period.status])}</Badge>
        </StatusItem>
      )}
      <StatusItem icon={ListChecks}>{`${fmt.integer(shown, lang)} ${NOUN[view](tr)}`}</StatusItem>
      <StatusItem
        icon={BadgeCheck}
        tone={assessment.taskTotal > 0 && assessment.openTasks === 0 ? 'success' : undefined}
        title={tr('مهام مصدّقة', 'Tâches certifiées', 'Tasks certified')}
      >
        {`${fmt.integer(assessment.certified, lang)} / ${fmt.integer(assessment.taskTotal, lang)}`}
      </StatusItem>
      {assessment.failures === 0 ? null : (
        <StatusItem
          icon={ShieldAlert}
          tone="danger"
          title={tr(
            'فحوص سيسأل عنها أحدهم قبل الإقفال.',
            'Contrôles dont quelqu’un parlera avant la clôture.',
            'Findings somebody will raise before the close.',
          )}
        >
          {tr(
            `${fmt.integer(assessment.failures, lang)} عائق`,
            `${fmt.integer(assessment.failures, lang)} obstacles`,
            `${fmt.integer(assessment.failures, lang)} blockers`,
          )}
        </StatusItem>
      )}
      {assessment.warnings === 0 ? null : (
        <StatusItem icon={AlertTriangle} tone="warning">
          {tr(
            `${fmt.integer(assessment.warnings, lang)} تحذير`,
            `${fmt.integer(assessment.warnings, lang)} avertissements`,
            `${fmt.integer(assessment.warnings, lang)} warnings`,
          )}
        </StatusItem>
      )}
      <StatusItem icon={Sigma} title={tr('قيود مرحّلة', 'Écritures comptabilisées', 'Posted entries')}>
        {fmt.integer(assessment.posted, lang)}
      </StatusItem>
      <StatusItem
        icon={Scale}
        tone={off ? 'danger' : undefined}
        title={tr(
          'مدين الفترة ناقص دائنها، بالعملة الأساسية للدفتر.',
          'Débit moins crédit de la période, dans la monnaie de tenue.',
          'The period’s debits less its credits, in the book’s base currency.',
        )}
      >
        {fmt.money(assessment.difference, 'DZD', lang)}
      </StatusItem>
      {truncated ? (
        <StatusItem
          icon={AlertTriangle}
          tone="warning"
          title={tr(
            'صفحة وصلت إلى سقفها: بعض النتائج محسوبة على جزء من الدفتر.',
            'Une page a atteint son plafond : certains résultats portent sur une partie du livre.',
            'A page came back at its ceiling: some findings cover part of the book only.',
          )}
        >
          {tr('نتائج جزئية', 'Résultats partiels', 'Partial')}
        </StatusItem>
      ) : null}
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
 * Checklist context menu
 * ------------------------------------------------------------------ *
 * `certify` is the only entry with a precondition, and it is the server's own: a task
 * whose dependencies are not certified will be refused, so the entry is disabled and
 * the row itself says which name is missing. Marking a task blocked is not.
 */

interface TaskMenuProps {
  readonly x: number;
  readonly y: number;
  readonly row: ChecklistRow;
  readonly busy: boolean;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}

export function TaskMenu({ x, y, row, busy, onSelect, onDismiss }: TaskMenuProps) {
  const { t, tr } = useLocale();
  const entries: readonly MenuEntry[] = [
    { id: 'header', kind: 'header', label: `${row.task.name} — ${t(TASK_STATUS_LABEL[row.task.status])}` },
    {
      id: 'certify',
      label: tr('تصديق', 'Certifier', 'Certify'),
      icon: BadgeCheck,
      accelerator: 'Ctrl+Enter',
      disabled: busy || !row.actionable,
    },
    {
      id: 'start',
      label: tr('قيد العمل', 'En cours', 'Mark in progress'),
      icon: Clock,
      disabled: busy || row.task.status === 'inProgress',
    },
    {
      id: 'block',
      label: tr('معلّقة بعائق', 'Bloquée', 'Mark blocked'),
      icon: Ban,
      danger: true,
      disabled: busy || row.task.status === 'blocked',
    },
    { id: 'sep', kind: 'separator' },
    { id: 'copyTask', label: tr('نسخ', 'Copier', 'Copy'), icon: Copy, accelerator: 'Ctrl+C' },
  ];
  return <MenuFlyout x={x} y={y} entries={entries} onSelect={onSelect} onDismiss={onDismiss} minWidth={230} />;
}
