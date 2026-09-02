/**
 * Period close — the pane on the right.
 *
 * Three panes, one slot. The period is the default: its window, its status, its control
 * totals and the two commands that change it. When a checklist row is selected the
 * pane becomes that row instead, because the question then is "why can't I sign this",
 * and the answer is the dependency list with each name's own state beside it. In the
 * register the pane becomes the selected control and its test history, because the
 * question there is "when was this last done, and what did it find".
 *
 * The close button lives here as well as on the toolbar, and it is the same command.
 * A pane that shows an unbalanced month and no way to act on it just moves the mouse.
 */
import {
  Archive,
  BadgeCheck,
  Ban,
  CalendarRange,
  ClipboardCheck,
  ClipboardCopy,
  Clock,
  ListChecks,
  Lock,
  Pencil,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, Card, fmt, InfoBar, PropertyRow, Section, StackedBar, useLocale } from '@/platform/sdk';
import {
  EPSILON,
  type FiscalPeriod,
  PERIOD_STATUS_LABEL,
  periodTone,
  TASK_STATUS_LABEL,
  taskTone,
} from '../shared/ledger';
import type { CloseBusy } from './actions';
import type { ChecklistRow, CloseAssessment } from './checks';
import {
  CONTROL_FREQUENCY_LABEL,
  CONTROL_RESULT_LABEL,
  CONTROL_STATE_LABEL,
  CONTROL_STATE_TONE,
  type ControlResult,
  controlState,
  type ControlTest,
  type FinancialControl,
} from './controls';

interface PeriodPaneProps {
  readonly period: FiscalPeriod | null;
  readonly assessment: CloseAssessment;
  readonly busy: CloseBusy;
  onCommand: (id: string) => void;
}

export function PeriodPane({ period, assessment, busy, onCommand }: PeriodPaneProps) {
  const { t, tr, lang } = useLocale();
  if (period === null) {
    return (
      <InfoBar icon={CalendarRange} title={tr('لا فترة', 'Aucune période', 'No period')}>
        {tr(
          'لا توجد فترة مالية في الدفتر بعد.',
          'Aucune période comptable dans le livre pour le moment.',
          'The book carries no fiscal period yet.',
        )}
      </InfoBar>
    );
  }
  const working = busy !== null;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={assessment.sealed ? Lock : CalendarRange} title={period.label}>
        <PropertyRow label={tr('الحالة', 'Statut', 'Status')}>
          <Badge tone={periodTone(period.status)}>{t(PERIOD_STATUS_LABEL[period.status])}</Badge>
        </PropertyRow>
        <PropertyRow label={tr('النافذة', 'Fenêtre', 'Window')} mono>
          {`${fmt.date(period.start, lang)} → ${fmt.date(period.end, lang)}`}
        </PropertyRow>
        {period.closedAt === null ? null : (
          <PropertyRow label={tr('أُقفلت في', 'Clôturée le', 'Closed at')} mono>
            {fmt.dateTime(period.closedAt, lang)}
          </PropertyRow>
        )}
        {period.closedBy === null ? null : (
          <PropertyRow label={tr('أقفلها', 'Clôturée par', 'Closed by')}>{period.closedBy}</PropertyRow>
        )}
      </Card>

      <PeriodTotals assessment={assessment} />

      <Section title={tr('قائمة الإقفال', 'Checklist', 'Checklist')}>
        <StackedBar
          height={12}
          format={(value) => fmt.integer(value, lang)}
          segments={[
            {
              label: t(TASK_STATUS_LABEL.certified),
              value: assessment.certified,
              color: 'var(--fx-success)',
            },
            {
              label: t(TASK_STATUS_LABEL.blocked),
              value: assessment.blocked,
              color: 'var(--fx-danger)',
            },
            {
              label: t(TASK_STATUS_LABEL.pending),
              value: Math.max(0, assessment.openTasks - assessment.blocked),
              color: 'var(--fx-accent)',
            },
          ]}
        />
      </Section>

      <CloseNotice assessment={assessment} />

      <div style={{ display: 'grid', gap: 8 }}>
        {assessment.closable ? (
          <Button
            block
            variant="accent"
            icon={Lock}
            busy={busy === 'close'}
            disabled={working}
            onClick={() => onCommand('close')}
          >
            {tr(`إقفال ${period.label}`, `Clôturer ${period.label}`, `Close ${period.label}`)}
          </Button>
        ) : (
          <Button
            block
            icon={RotateCw}
            busy={busy === 'reopen'}
            disabled={working}
            onClick={() => onCommand('reopen')}
          >
            {tr(`إعادة فتح ${period.label}`, `Réouvrir ${period.label}`, `Reopen ${period.label}`)}
          </Button>
        )}
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copy')}>
          {tr('نسخ الملخّص', 'Copier le résumé', 'Copy summary')}
        </Button>
      </div>
    </div>
  );
}

