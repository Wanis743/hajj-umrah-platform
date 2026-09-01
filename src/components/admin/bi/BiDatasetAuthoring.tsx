/**
 * The authoring pane for one dataset: its own definition, its dimensions, its metrics, and
 * one editor beside them.
 *
 * Split from the picker for the same reason the canvas is split from the builder shell:
 * `datasetDetail` needs a non-null id, and a hook written to tolerate a null argument is a
 * hook that will one day be called with one. The shell chooses; this pane is mounted only
 * once something has been chosen.
 *
 * Four decisions worth naming, because each is a rule kept in exactly one place:
 *
 * 1. The cards own their chrome. `DatasetFormCard`, `DimensionFormCard` and
 *    `MetricFormCard` each wrap themselves in a `Panel`, compute their own issues from
 *    `biDefinitionState`, and disable their own Save. This pane supplies data and
 *    callbacks and nothing else -- a second issue computation here would be a second set
 *    of rules that drifts from the first.
 * 2. Two reconcile keys, not one. The dataset form is reset from the dataset row's own
 *    identity; the open editor is reconciled on the read's `generated_at`. One key for
 *    both would mean that saving a dimension -- which reloads the whole detail -- quietly
 *    discarded an unsaved edit to the dataset's name.
 * 3. `timeColumns` is offered only while the form still names the saved source. Choosing a
 *    different source makes the loaded column list describe a relation the form no longer
 *    names, and offering those columns would invite a default time column the trigger then
 *    refuses.
 * 4. A delete asks twice, in the house idiom rather than `window.confirm`. The row may be
 *    cited by a published dashboard or a live ratio operand, and those are refusals with
 *    authored sentences server-side rather than things this pane can predict.
 */
import { useState } from 'react';
import { ErrorBanner, Spinner } from '@/components/admin/ui';
import { biAnalytics } from '@/services/biAnalytics';
import { biCommands } from '@/services/domainCommands';
import type {
  BiDatasetDetail, BiDimension, BiMetric, BiSourceColumn, BiSourceSummary, BiStatus,
} from '@/types/bi';
import { DeniedBox, InlineNote, NoticeBar, Panel } from './atoms';
import { DatasetFormCard, DimensionFormCard } from './BiDefinitionForms';
import { BiStatusBar, DimensionList, MetricList } from './BiDefinitionLists';
import { MetricFormCard } from './BiMetricForm';
import type { DefinitionFilterField } from './BiFormFields';
import {
  datasetFormFrom, datasetInput, datasetPublishBlockers, dimensionFormFrom, dimensionInput,
  emptyDatasetForm, emptyDimensionForm, emptyMetricForm, metricFormFrom, metricInput,
  metricPublishBlockers, type DatasetForm, type DimensionForm, type MetricForm,
} from './biDefinitionState';
import { useBiI18n, useBiRead } from './biFormat';
import { useBiCommand } from './useBiCommand';

/** The one editor this pane opens, as a union. Two independent pieces of state would let
 *  both be open at once, which is two Saves for one dataset and no way to say which of
 *  them the reader meant. */
type Editing =
  | { kind: 'NONE' }
  | { kind: 'DIMENSION'; id: string | null; form: DimensionForm }
  | { kind: 'METRIC'; id: string | null; form: MetricForm };

/** A row proposed for deletion, carrying the name the list showed so the confirmation can
 *  say what it is about to remove. */
interface Pending { kind: 'DIMENSION' | 'METRIC'; id: string; label: string }

const CLOSED: Editing = { kind: 'NONE' };

/** A definition's own name, in the reader's language when it has one -- the same rule the
 *  lists and the canvas use. */
const nameOf = (
  row: { display_name: string; display_name_ar: string | null }, isAr: boolean,
): string => (isAr && row.display_name_ar ? row.display_name_ar : row.display_name);

/** The dataset row's identity, and only its own. `generated_at` changes on every read --
 *  including the reload a dimension save triggers -- so keying the dataset form on it
 *  would discard an unsaved name. `updated_at` catches an edit; status and version catch a
 *  publish even where no trigger maintains `updated_at`. */
