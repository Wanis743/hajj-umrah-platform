/**
 * The governance bar, and the two lists a dataset is authored through.
 *
 * The status bar offers all three statuses minus the current one, because
 * `private.bi_set_status` imposes no from-state rule at all -- a deprecated definition can
 * be pulled straight back to draft, and a draft can be deprecated without ever having been
 * published. What it does impose is preconditions, and the two that are answerable from a
 * loaded dataset are named on the button rather than discovered by pressing it: a dataset
 * publishes only with a source, a dimension and a metric; a metric publishes only after its
 * dataset. The rest -- a deprecation a published dashboard would blank, a ratio operand
 * still in use -- are refusals with authored sentences, and pressing the button is how a
 * reader learns them, because nothing on this screen knows which dashboards exist.
 *
 * `canPublish` is `BiDatasetDetail.can_publish`: the server's own answer for this row, not a
 * role name this layer matched. The grant is held by no role in the seed, so in practice it
 * is ADMIN-only -- which is a decision recorded in the migration, not one to re-derive here.
 */
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BiDimension, BiMetric, BiStatus } from '@/types/bi';
import { InlineNote, Panel, Pill, StatusPill } from './atoms';
import { fmtInt, useBiI18n, useBiLabels } from './biFormat';
import type { PublishBlocker } from './biDefinitionState';

/** Draft, published, deprecated: the order a definition normally travels, used for the
 *  buttons so the bar reads the same on every row. */
const STATUS_ORDER: readonly BiStatus[] = ['DRAFT', 'PUBLISHED', 'DEPRECATED'];

/** A definition's own name, in the reader's language when it has one -- the same rule the
 *  canvas uses, because a dimension renamed in Arabic must read the same in both places. */
const nameOf = (
  row: { display_name: string; display_name_ar: string | null }, isAr: boolean,
): string => (isAr && row.display_name_ar ? row.display_name_ar : row.display_name);

/** Where a number comes from, in one line. A RATIO's formula is blank by trigger, so
 *  printing it would show nothing next to a metric that plainly computes something. */
const metricHint = (metric: BiMetric): string => (metric.aggregate === 'RATIO'
  ? `${metric.numerator_metric_key ?? '?'} / ${metric.denominator_metric_key ?? '?'}`
  : `${metric.aggregate}(${metric.formula})`);

/** One sentence per precondition, in the same voice as the 22023 the server would have
 *  raised. A reader who fixes the named thing and presses the button then succeeds, which
 *  is the only way to tell a predicted refusal from a guess. */
function usePublishBlockerText(): (blocker: PublishBlocker) => string {
  const { t } = useBiI18n();

  return (blocker: PublishBlocker): string => {
    switch (blocker) {
      case 'NO_SOURCE':
        return t('اربط مصدرًا قبل النشر — المجموعة المنشورة تقرأ علاقة فعلية',
          'Liez une source avant de publier — un jeu publié lit une relation réelle',
          'Bind a source before publishing — a published dataset reads a real relation');
      case 'NO_DIMENSION':
        return t('عرّف بعدًا واحدًا على الأقل قبل النشر',
          'Définissez au moins une dimension avant de publier',
          'Define at least one dimension before publishing');
      case 'NO_METRIC':
        return t('عرّف مقياسًا واحدًا على الأقل قبل النشر',
          'Définissez au moins une mesure avant de publier',
          'Define at least one metric before publishing');
      case 'DATASET_NOT_PUBLISHED':
        return t('انشر المجموعة التي يقوم عليها هذا المقياس أولًا',
          'Publiez d’abord le jeu de données derrière cette mesure',
          'Publish the dataset behind this metric first');
    }
  };
}

/**
 * The one governance control, used for a dataset and for a metric.
 *
 * Every status is offered except the one already held, and PUBLISHED is withheld only when
 * a precondition this screen can see is unmet. `canPublish` off disables the whole bar and
 * says so, rather than hiding it: a reader who cannot publish still needs to know that
 * publishing is what this definition is waiting for.
 */