/** Posted entries and the two sums that have to agree. Draft counts are shown in red. */
function PeriodTotals({ assessment }: { readonly assessment: CloseAssessment }) {
  const { tr, lang } = useLocale();
  const off = Math.abs(assessment.difference) > EPSILON;
  return (
    <Section title={tr('مجاميع الرقابة', 'Totaux de contrôle', 'Control totals')}>
      <PropertyRow label={tr('قيود مرحّلة', 'Écritures comptabilisées', 'Posted entries')} mono>
        {fmt.integer(assessment.posted, lang)}
      </PropertyRow>
      {assessment.unposted === 0 ? null : (
        <PropertyRow label={tr('مسوّدات', 'Brouillons', 'Draft')} mono>
          <span style={{ color: 'var(--fx-danger)' }}>{fmt.integer(assessment.unposted, lang)}</span>
        </PropertyRow>
      )}
      {assessment.voided === 0 ? null : (
        <PropertyRow label={tr('ملغاة', 'Annulées', 'Voided')} mono>
          {fmt.integer(assessment.voided, lang)}
        </PropertyRow>
      )}
      <PropertyRow label={tr('مدين', 'Débit', 'Debit')} mono>
        {fmt.money(assessment.debit, 'DZD', lang)}
      </PropertyRow>
      <PropertyRow label={tr('دائن', 'Crédit', 'Credit')} mono>
        {fmt.money(assessment.credit, 'DZD', lang)}
      </PropertyRow>
      <PropertyRow label={tr('الفرق', 'Écart', 'Difference')} mono>
        <span style={{ color: off ? 'var(--fx-danger)' : 'var(--fx-success)', fontWeight: 600 }}>
          {fmt.money(assessment.difference, 'DZD', lang)}
        </span>
      </PropertyRow>
      {assessment.bookDifference === 0 ? null : (
        <PropertyRow label={tr('فرق الدفتر', 'Écart du livre', 'Book difference')} mono>
          <span
            style={{
              color: Math.abs(assessment.bookDifference) > EPSILON ? 'var(--fx-danger)' : 'var(--fx-text-secondary)',
            }}
          >
            {fmt.money(assessment.bookDifference, 'DZD', lang)}
          </span>
        </PropertyRow>
      )}
    </Section>
  );
}

/**
 * What the gate adds up to, in one sentence.
 *
 * The wording matters more than the colour: this window does not know what
 * `close_fiscal_period` will accept, and saying so is the difference between a finding
 * and a refusal.
 */