const datasetStamp = (detail: BiDatasetDetail): string =>
  `${detail.dataset.updated_at}|${detail.dataset.status}|${detail.dataset.version}`;

/** Keep an open editor only while the row it edits still exists. A row deleted elsewhere
 *  leaves an editor pointed at nothing; a new row has no id and nothing to check. */
function reconcile(editing: Editing, detail: BiDatasetDetail): Editing {
  if (editing.kind === 'NONE' || editing.id === null) return editing;
  const wanted = editing.id;
  const rows: readonly { id: string }[] = editing.kind === 'DIMENSION'
    ? detail.dimensions
    : detail.metrics;
  return rows.some((row) => row.id === wanted) ? editing : CLOSED;
}

/** The dataset's own name, in the reader's language when it has one. Same rule as
 *  `nameOf`, but a dataset spells its Arabic name `name_ar` where a definition spells it
 *  `display_name_ar` -- the read's naming, not the write's. */
const datasetNameOf = (detail: BiDatasetDetail, isAr: boolean): string =>
  (isAr && detail.dataset.name_ar ? detail.dataset.name_ar : detail.dataset.name);

/**
 * The date and timestamp columns of the bound source -- and only while the form still
 * names that source.
 *
 * `private.bi_validate_dataset` accepts nothing else as a default time column. Once the
 * form names a different source the loaded columns describe a relation it no longer binds,
 * so offering them would invite a default the trigger then refuses.
 */
const timeColumnsOf = (
  detail: BiDatasetDetail, formSourceId: string,
): readonly BiSourceColumn[] => (formSourceId === (detail.source?.id ?? '')
  ? detail.source_columns
    .filter((column) => column.data_type === 'date' || column.data_type === 'timestamp')
  : []);

/**
 * What a filter may name: the dataset's dimensions first, then only the source columns no
 * dimension has claimed.
 *
 * The same recipe the analysis canvas uses, because a row filter and an ad-hoc filter mean
 * the same thing. The compiler resolves a name against dimensions first, so a shadowed
 * column offered twice would be one name carrying two meanings. The group labels arrive as
 * arguments because this is a module function and the language lives in a hook.
 */
function filterFieldsOf(
  detail: BiDatasetDetail, isAr: boolean, dimensionGroup: string, columnGroup: string,
): readonly DefinitionFilterField[] {
  const claimed = new Set(detail.dimensions.map((dimension) => dimension.key));
  return [
    ...detail.dimensions.map((dimension) => ({
      key: dimension.key,
      label: nameOf(dimension, isAr),
      dataType: dimension.data_type,
      group: dimensionGroup,
    })),
    ...detail.source_columns
      .filter((column) => !claimed.has(column.column_name))
      .map((column) => ({
        key: column.column_name,
        label: column.display_name || column.column_name,
        dataType: column.data_type,
        group: columnGroup,
      })),
  ];
}

