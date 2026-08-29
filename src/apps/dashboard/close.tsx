/**
 * Dashboard — the close page.
 *
 * The checklist and the periods, side by side, because the question at month end is
 * never "what is the balance" — it is "what is left before I can lock the month".
 *
 * Two things here are computed rather than read, and both matter:
 *
 *   • A step is *ready* when every task it depends on is certified. The schema stores
 *     dependencies as names, so `blockedBy` is a name list, printed as written — a step
 *     that waits on something nobody named is a data problem, not a display problem.
 *   • A period's entry counts are by entry *date*, not by `fiscal_period_id`, because
 *     the server stamps that column at approval: a draft dated inside the month has no
 *     period id at all, and drafts are exactly what somebody wants to see before they
 *     close it.
 *
 * This app cannot certify a step or close a period — it declares neither `ledger.close`
 * nor anything else privileged. Every row leads to the app that can.
 */
import type { CSSProperties } from 'react';
import { ArrowRight, Ban, BadgeCheck, CalendarRange, Check, ListChecks } from 'lucide-react';
import {
  Badge,
  type BarDatum,
  Button,
  Card,
  type Column,
  DataGrid,
  EmptyState,
  fmt,
  KpiTile,
  ProgressBar,
  StackedBar,
  toneColor,
  useApp,
} from '@/platform/sdk';
import {
  PERIOD_STATUS_LABEL,
  periodTone,
  TASK_STATUS_LABEL,
  type TaskStatus,
  taskTone,
} from '../shared/ledger';
import {
  type CloseStep,
  type Destination,
  type Formatters,
  type PeriodState,
  type Snapshot,
  TO_CHECKLIST,
  TO_DRAFTS,
} from './metrics';

const PAGE: CSSProperties = { display: 'grid', gap: 16, alignContent: 'start' };
const KPI_GRID: CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(212px, 1fr))',
};

/** Certified first, blocked last: the order somebody reads a checklist in. */
const TASK_ORDER: readonly TaskStatus[] = ['certified', 'inProgress', 'pending', 'blocked'];

export interface ClosePageProps {
  readonly snap: Snapshot;
  readonly f: Formatters;
  onOpen: (destination: Destination) => void;
}

/** Where the close stands, what is left, and which months are still open. */
export function ClosePage({ snap, f, onOpen }: ClosePageProps) {
  const { t, tr } = useApp().locale;
  const close = snap.close;
  if (close.total === 0) {
    return (
      <div style={PAGE}>
        <EmptyState
          icon={ListChecks}
          title={tr('لا قائمة إقفال', 'Aucune liste de clôture', 'No checklist')}
          description={tr(
            'لم تُنشأ خطوات إقفال لهذا الدفتر بعد.',
            'Aucune étape de clôture n’a été créée pour ce livre.',
            'This book has no close steps yet.',
          )}
          action={
            <Button size="sm" icon={ArrowRight} onClick={() => onOpen(TO_CHECKLIST)}>
              {t(TO_CHECKLIST.label)}
            </Button>
          }
        />
        <PeriodCard snap={snap} f={f} onOpen={onOpen} />
      </div>
    );
  }
  return (
    <div style={PAGE}>
      <CloseTiles snap={snap} f={f} onOpen={onOpen} />
      <ProgressCard snap={snap} f={f} onOpen={onOpen} />
      <StepCard snap={snap} onOpen={onOpen} />
      <PeriodCard snap={snap} f={f} onOpen={onOpen} />
    </div>
  );
}

