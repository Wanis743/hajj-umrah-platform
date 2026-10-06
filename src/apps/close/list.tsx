/**
 * Period close — the timeline and the three registers.
 *
 * The checklist is not a grid. A close is an ordered process with dependencies, and
 * the three things anybody wants from it — what is finished, what can be signed now,
 * what the next step is waiting on — are exactly what a table sorted by name
 * destroys. So it is a timeline: the sequence in the order it runs, each step
 * carrying its own gates, and the filled length of the rail *is* the progress.
 *
 * The checks grid is the one that carries an opinion. Every row states the finding, the
 * count behind it and — for the two control totals — the gap in money, and every row
 * that is not a pass offers the way to the app that can fix it.
 *
 * The trail is deliberately flat: timestamps, actions, resources, who. It is read when
 * somebody is asked "when was March closed, and by whom", and nothing else.
 *
 * The controls register carries two columns that disagree on purpose — the state and the
 * last result — because a control whose one test passed in March is `passed` and `overdue`
 * at once, and a grid that showed only the first would call it healthy forever.
 */
import type { MouseEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CircleSlash,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  Badge,
  Button,
  type Column,
  DataGrid,
  EmptyState,
  Spinner,
  Timeline,
  type TimelineState,
  type TimelineStep,
  fmt,
  useLocale,
} from '@/platform/sdk';
import { EPSILON, TASK_STATUS_LABEL, taskTone } from '../shared/ledger';
import { CHECK_APP } from './actions';
import {
  CHECK_HINT,
  CHECK_LABEL,
  CHECK_STATE_LABEL,
  type CheckId,
  type CheckState,
  type ChecklistRow,
  type CloseCheck,
} from './checks';
import {
  CONTROL_FREQUENCY_LABEL,
  CONTROL_RESULT_LABEL,
  CONTROL_STATE_LABEL,
  CONTROL_STATE_TONE,
  controlState,
  type FinancialControl,
} from './controls';
import type { AuditRow } from './model';

const STATE_ICON: Readonly<Record<CheckState, typeof BadgeCheck>> = {
  pass: BadgeCheck,
  warn: AlertTriangle,
  fail: ShieldAlert,
  skip: CircleSlash,
};

const STATE_TONE: Readonly<Record<CheckState, 'success' | 'warning' | 'danger' | 'neutral'>> = {
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
  skip: 'neutral',
};

/* ------------------------------------------------------------------ *
 * The seven findings
 * ------------------------------------------------------------------ */

interface CheckListProps {
  readonly checks: readonly CloseCheck[];
  readonly loading: boolean;
  onFix: (id: CheckId) => void;
}