function CloseNotice({ assessment }: { readonly assessment: CloseAssessment }) {
  const { tr, lang } = useLocale();
  if (assessment.sealed) {
    return (
      <InfoBar tone="info" icon={Lock} title={tr('الفترة مقفلة', 'Période clôturée', 'Period closed')}>
        {tr(
          'لا يُرحَّل شيء داخلها. إعادة الفتح ممكنة وتُسجَّل بسببها.',
          'Rien ne s’y comptabilise plus. La réouverture est possible et journalisée avec son motif.',
          'Nothing posts into it any more. Reopening is possible, and logged with its reason.',
        )}
      </InfoBar>
    );
  }
  if (assessment.failures > 0) {
    const count = fmt.integer(assessment.failures, lang);
    return (
      <InfoBar tone="warning" title={tr(`${count} عائق`, `${count} obstacles`, `${count} blockers`)}>
        {tr(
          'الخادم هو من يقرّر. هذه النافذة تُبلّغ فقط، والإقفال متاح.',
          'C’est le serveur qui décide. Cette fenêtre ne fait que rapporter — la clôture reste possible.',
          'The server decides. This window only reports, and the close is still available.',
        )}
      </InfoBar>
    );
  }
  return (
    <InfoBar tone="success" icon={BadgeCheck} title={tr('لا عوائق', 'Aucun obstacle', 'No blockers')}>
      {tr(
        'كل فحص إمّا مطابق أو تحذير.',
        'Chaque contrôle est conforme ou en avertissement.',
        'Every check is a pass or a warning.',
      )}
    </InfoBar>
  );
}

/* ------------------------------------------------------------------ *
 * The selected checklist row
 * ------------------------------------------------------------------ */

interface TaskPaneProps {
  readonly row: ChecklistRow;
  readonly busy: CloseBusy;
  onCommand: (id: string) => void;
}