/** Four counts: done, left, actionable now, and stuck behind something else. */
function CloseTiles({ snap, f, onOpen }: ClosePageProps) {
  const { tr } = useApp().locale;
  const close = snap.close;
  const remaining = close.total - close.certified;
  const ready = close.steps.filter((step) => step.ready && step.task.status !== 'certified').length;
  return (
    <div style={KPI_GRID}>
      <KpiTile
        label={tr('مصدّقة', 'Certifiées', 'Certified')}
        value={`${f.integer(close.certified)} / ${f.integer(close.total)}`}
        secondary={f.percent(close.ratio)}
        icon={BadgeCheck}
        tone={remaining === 0 ? 'success' : undefined}
        onClick={() => onOpen(TO_CHECKLIST)}
      />
      <KpiTile
        label={tr('متبقية', 'Restantes', 'Remaining')}
        value={f.integer(remaining)}
        secondary={tr(
          `${f.integer(close.byStatus.inProgress)} جارية`,
          `${f.integer(close.byStatus.inProgress)} en cours`,
          `${f.integer(close.byStatus.inProgress)} in progress`,
        )}
        icon={ListChecks}
      />
      <KpiTile
        label={tr('جاهزة الآن', 'Prêtes', 'Ready now')}
        value={f.integer(ready)}
        secondary={close.next === null ? tr('لا شيء جاهز', 'Rien de prêt', 'Nothing is ready') : close.next.task.name}
        icon={Check}
        tone={ready === 0 ? undefined : 'accent'}
        onClick={() => onOpen(TO_CHECKLIST)}
      />
      <KpiTile
        label={tr('متعطّلة', 'Bloquées', 'Blocked')}
        value={f.integer(close.blocked.length)}
        secondary={tr('تنتظر خطوة أخرى', 'En attente d’une autre étape', 'Waiting on another step')}
        icon={Ban}
        tone={close.blocked.length === 0 ? 'success' : 'danger'}
      />
    </div>
  );
}

/** The bar, and the same number broken into the four states a step can be in. */
function ProgressCard({ snap, f, onOpen }: ClosePageProps) {
  const { t, tr } = useApp().locale;
  const close = snap.close;
  const done = close.certified === close.total;
  const segments: readonly BarDatum[] = TASK_ORDER.filter((status) => close.byStatus[status] > 0).map((status) => ({
    label: t(TASK_STATUS_LABEL[status]),
    value: close.byStatus[status],
    color: toneColor(taskTone(status)),
  }));
  return (
    <Card
      title={tr('التقدّم', 'Avancement', 'Progress')}
      subtitle={`${f.integer(close.certified)} / ${f.integer(close.total)} · ${f.percent(close.ratio)}`}
      icon={BadgeCheck}
      actions={
        <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(TO_CHECKLIST)}>
          {t(TO_CHECKLIST.label)}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <ProgressBar value={close.ratio} tone={done ? 'success' : 'accent'} height={8} />
        <StackedBar segments={segments} height={10} format={f.integer} />
      </div>
    </Card>
  );
}

/** The checklist's columns. `blockedBy` is printed as the schema stores it: names. */
function useStepColumns(): readonly Column<CloseStep>[] {
  const { t, tr, lang } = useApp().locale;
  return [
    {
      id: 'name',
      header: tr('الخطوة', 'Étape', 'Step'),
      render: (step) => step.task.name,
      sort: (a, b) => a.task.name.localeCompare(b.task.name),
    },
    {
      id: 'status',
      header: tr('الحالة', 'État', 'Status'),
      width: 132,
      render: (step) => <Badge tone={taskTone(step.task.status)}>{t(TASK_STATUS_LABEL[step.task.status])}</Badge>,
    },
    {
      id: 'blocked',
      header: tr('تنتظر', 'En attente de', 'Waiting on'),
      render: (step) =>
        step.blockedBy.length === 0 ? '—' : <span title={step.blockedBy.join(', ')}>{step.blockedBy.join(' · ')}</span>,
    },
    {
      id: 'ready',
      header: tr('جاهزة', 'Prête', 'Ready'),
      width: 118,
      render: (step) =>
        step.task.status === 'certified' ? (
          <Badge tone="success" icon={Check}>
            {tr('مصدّقة', 'Certifiée', 'Done')}
          </Badge>
        ) : step.ready ? (
          <Badge tone="accent">{tr('نعم', 'Oui', 'Yes')}</Badge>
        ) : (
          '—'
        ),
    },
    {
      id: 'updated',
      header: tr('آخر تحديث', 'Mise à jour', 'Updated'),
      width: 120,
      render: (step) => (step.task.updatedAt === null ? '—' : fmt.date(step.task.updatedAt, lang)),
      sort: (a, b) => (a.task.updatedAt ?? '').localeCompare(b.task.updatedAt ?? ''),
    },
  ];
}

interface StepCardProps {
  readonly snap: Snapshot;
  onOpen: (destination: Destination) => void;
}