export function CheckList({ checks, loading, onFix }: CheckListProps) {
  const { t, tr, lang } = useLocale();
  const columns: readonly Column<CloseCheck>[] = [
    {
      id: 'state',
      header: tr('النتيجة', 'Résultat', 'Result'),
      width: 138,
      render: (row) => (
        <Badge tone={STATE_TONE[row.state]} icon={STATE_ICON[row.state]}>
          {t(CHECK_STATE_LABEL[row.state])}
        </Badge>
      ),
    },
    {
      id: 'check',
      header: tr('الفحص', 'Contrôle', 'Check'),
      render: (row) => (
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          <span className="fx-title-ellipsis" style={{ fontWeight: 600 }}>
            {t(CHECK_LABEL[row.id])}
          </span>
          <span style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
            {t(CHECK_HINT[row.id])}
          </span>
        </div>
      ),
    },
    {
      id: 'count',
      header: tr('العدد', 'Nombre', 'Count'),
      width: 92,
      align: 'end',
      mono: true,
      render: (row) => fmt.integer(row.count, lang),
    },
    {
      id: 'amount',
      header: tr('الفرق', 'Écart', 'Difference'),
      width: 156,
      align: 'end',
      mono: true,
      render: (row) =>
        row.amount === null ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          <span style={{ color: Math.abs(row.amount) > EPSILON ? 'var(--fx-danger)' : undefined }}>
            {fmt.money(row.amount, 'DZD', lang)}
          </span>
        ),
    },
    {
      id: 'go',
      header: '',
      width: 124,
      render: (row) =>
        row.state === 'pass' || row.state === 'skip' ? null : (
          <Button
            size="sm"
            variant="subtle"
            icon={CHECK_APP[row.id] === null ? ArrowRight : ExternalLink}
            onClick={() => onFix(row.id)}
          >
            {CHECK_APP[row.id] === null ? tr('عرض', 'Afficher', 'Show') : tr('فتح', 'Ouvrir', 'Open')}
          </Button>
        ),
    },
  ];

  return (
    <DataGrid
      rows={checks}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      onActivate={(row) => onFix(row.id)}
      rowTone={(row) => (row.state === 'pass' || row.state === 'skip' ? undefined : STATE_TONE[row.state])}
      empty={<EmptyState icon={BadgeCheck} title={tr('لا فحوص', 'Aucun contrôle', 'No checks')} />}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The checklist
 * ------------------------------------------------------------------ */

interface TaskListProps {
  readonly rows: readonly ChecklistRow[];
  readonly selectedId: string | null;
  readonly loading: boolean;
  readonly searching: boolean;
  onSelect: (id: string | null) => void;
  onActivate: (row: ChecklistRow) => void;
  onContext: (row: ChecklistRow, event: MouseEvent) => void;
}

/**
 * Which of the four states a row is in, from the two facts that decide it.
 *
 * The task's own status is not enough on its own. A task the server calls `pending`
 * may be the next thing anybody can sign or may be four certifications away from
 * being signable, and a checklist that drew both the same way is the checklist
 * people stop reading. So `actionable` — the dependency walk's verdict — is what
 * separates the step that is live from the steps queued behind it.
 */
function stateOf(row: ChecklistRow): TimelineState {
  if (row.task.status === 'certified') return 'done';
  if (row.task.status === 'blocked' || row.missing.length > 0) return 'blocked';
  return row.actionable ? 'active' : 'waiting';
}

/**
 * The close checklist, drawn as the sequence it is worked in.
 *
 * A period close is an ordered process with dependencies, and a grid sorted by name
 * loses the only thing about it that matters: what is finished, what can be signed
 * now, and what the next thing is waiting for. The rail carries that, and the
 * filled length of it *is* the progress — not a percentage printed somewhere else
 * that can disagree with the rows.
 *
 * Each step's gates are its own dependencies, each already evaluated, so "waiting
 * on Bank reconciliation" is on the step rather than in a tooltip. A dependency
 * naming a task that does not exist is a gate that can never close, and it says so
 * in words: that is data somebody typed, and the only way it gets fixed is by being
 * read.
 *
 * Every state has a glyph as well as a colour, because red-for-blocked and
 * green-for-done is not a distinction everybody can make, and this is the screen
 * where "blocked" has to be unmissable.
 */
export function TaskList({ rows, selectedId, loading, searching, onSelect, onActivate, onContext }: TaskListProps) {
  const { t, tr, lang } = useLocale();

  if (loading && rows.length === 0) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BadgeCheck}
        title={
          searching
            ? tr('لا نتائج', 'Aucun résultat', 'No matches')
            : tr('لا مهام إقفال', 'Aucune tâche de clôture', 'No close tasks')
        }
        description={
          searching
            ? undefined
            : tr(
                'قائمة الإقفال فارغة: لا شيء يُوقَّع لهذا الشهر.',
                'La checklist est vide : rien à signer pour ce mois.',
                'The checklist is empty: nothing to sign off for this month.',
              )
        }
      />
    );
  }

  const byName = new Map(rows.map((row) => [row.task.name, row]));
  const steps: readonly TimelineStep[] = rows.map((row) => ({
    id: row.task.id,
    title: row.task.name,
    state: stateOf(row),
    meta: (
      <>
        <Badge tone={taskTone(row.task.status)}>{t(TASK_STATUS_LABEL[row.task.status])}</Badge>
        {row.task.ownerId === null ? null : <span>{row.task.ownerId}</span>}
        {row.task.updatedAt === null ? null : (
          <span className="fx-mono">{fmt.dateTime(row.task.updatedAt, lang)}</span>
        )}
      </>
    ),
    gates: row.task.dependencies.map((name) => ({
      label:
        byName.has(name)
          ? name
          : `${name} — ${tr('لا مهمة بهذا الاسم', 'aucune tâche de ce nom', 'no task by that name')}`,
      ok: byName.get(name)?.task.status === 'certified',
    })),
  }));

  return (
    <div
      className="fx-scroll"
      style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      // Double-click signs the step and right-click opens the row menu, exactly as they
      // did on the grid. The timeline owns the single click, so the delegation here is
      // only for the two gestures it has no opinion about.
      onDoubleClick={() => {
        const row = rows.find((candidate) => candidate.task.id === selectedId);
        if (row !== undefined) onActivate(row);
      }}
      onContextMenu={(event) => {
        const row = rows.find((candidate) => candidate.task.id === selectedId);
        if (row !== undefined) onContext(row, event);
      }}
    >
      <Timeline
        steps={steps}
        selected={selectedId}
        onSelect={onSelect}
        label={tr('خطوات الإقفال', 'Étapes de clôture', 'Close checklist')}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The trail
 * ------------------------------------------------------------------ */

interface TrailListProps {
  readonly rows: readonly AuditRow[];
  readonly loading: boolean;
  readonly searching: boolean;
  onActivate: (row: AuditRow) => void;
}

export function TrailList({ rows, loading, searching, onActivate }: TrailListProps) {
  const { tr, lang } = useLocale();
  const columns: readonly Column<AuditRow>[] = [
    {
      id: 'at',
      header: tr('الوقت', 'Horodatage', 'Timestamp'),
      width: 180,
      mono: true,
      sort: (a, b) => a.at.localeCompare(b.at),
      render: (row) => fmt.dateTime(row.at, lang),
    },
    {
      id: 'action',
      header: tr('الإجراء', 'Action', 'Action'),
      width: 220,
      sort: (a, b) => a.action.localeCompare(b.action),
      render: (row) => <span className="fx-title-ellipsis">{row.action}</span>,
    },
    {
      id: 'resource',
      header: tr('المورد', 'Ressource', 'Resource'),
      width: 180,
      render: (row) => <span className="fx-title-ellipsis">{row.resource}</span>,
    },
    {
      id: 'resourceId',
      header: tr('المعرّف', 'Identifiant', 'Identifier'),
      mono: true,
      // The request id is what ties a row to everything else the same call touched,
      // which is exactly the question an auditor asks second.
      render: (row) => (
        <span className="fx-title-ellipsis" title={row.requestId ?? undefined}>
          {row.resourceId ?? '—'}
        </span>
      ),
    },
    {
      id: 'user',
      header: tr('المستخدم', 'Utilisateur', 'User'),
      width: 220,
      sort: (a, b) => a.email.localeCompare(b.email),
      render: (row) => <span className="fx-title-ellipsis">{row.email}</span>,
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      density="compact"
      virtualized
      onActivate={onActivate}
      empty={
        <EmptyState
          icon={ShieldAlert}
          title={
            searching
              ? tr('لا نتائج', 'Aucun résultat', 'No matches')
              : tr('لا أحداث', 'Aucun événement', 'No events')
          }
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The controls register
 * ------------------------------------------------------------------ */

interface ControlListProps {
  readonly rows: readonly FinancialControl[];
  readonly selectedId: string | null;
  /** One clock for the whole register, so no two rows can disagree about `overdue`. */
  readonly now: number;
  readonly loading: boolean;
  readonly searching: boolean;
  onSelect: (id: string | null) => void;
  onContext: (control: FinancialControl, event: MouseEvent) => void;
}

export function ControlList({
  rows,
  selectedId,
  now,
  loading,
  searching,
  onSelect,
  onContext,
}: ControlListProps) {
  const { t, tr, lang } = useLocale();
  const columns: readonly Column<FinancialControl>[] = [
    {
      id: 'state',
      header: tr('الحالة', 'État', 'State'),
      width: 132,
      sort: (a, b) => controlState(a, now).localeCompare(controlState(b, now)),
      render: (row) => {
        const state = controlState(row, now);
        return <Badge tone={CONTROL_STATE_TONE[state]}>{t(CONTROL_STATE_LABEL[state])}</Badge>;
      },
    },
    {
      id: 'control',
      header: tr('الرقابة', 'Contrôle', 'Control'),
      sort: (a, b) => a.code.localeCompare(b.code),
      render: (row) => (
        <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
          <span className="fx-title-ellipsis" style={{ fontWeight: 600 }}>
            {row.code}
          </span>
          {row.description === '' ? null : (
            <span
              className="fx-title-ellipsis"
              style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}
            >
              {row.description}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'frequency',
      header: tr('التواتر', 'Fréquence', 'Frequency'),
      width: 128,
      sort: (a, b) => a.frequency.localeCompare(b.frequency),
      render: (row) => t(CONTROL_FREQUENCY_LABEL[row.frequency]),
    },
    {
      id: 'owner',
      header: tr('المسؤول', 'Responsable', 'Owner'),
      width: 168,
      render: (row) =>
        row.ownerRole === null ? <span style={{ color: 'var(--fx-text-disabled)' }}>—</span> : row.ownerRole,
    },
    {
      id: 'tested',
      header: tr('آخر اختبار', 'Dernier test', 'Last tested'),
      width: 164,
      mono: true,
      sort: (a, b) => (a.lastTestedAt ?? '').localeCompare(b.lastTestedAt ?? ''),
      render: (row) =>
        row.lastTestedAt === null ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          fmt.dateTime(row.lastTestedAt, lang)
        ),
    },
    {
      id: 'result',
      header: tr('النتيجة', 'Résultat', 'Result'),
      width: 176,
      render: (row) =>
        row.lastResult === null ? (
          <span style={{ color: 'var(--fx-text-disabled)' }}>—</span>
        ) : (
          <div style={{ display: 'grid', gap: 1, minWidth: 0 }}>
            <span>{t(CONTROL_RESULT_LABEL[row.lastResult])}</span>
            {row.exceptions === '' ? null : (
              <span
                className="fx-title-ellipsis"
                style={{ color: 'var(--fx-warning)', fontSize: 'var(--fx-caption)' }}
                title={row.exceptions}
              >
                {row.exceptions}
              </span>
            )}
          </div>
        ),
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      density="compact"
      virtualized
      selectedKeys={selectedId === null ? undefined : new Set([selectedId])}
      onSelectionChange={(keys) => {
        const list = [...keys];
        onSelect(list.length === 0 ? null : list[0]);
      }}
      onRowContextMenu={onContext}
      // Only a failed test tints the whole row. Overdue is the common state of a real
      // register in the days after a month end, and a grid where most rows are amber has
      // stopped saying anything; the badge column still carries it.
      rowTone={(row) => (controlState(row, now) === 'failing' ? CONTROL_STATE_TONE.failing : undefined)}
      empty={
        <EmptyState
          icon={ShieldCheck}
          title={
            searching
              ? tr('لا نتائج', 'Aucun résultat', 'No matches')
              : tr('لا رقابات', 'Aucun contrôle', 'No controls')
          }
          description={
            searching
              ? undefined
              : tr(
                  'سجل الرقابات فارغ: لا شيء يُختبر بعد.',
                  'Le registre des contrôles est vide : rien à tester encore.',
                  'The controls register is empty: nothing to test yet.',
                )
          }
        />
      }
    />
  );
}