export function TaskPane({ row, busy, onCommand }: TaskPaneProps) {
  const { t, tr, lang } = useLocale();
  const working = busy !== null;
  const task = row.task;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={ListChecks} title={task.name}>
        <PropertyRow label={tr('الحالة', 'Statut', 'Status')}>
          <Badge tone={taskTone(task.status)}>{t(TASK_STATUS_LABEL[task.status])}</Badge>
        </PropertyRow>
        <PropertyRow label={tr('المسؤول', 'Responsable', 'Owner')}>
          {task.ownerId ?? tr('غير مُعيَّن', 'Non assignée', 'Unassigned')}
        </PropertyRow>
        {task.updatedAt === null ? null : (
          <PropertyRow label={tr('آخر تحديث', 'Mis à jour', 'Updated')} mono>
            {fmt.dateTime(task.updatedAt, lang)}
          </PropertyRow>
        )}
        <PropertyRow label={tr('العمق', 'Profondeur', 'Depth')} mono>
          {fmt.integer(row.depth, lang)}
        </PropertyRow>
      </Card>

      {task.dependencies.length === 0 ? null : (
        <Section title={tr('يعتمد على', 'Dépend de', 'Depends on')}>
          <div style={{ display: 'grid', gap: 6 }}>
            {task.dependencies.map((name) => (
              <div
                key={name}
                style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}
              >
                <span className="fx-title-ellipsis">{name}</span>
                {row.missing.includes(name) ? (
                  <Badge tone="danger" title={tr('لا مهمة بهذا الاسم', 'Aucune tâche de ce nom', 'No task by that name')}>
                    {tr('مفقودة', 'Introuvable', 'Missing')}
                  </Badge>
                ) : row.unmet.includes(name) ? (
                  <Badge tone="warning">{tr('غير مصدّقة', 'Non certifiée', 'Not certified')}</Badge>
                ) : (
                  <Badge tone="success" icon={BadgeCheck}>
                    {t(TASK_STATUS_LABEL.certified)}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {row.missing.length === 0 ? null : (
        <InfoBar tone="danger" title={tr('اسم بلا مهمة', 'Nom sans tâche', 'A name with no task')}>
          {tr(
            'التبعيات تُطابق بالاسم. اسم لا يوافق أي مهمة لا يمكن استيفاؤه أبدًا: صحّح القائمة.',
            'Les dépendances sont comparées par nom. Un nom qui ne correspond à aucune tâche ne pourra jamais être satisfait : corrigez la checklist.',
            'Dependencies are matched by name. A name matching no task can never be satisfied: fix the checklist.',
          )}
        </InfoBar>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <Button
          block
          variant="accent"
          icon={BadgeCheck}
          busy={busy === 'certify'}
          disabled={working || !row.actionable}
          onClick={() => onCommand('certify')}
        >
          {tr('تصديق المهمة', 'Certifier la tâche', 'Certify the task')}
        </Button>
        <Button
          block
          icon={Clock}
          disabled={working || task.status === 'inProgress'}
          onClick={() => onCommand('start')}
        >
          {tr('تعيينها قيد العمل', 'Marquer en cours', 'Mark in progress')}
        </Button>
        <Button
          block
          variant="danger"
          icon={Ban}
          disabled={working || task.status === 'blocked'}
          onClick={() => onCommand('block')}
        >
          {tr('تعيينها معلّقة', 'Marquer bloquée', 'Mark blocked')}
        </Button>
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copyTask')}>
          {tr('نسخ المهمة', 'Copier la tâche', 'Copy the task')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The selected control
 * ------------------------------------------------------------------ *
 * The card answers "when was this last done and what did it find"; the section under it
 * answers "and before that". The history is the selected control's only — loading every
 * control's tests to draw one column would read the whole table — so it is the pane and
 * not the grid that carries it.
 *
 * The three acts are disabled on `control.retired` and not on `controlState`, for the
 * same reason the context menu is: whether a control is overdue is a judgement about a
 * date, and whether it has been retired is a fact on the record.
 */

/**
 * The tone of one recorded conclusion, which is not the tone of the control's state.
 *
 * A test that passed is green here even when the control it belongs to is amber for being
 * overdue: the history says what happened in March, and the badge above it says where the
 * control stands today.
 */
const RESULT_TONE: Readonly<Record<ControlResult, 'success' | 'warning' | 'danger'>> = {
  passed: 'success',
  partial: 'warning',
  failed: 'danger',
};

interface ControlPaneProps {
  readonly control: FinancialControl;
  readonly tests: readonly ControlTest[];
  readonly testsLoading: boolean;
  /** The register's one clock, so this pane cannot disagree with the row it came from. */
  readonly now: number;
  readonly busy: CloseBusy;
  onCommand: (id: string) => void;
}

export function ControlPane({ control, tests, testsLoading, now, busy, onCommand }: ControlPaneProps) {
  const { t, tr, lang } = useLocale();
  const state = controlState(control, now);
  const dead = busy !== null || control.retired;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card icon={ShieldCheck} title={control.code}>
        <PropertyRow label={tr('الحالة', 'État', 'State')}>
          <Badge tone={CONTROL_STATE_TONE[state]}>{t(CONTROL_STATE_LABEL[state])}</Badge>
        </PropertyRow>
        <PropertyRow label={tr('التواتر', 'Fréquence', 'Frequency')}>
          {t(CONTROL_FREQUENCY_LABEL[control.frequency])}
        </PropertyRow>
        <PropertyRow label={tr('المسؤول', 'Responsable', 'Owner')}>
          {control.ownerRole ?? tr('غير مُعيَّن', 'Non assigné', 'Unassigned')}
        </PropertyRow>
        <PropertyRow label={tr('آخر اختبار', 'Dernier test', 'Last tested')} mono>
          {control.lastTestedAt === null
            ? tr('لم يُختبر بعد', 'Jamais testé', 'Never tested')
            : fmt.dateTime(control.lastTestedAt, lang)}
        </PropertyRow>
        {control.lastResult === null ? null : (
          <PropertyRow label={tr('النتيجة', 'Résultat', 'Result')}>
            {t(CONTROL_RESULT_LABEL[control.lastResult])}
          </PropertyRow>
        )}
        {control.population === '' ? null : (
          <PropertyRow label={tr('العيّنة', 'Population', 'Population')}>{control.population}</PropertyRow>
        )}
        {control.exceptions === '' ? null : (
          <PropertyRow label={tr('الاستثناءات', 'Exceptions', 'Exceptions')}>{control.exceptions}</PropertyRow>
        )}
      </Card>
      {control.description === '' ? null : (
        <div style={{ color: 'var(--fx-text-secondary)', fontSize: 'var(--fx-caption)', lineHeight: 1.5 }}>
          {control.description}
        </div>
      )}

      {control.retired ? (
        <InfoBar icon={Archive} title={tr('رقابة موقوفة', 'Contrôle retiré', 'Control retired')}>
          {tr(
            'هذه الرقابة لم تعد تُنفَّذ. سجلها محفوظ للمراجعة ولا يُعدَّل.',
            'Ce contrôle n’est plus exécuté. Son historique est conservé pour l’audit et ne se modifie pas.',
            'This control is no longer performed. Its record is kept for the audit and is not edited.',
          )}
        </InfoBar>
      ) : null}

      <Section
        title={tr('سجل الاختبارات', 'Historique des tests', 'Test history')}
        // The count is the history's own, not the register's: a control tested twice this
        // month has two rows here and one line in the grid.
        action={
          testsLoading ? undefined : (
            <span className="fx-num" style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
              {fmt.integer(tests.length, lang)}
            </span>
          )
        }
      >
        {tests.length === 0 ? (
          <div style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}>
            {testsLoading
              ? tr('جارٍ التحميل…', 'Chargement…', 'Loading…')
              : tr('لا اختبارات مسجّلة.', 'Aucun test enregistré.', 'No tests recorded.')}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {tests.map((test) => (
              <div key={test.id} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <span className="fx-num" style={{ fontSize: 'var(--fx-caption)' }}>
                    {fmt.dateTime(test.at, lang)}
                  </span>
                  <Badge tone={RESULT_TONE[test.result]}>{t(CONTROL_RESULT_LABEL[test.result])}</Badge>
                </div>
                <span
                  className="fx-title-ellipsis"
                  style={{ color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' }}
                  title={test.email}
                >
                  {test.email}
                  {test.population === '' ? '' : ` · ${tr('العيّنة', 'Population', 'Population')}: ${test.population}`}
                </span>
                {test.exceptions === '' ? null : (
                  <span
                    style={{ color: 'var(--fx-warning)', fontSize: 'var(--fx-caption)' }}
                    title={test.exceptions}
                  >
                    {test.exceptions}
                  </span>
                )}
                {test.note === '' ? null : (
                  <span style={{ color: 'var(--fx-text-secondary)', fontSize: 'var(--fx-caption)' }}>
                    {test.note}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
      <div style={{ display: 'grid', gap: 8 }}>
        <Button
          block
          variant="accent"
          icon={ClipboardCheck}
          busy={busy === 'test'}
          disabled={dead}
          onClick={() => onCommand('control:test')}
        >
          {tr('تسجيل اختبار', 'Enregistrer un test', 'Record a test')}
        </Button>
        <Button block icon={Pencil} disabled={dead} onClick={() => onCommand('control:edit')}>
          {tr('تعديل الرقابة', 'Modifier le contrôle', 'Edit the control')}
        </Button>
        <Button
          block
          variant="danger"
          icon={Archive}
          busy={busy === 'retire'}
          disabled={dead}
          onClick={() => onCommand('control:retire')}
        >
          {tr('إيقاف الرقابة', 'Retirer le contrôle', 'Retire the control')}
        </Button>
        {/* `copy` and not a private id: the command path's copy already follows the view. */}
        <Button block variant="subtle" icon={ClipboardCopy} onClick={() => onCommand('copy')}>
          {tr('نسخ الرقابة', 'Copier le contrôle', 'Copy the control')}
        </Button>
      </div>
    </div>
  );
}