/** The whole checklist, in dependency-aware order, with the door to the queue. */
function StepCard({ snap, onOpen }: StepCardProps) {
  const { t, tr, lang } = useApp().locale;
  const columns = useStepColumns();
  const steps = snap.close.steps;
  return (
    <Card
      title={tr('الخطوات', 'Étapes', 'Steps')}
      subtitle={tr(
        `${fmt.integer(steps.length, lang)} خطوة`,
        `${fmt.integer(steps.length, lang)} étapes`,
        `${fmt.integer(steps.length, lang)} steps`,
      )}
      icon={ListChecks}
      actions={
        <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(TO_CHECKLIST)}>
          {t(TO_CHECKLIST.label)}
        </Button>
      }
      padded={false}
    >
      <DataGrid
        rows={steps}
        columns={columns}
        rowKey={(step) => step.task.id}
        density="compact"
        rowTone={(step) => (step.task.status === 'blocked' ? 'danger' : undefined)}
        onActivate={() => onOpen(TO_CHECKLIST)}
      />
    </Card>
  );
}

/**
 * The periods' columns.
 *
 * `unposted` is the column somebody scans for: a closed month with drafts dated inside
 * it is either a mistake or an adjustment nobody finished, and the grid tints that row
 * rather than leaving the number to be noticed.
 */
function usePeriodColumns(f: Formatters): readonly Column<PeriodState>[] {
  const { t, tr, lang } = useApp().locale;
  return [
    {
      id: 'label',
      header: tr('الفترة', 'Période', 'Period'),
      render: (state) => state.period.label,
      sort: (a, b) => a.period.start.localeCompare(b.period.start),
    },
    {
      id: 'window',
      header: tr('من — إلى', 'Du — au', 'From — to'),
      width: 212,
      render: (state) => `${fmt.date(state.period.start, lang)} → ${fmt.date(state.period.end, lang)}`,
    },
    {
      id: 'status',
      header: tr('الحالة', 'État', 'Status'),
      width: 124,
      render: (state) => (
        <Badge tone={periodTone(state.period.status)}>{t(PERIOD_STATUS_LABEL[state.period.status])}</Badge>
      ),
    },
    {
      id: 'entries',
      header: tr('قيود', 'Écritures', 'Entries'),
      width: 96,
      align: 'end',
      mono: true,
      render: (state) => f.integer(state.entries),
      sort: (a, b) => a.entries - b.entries,
    },
    {
      id: 'unposted',
      header: tr('غير معتمدة', 'Non comptabilisées', 'Unposted'),
      width: 132,
      align: 'end',
      mono: true,
      render: (state) => (state.unposted === 0 ? '—' : f.integer(state.unposted)),
      sort: (a, b) => a.unposted - b.unposted,
    },
    {
      id: 'value',
      header: tr('المعتمد', 'Comptabilisé', 'Posted'),
      width: 152,
      align: 'end',
      mono: true,
      render: (state) => f.money(state.value),
      sort: (a, b) => a.value - b.value,
    },
  ];
}

/** The fiscal calendar, newest first, tinted where a closed month still has drafts. */
function PeriodCard({ snap, f, onOpen }: ClosePageProps) {
  const { t, tr } = useApp().locale;
  const columns = usePeriodColumns(f);
  const rows = snap.periods;
  return (
    <Card
      title={tr('الفترات', 'Périodes', 'Periods')}
      subtitle={tr(
        'محسوبة بتاريخ القيد، لا بفترته',
        'Comptées par date d’écriture, non par période',
        'Counted by entry date, not by period id',
      )}
      icon={CalendarRange}
      actions={
        <Button size="sm" variant="subtle" icon={ArrowRight} onClick={() => onOpen(TO_DRAFTS)}>
          {t(TO_DRAFTS.label)}
        </Button>
      }
      padded={false}
    >
      {rows.length === 0 ? (
        <div style={{ padding: 14 }}>
          <EmptyState
            compact
            icon={CalendarRange}
            title={tr('لا فترات', 'Aucune période', 'No periods')}
            description={tr(
              'لم تُعرّف سنة مالية لهذا الدفتر بعد.',
              'Aucun exercice n’est défini pour ce livre.',
              'This book has no fiscal calendar yet.',
            )}
          />
        </div>
      ) : (
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(state) => state.period.id}
          density="compact"
          rowTone={(state) => (state.period.status !== 'open' && state.unposted > 0 ? 'warning' : undefined)}
          onActivate={() => onOpen(TO_DRAFTS)}
        />
      )}
    </Card>
  );
}