export function BiDatasetAuthoring({ datasetId, sources, canDefine, onSaved }: {
  datasetId: string;
  sources: readonly BiSourceSummary[];
  canDefine: boolean;
  /** The catalog above holds a dataset's name, status and counts, so a write here makes it
   *  stale. The shell reloads it rather than this pane guessing at what changed. */
  onSaved: () => void;
}) {
  const { t, isAr } = useBiI18n();
  const cmd = useBiCommand();
  const { data, loading, error, reload } = useBiRead<BiDatasetDetail>(
    () => biAnalytics.datasetDetail(datasetId), [datasetId],
  );
  const [stamp, setStamp] = useState<string | null>(null);
  const [form, setForm] = useState<DatasetForm>(emptyDatasetForm);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(CLOSED);
  const [pending, setPending] = useState<Pending | null>(null);

  // Reconciled during render rather than in an effect, the way the dashboard's layout
  // draft is: an effect would paint one frame of the previous dataset's form beneath the
  // new dataset's lists.
  if (data !== null && datasetStamp(data) !== stamp) {
    setStamp(datasetStamp(data));
    setForm(datasetFormFrom(data));
  }
  if (data !== null && data.generated_at !== readAt) {
    setReadAt(data.generated_at);
    setEditing(reconcile(editing, data));
    setPending(null);
  }

  if (loading && data === null) return <Spinner className="p-10" />;
  if (data === null) {
    return (
      <ErrorBanner
        message={error ?? t('لم تُحمَّل المجموعة', 'Jeu non chargé', 'Dataset did not load')}
        onRetry={reload}
      />
    );
  }

  const detail = data;
  const saved = () => { reload(); onSaved(); };
  const close = () => { reload(); onSaved(); setEditing(CLOSED); };

  const saveDataset = () => {
    void cmd.run(() => biCommands.dataset.update(datasetId, datasetInput(form)), {
      notice: t('حُفظت المجموعة', 'Jeu enregistré', 'Dataset saved'),
      onSuccess: saved,
    });
  };

  // One handler for both governed kinds, because `set_bi_status_command` is one call whose
  // preconditions and refusals live in `private.bi_set_status` rather than here.
  const setStatus = (kind: 'DATASET' | 'METRIC', id: string, status: BiStatus) => {
    void cmd.run(() => biCommands.setStatus({ kind, id, status }), {
      notice: t('تغيّرت الحالة', 'Statut modifié', 'Status changed'),
      onSuccess: saved,
    });
  };

  const saveDimension = (id: string | null, next: DimensionForm) => {
    const input = dimensionInput(next, datasetId);
    void cmd.run(() => (id === null
      ? biCommands.dimension.create(input)
      : biCommands.dimension.update(id, input)), {
      notice: t('حُفظ البعد', 'Dimension enregistrée', 'Dimension saved'),
      onSuccess: close,
    });
  };

  const saveMetric = (id: string | null, next: MetricForm) => {
    const input = metricInput(next, datasetId);
    void cmd.run(() => (id === null
      ? biCommands.metric.create(input)
      : biCommands.metric.update(id, input)), {
      notice: t('حُفظ المقياس', 'Mesure enregistrée', 'Metric saved'),
      onSuccess: close,
    });
  };

  const remove = (row: Pending) => {
    void cmd.run(() => (row.kind === 'DIMENSION'
      ? biCommands.dimension.remove(row.id)
      : biCommands.metric.remove(row.id)), {
      notice: t('حُذف التعريف', 'Définition supprimée', 'Definition deleted'),
      onSuccess: close,
    });
  };

  // Opening an editor clears the last command's notice: a "saved" line left standing over
  // a fresh form reads as though the form had been saved.
  const openDimension = (row: BiDimension | null) => {
    cmd.clear();
    setPending(null);
    setEditing({
      kind: 'DIMENSION',
      id: row?.id ?? null,
      form: row === null ? emptyDimensionForm() : dimensionFormFrom(row),
    });
  };

  const openMetric = (row: BiMetric | null) => {
    cmd.clear();
    setPending(null);
    setEditing({
      kind: 'METRIC',
      id: row?.id ?? null,
      form: row === null ? emptyMetricForm() : metricFormFrom(row),
    });
  };

  const filterFields = filterFieldsOf(detail, isAr, t('بعد', 'Dimension', 'Dimension'),
    t('عمود المصدر', 'Colonne source', 'Source column'));
  const timeColumns = timeColumnsOf(detail, form.sourceId);
  const datasetName = datasetNameOf(detail, isAr);

  return (
    <div className="space-y-4">
      <BiStatusBar
        label={t('حالة المجموعة', 'Statut du jeu', 'Dataset status')}
        status={detail.dataset.status}
        canPublish={detail.can_publish}
        blockers={datasetPublishBlockers(detail)}
        busy={cmd.busy}
        onSet={(status) => setStatus('DATASET', datasetId, status)}
      />

      {cmd.notice !== null && <NoticeBar message={cmd.notice} onClose={cmd.clear} />}
      {cmd.error !== null && <ErrorBanner message={cmd.error} />}

      {pending !== null && (
        <DeleteConfirm
          label={pending.label}
          busy={cmd.busy}
          onConfirm={() => remove(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {canDefine ? (
        <DatasetFormCard
          form={form}
          sources={sources}
          timeColumns={timeColumns}
          filterFields={filterFields}
          existingKey={detail.dataset.key}
          busy={cmd.busy}
          onChange={setForm}
          onSave={saveDataset}
          onCancel={() => setForm(datasetFormFrom(detail))}
        />
      ) : (
        <Panel title={datasetName} subtitle={detail.dataset.key}>
          <DeniedBox
            message={t(
              'تعريف المجموعات صلاحية منفصلة لا تملكها — ما يلي للقراءة',
              'Définir un jeu est un privilège distinct que vous n’avez pas — ce qui suit est en lecture seule',
              'Defining datasets is a separate privilege you do not hold — what follows is read-only')}
          />
        </Panel>
      )}

      <DefinitionColumns
        detail={detail}
        canDefine={canDefine}
        busy={cmd.busy}
        editing={editing}
        filterFields={filterFields}
        onOpenDimension={openDimension}
        onOpenMetric={openMetric}
        onEditing={setEditing}
        onPending={setPending}
        onSaveDimension={saveDimension}
        onSaveMetric={saveMetric}
        onSetMetricStatus={(id, status) => setStatus('METRIC', id, status)}
      />
    </div>
  );
}

/**
 * The second press of a delete.
 *
 * `RowActions` in the lists fires its trash icon on the first press, so what arrives there
 * is a proposal and nothing is removed until this button is pressed. `window.confirm` is
 * not used anywhere in this admin: it blocks the window, it cannot be translated with the
 * rest of the screen, and it cannot say what the server might still refuse -- and these
 * two deletes do refuse, with authored sentences, for a definition a published dashboard
 * cites or a live ratio still names as an operand.
 */
function DeleteConfirm({ label, busy, onConfirm, onCancel }: {
  label: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useBiI18n();

  return (
    <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3">
      <p className="text-[13px] text-[var(--text-primary)]">
        {t(`احذف «${label}»؟`, `Supprimer « ${label} » ?`, `Delete “${label}”?`)}
      </p>
      <InlineNote tone="warn">
        {t('لا يمكن التراجع — وما تستشهد به لوحة منشورة أو نسبة قائمة يُرفض حذفه',
          'Irréversible — et ce qu’un tableau publié ou un ratio actif cite est refusé',
          'Not reversible — and what a published dashboard or a live ratio cites is refused')}
      </InlineNote>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={onConfirm}
        >
          {t('احذف', 'Supprimer', 'Delete')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
          {t('أبقِه', 'Conserver', 'Keep it')}
        </button>
      </div>
    </div>
  );
}

/**
 * The two lists, and the editor beside them.
 *
 * Split out of the pane for the reason the analysis canvas splits its rail from its result
 * pane: a nested closure's body counts against the function that holds it, and every
 * ternary in a `className` counts against its complexity. Both of those live here now.
 *
 * Without `can_define` there is nothing to edit, so the editor column is not rendered at
 * all and the lists take the full width -- a half-width read-only list beside a permanent
 * "pick something to edit" would be inviting a thing the reader cannot do.
 */
function DefinitionColumns({
  detail, canDefine, busy, editing, filterFields, onOpenDimension, onOpenMetric, onEditing,
  onPending, onSaveDimension, onSaveMetric, onSetMetricStatus,
}: {
  detail: BiDatasetDetail;
  canDefine: boolean;
  busy: boolean;
  editing: Editing;
  filterFields: readonly DefinitionFilterField[];
  onOpenDimension: (row: BiDimension | null) => void;
  onOpenMetric: (row: BiMetric | null) => void;
  onEditing: (editing: Editing) => void;
  onPending: (pending: Pending) => void;
  onSaveDimension: (id: string | null, form: DimensionForm) => void;
  onSaveMetric: (id: string | null, form: MetricForm) => void;
  onSetMetricStatus: (id: string, status: BiStatus) => void;
}) {
  const { isAr } = useBiI18n();

  return (
    <div className={canDefine ? 'grid grid-cols-1 gap-4 xl:grid-cols-2' : 'space-y-4'}>
      <div className="space-y-4">
        <DimensionList
          dimensions={detail.dimensions}
          isAr={isAr}
          canDefine={canDefine}
          busy={busy}
          activeId={editing.kind === 'DIMENSION' ? editing.id : null}
          onNew={() => onOpenDimension(null)}
          onEdit={onOpenDimension}
          onDelete={(row) => onPending({
            kind: 'DIMENSION', id: row.id, label: nameOf(row, isAr),
          })}
        />
        <MetricList
          metrics={detail.metrics}
          isAr={isAr}
          canDefine={canDefine}
          busy={busy}
          activeId={editing.kind === 'METRIC' ? editing.id : null}
          onNew={() => onOpenMetric(null)}
          onEdit={onOpenMetric}
          onDelete={(row) => onPending({
            kind: 'METRIC', id: row.id, label: nameOf(row, isAr),
          })}
        />
      </div>
      {canDefine && (
        <div className="min-w-0">
          <DefinitionEditor
            detail={detail}
            editing={editing}
            filterFields={filterFields}
            busy={busy}
            onEditing={onEditing}
            onPending={onPending}
            onSaveDimension={onSaveDimension}
            onSaveMetric={onSaveMetric}
            onSetMetricStatus={onSetMetricStatus}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One editor, for whichever definition is open.
 *
 * `const open = editing` is not a convenience. `editing` is a parameter here, and
 * TypeScript's narrowing of a parameter does not survive into the callbacks that close
 * over it -- a `const` alias narrowed once is what lets `onChange` spread it without a
 * non-null assertion.
 */
function DefinitionEditor({
  detail, editing, filterFields, busy, onEditing, onPending, onSaveDimension, onSaveMetric,
  onSetMetricStatus,
}: {
  detail: BiDatasetDetail;
  editing: Editing;
  filterFields: readonly DefinitionFilterField[];
  busy: boolean;
  onEditing: (editing: Editing) => void;
  onPending: (pending: Pending) => void;
  onSaveDimension: (id: string | null, form: DimensionForm) => void;
  onSaveMetric: (id: string | null, form: MetricForm) => void;
  onSetMetricStatus: (id: string, status: BiStatus) => void;
}) {
  const { t, isAr } = useBiI18n();

  if (editing.kind === 'DIMENSION') {
    const open = editing;
    const row = detail.dimensions.find((dimension) => dimension.id === open.id) ?? null;
    return (
      <DimensionFormCard
        form={open.form}
        columns={detail.source_columns}
        siblings={detail.dimensions}
        existing={row}
        busy={busy}
        onChange={(next) => onEditing({ ...open, form: next })}
        onSave={() => onSaveDimension(open.id, open.form)}
        onCancel={() => onEditing(CLOSED)}
        onDelete={row === null ? null : () => onPending({
          kind: 'DIMENSION', id: row.id, label: nameOf(row, isAr),
        })}
      />
    );
  }

  if (editing.kind === 'METRIC') {
    const open = editing;
    const row = detail.metrics.find((metric) => metric.id === open.id) ?? null;
    return (
      <div className="space-y-4">
        {/* A metric's governance sits beside its whole definition rather than as a column
            of buttons on the list, where each row's publish would mean something different
            and none of them would show what is being published. */}
        {row !== null && (
          <BiStatusBar
            label={t('حالة المقياس', 'Statut de la mesure', 'Metric status')}
            status={row.status}
            canPublish={detail.can_publish}
            blockers={metricPublishBlockers(detail)}
            busy={busy}
            onSet={(status) => onSetMetricStatus(row.id, status)}
          />
        )}
        <MetricFormCard
          form={open.form}
          columns={detail.source_columns}
          siblings={detail.metrics}
          existing={row}
          filterFields={filterFields}
          busy={busy}
          onChange={(next) => onEditing({ ...open, form: next })}
          onSave={() => onSaveMetric(open.id, open.form)}
          onCancel={() => onEditing(CLOSED)}
          onDelete={row === null ? null : () => onPending({
            kind: 'METRIC', id: row.id, label: nameOf(row, isAr),
          })}
        />
      </div>
    );
  }

  return (
    <p className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-[13px] text-[var(--text-muted)]">
      {t('اختر بعدًا أو مقياسًا لتحريره، أو أضف تعريفًا جديدًا',
        'Choisissez une dimension ou une mesure à modifier, ou ajoutez une définition',
        'Pick a dimension or a metric to edit, or add a new definition')}
    </p>
  );
}