export function BiStatusBar({ label, status, canPublish, blockers, busy, onSet }: {
  label: string;
  status: BiStatus;
  canPublish: boolean;
  blockers: readonly PublishBlocker[];
  busy: boolean;
  onSet: (status: BiStatus) => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const blockerText = usePublishBlockerText();

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
        <StatusPill status={status} label={labels.status[status]} />
        <span className="flex flex-wrap items-center gap-1.5 sm:ms-auto">
          {STATUS_ORDER.filter((next) => next !== status).map((next) => (
            <button
              key={next}
              type="button"
              className={next === 'PUBLISHED' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              disabled={busy || !canPublish || (next === 'PUBLISHED' && blockers.length > 0)}
              onClick={() => onSet(next)}
            >
              {t(`إلى ${labels.status[next]}`, `Vers ${labels.status[next]}`,
                `To ${labels.status[next]}`)}
            </button>
          ))}
        </span>
      </div>
      {canPublish
        ? blockers.map((blocker) => (
          <InlineNote key={blocker} tone="warn">{blockerText(blocker)}</InlineNote>
        ))
        : (
          <InlineNote tone="neutral">
            {t('تغيير حالة التعريف صلاحية منفصلة لا تملكها',
              'Changer le statut d’une définition est un privilège distinct que vous n’avez pas',
              'Changing a definition’s status is a separate privilege you do not hold')}
          </InlineNote>
        )}
    </div>
  );
}

/** Edit and delete, as icons, because the row is the label. Rendered only where the caller
 *  holds `can_define`: a reader without it sees the definitions and no controls, which is a
 *  working screen rather than a wall of disabled buttons. */
function RowActions({ busy, editLabel, deleteLabel, onEdit, onDelete }: {
  busy: boolean;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={editLabel}
        title={editLabel}
        disabled={busy}
        onClick={onEdit}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={deleteLabel}
        title={deleteLabel}
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </>
  );
}

/**
 * The dimensions of a dataset, as the list they are authored through.
 *
 * A row states the three things that decide whether it can be grouped by -- its key, its
 * expression and its declared type -- because a dimension whose expression is hidden is a
 * name a reader is asked to trust. Drill-to and drill-through are printed only where they
 * exist: most dimensions have neither, and a "no drill" on every row would bury the few
 * that do.
 */
export function DimensionList({
  dimensions, isAr, canDefine, busy, activeId, onNew, onEdit, onDelete,
}: {
  dimensions: readonly BiDimension[];
  isAr: boolean;
  canDefine: boolean;
  busy: boolean;
  activeId: string | null;
  onNew: () => void;
  onEdit: (row: BiDimension) => void;
  onDelete: (row: BiDimension) => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const count = fmtInt(dimensions.length);

  return (
    <Panel
      title={t(`الأبعاد (${count})`, `Dimensions (${count})`, `Dimensions (${count})`)}
      subtitle={t('ما يُجمَّع عليه، وما يُفتح تحته',
        'Ce sur quoi on regroupe, et ce qui s’ouvre en dessous',
        'What may be grouped by, and what opens beneath it')}
      actions={canDefine ? (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onNew}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('بعد جديد', 'Nouvelle dimension', 'New dimension')}
        </button>
      ) : null}
    >
      {dimensions.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          {t('لا أبعاد بعد — المجموعة المنشورة تحتاج واحدًا على الأقل',
            'Aucune dimension — un jeu publié en exige au moins une',
            'No dimensions yet — a published dataset needs at least one')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {dimensions.map((row) => (
            <li
              key={row.id}
              className={`rounded-lg border p-2 ${row.id === activeId
                ? 'border-[var(--accent)] bg-[var(--bg-hover)]'
                : 'border-[var(--border)]'}`}
            >
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
                    {nameOf(row, isAr)}
                    {row.is_default && (
                      <Pill tone="info">{t('افتراضي', 'Par défaut', 'Default')}</Pill>
                    )}
                  </p>
                  <p
                    className="truncate font-mono text-[11px] text-[var(--text-muted)]"
                    dir="ltr"
                    title={row.expression}
                  >
                    {row.key} = {row.expression}
                  </p>
                  {row.drill_to_key !== null && (
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {t(`ينقّب إلى ${row.drill_to_key}`, `Explore vers ${row.drill_to_key}`,
                        `Drills down to ${row.drill_to_key}`)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Pill tone="neutral">{row.data_type}</Pill>
                  {row.drill_through_kind !== null && (
                    <Pill tone="info" title={row.drill_through_expression ?? undefined}>
                      {labels.drillThrough[row.drill_through_kind]}
                    </Pill>
                  )}
                  {canDefine && (
                    <RowActions
                      busy={busy}
                      editLabel={t('عدّل البعد', 'Modifier la dimension', 'Edit dimension')}
                      deleteLabel={t('احذف البعد', 'Supprimer la dimension', 'Delete dimension')}
                      onEdit={() => onEdit(row)}
                      onDelete={() => onDelete(row)}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The metrics of a dataset, each with the status that decides whether the compiler will
 * accept it.
 *
 * A DEPRECATED metric is still listed and still editable -- deprecation is a governance
 * state, not a delete -- but `bi_compile_query` refuses it, which makes the status pill the
 * most load-bearing thing on the row. Governance itself is not repeated per row: the status
 * bar lives in the metric editor, where the reader has one metric's whole definition in
 * front of them instead of a column of buttons that each mean a different publish.
 */
export function MetricList({
  metrics, isAr, canDefine, busy, activeId, onNew, onEdit, onDelete,
}: {
  metrics: readonly BiMetric[];
  isAr: boolean;
  canDefine: boolean;
  busy: boolean;
  activeId: string | null;
  onNew: () => void;
  onEdit: (row: BiMetric) => void;
  onDelete: (row: BiMetric) => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const count = fmtInt(metrics.length);

  return (
    <Panel
      title={t(`المقاييس (${count})`, `Mesures (${count})`, `Metrics (${count})`)}
      subtitle={t('ما يُقاس، وكيف يُطوى', 'Ce qui est mesuré, et comment cela se replie',
        'What is measured, and how it folds')}
      actions={canDefine ? (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onNew}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('مقياس جديد', 'Nouvelle mesure', 'New metric')}
        </button>
      ) : null}
    >
      {metrics.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          {t('لا مقاييس بعد — المجموعة المنشورة تحتاج واحدًا على الأقل',
            'Aucune mesure — un jeu publié en exige au moins une',
            'No metrics yet — a published dataset needs at least one')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {metrics.map((row) => (
            <li
              key={row.id}
              className={`rounded-lg border p-2 ${row.id === activeId
                ? 'border-[var(--accent)] bg-[var(--bg-hover)]'
                : 'border-[var(--border)]'}`}
            >
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--text-primary)]">
                    {nameOf(row, isAr)}
                    <StatusPill status={row.status} label={labels.status[row.status]} />
                    {!row.is_additive && (
                      <Pill tone="warn">{t('غير جمعي', 'Non additive', 'Non-additive')}</Pill>
                    )}
                  </p>
                  <p
                    className="truncate font-mono text-[11px] text-[var(--text-muted)]"
                    dir="ltr"
                    title={metricHint(row)}
                  >
                    {row.key} = {metricHint(row)}
                  </p>
                  {row.filter_json.length > 0 && (
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {t(`مُرشَّح بـ ${fmtInt(row.filter_json.length)} شرطًا`,
                        `Filtré par ${fmtInt(row.filter_json.length)} condition(s)`,
                        `Filtered by ${fmtInt(row.filter_json.length)} condition(s)`)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Pill tone="neutral">
                    {labels.metricFormat[row.format]}
                    {row.unit === null ? '' : ` · ${row.unit}`}
                  </Pill>
                  {canDefine && (
                    <RowActions
                      busy={busy}
                      editLabel={t('عدّل المقياس', 'Modifier la mesure', 'Edit metric')}
                      deleteLabel={t('احذف المقياس', 'Supprimer la mesure', 'Delete metric')}
                      onEdit={() => onEdit(row)}
                      onDelete={() => onDelete(row)}
                    />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
