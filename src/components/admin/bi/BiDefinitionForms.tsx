/**
 * The dataset and dimension forms.
 *
 * These are controls over `DatasetForm` / `DimensionForm` and nothing else: each is handed a
 * form, an `onChange` that replaces it, and an `onSave` the parent turns into a `biCommands`
 * write through `useBiCommand`. No card fetches, and no card decides whether the caller may
 * write -- that gate lives on the screen above, where the server's own answer (`can_define`,
 * `can_publish`) is in hand.
 *
 * Each card computes its own issues rather than receiving them, so the Save button and the
 * list of reasons it is disabled can never disagree.
 */
import Select from '@/components/admin/GlassSelect';
import {
  BI_DRILL_THROUGH_KINDS, type BiDimension, type BiDrillThroughKind, type BiFilter,
  type BiSourceColumn, type BiSourceSummary,
} from '@/types/bi';
import { Field, Panel } from './atoms';
import { BiFilterEditor } from './BiFilterEditor';
import { useBiI18n, useBiLabels } from './biFormat';
import {
  BI_DIMENSION_DATA_TYPES, type DatasetForm, type DimensionForm,
  datasetIssues, dimensionIssues, renamesKey,
} from './biDefinitionState';
import {
  AreaRow, ColumnHints, FormActions, IssueList, RenameWarning, TextRow,
  type DefinitionFilterField,
} from './BiFormFields';

/**
 * The dataset itself: what it is called, what it reads, and what it hides.
 *
 * The source picker offers a null option because a dataset legitimately exists before its
 * source does -- `bi_datasets_published_needs_source` only bites at publish time, and
 * `private.bi_validate_dataset` refuses a row filter or a time column without one, which is
 * what the two source-dependent issues predict.
 *
 * `default_time_column` is a picker when the column list is in hand and a text box when it
 * is not, rather than a disabled control. The list is measured from the bound source, so a
 * dataset whose source was just changed has no list yet; disabling the field would trap a
 * stale value in it with no way to clear it.
 */
export function DatasetFormCard({
  form, sources, timeColumns, filterFields, existingKey, busy, onChange, onSave, onCancel,
}: {
  form: DatasetForm;
  sources: readonly BiSourceSummary[];
  timeColumns: readonly BiSourceColumn[];
  filterFields: readonly DefinitionFilterField[];
  existingKey: string | null;
  busy: boolean;
  onChange: (form: DatasetForm) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
}) {
  const { t, isAr } = useBiI18n();
  const issues = datasetIssues(form);
  const setFilters = (rowFilter: readonly BiFilter[]) => onChange({ ...form, rowFilter });

  return (
    <Panel
      title={existingKey === null
        ? t('مجموعة جديدة', 'Nouveau jeu', 'New dataset')
        : t('تعديل المجموعة', 'Modifier le jeu', 'Edit dataset')}
      subtitle={t('التعريف الدلالي: علاقة واحدة، وما يُسمح بقراءته منها',
        'La définition sémantique : une relation, et ce qu’on peut en lire',
        'The semantic definition: one relation, and what may be read from it')}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextRow
            label={t('المفتاح', 'Clé', 'Key')}
            hint={t('حروف صغيرة وأرقام وشرطة سفلية', 'minuscules, chiffres, tirets bas',
              'lowercase, digits, underscores')}
            value={form.key}
            onChange={(key) => onChange({ ...form, key })}
            placeholder="booking_revenue"
            code
          />
          <TextRow
            label={t('الاسم', 'Nom', 'Name')}
            value={form.name}
            onChange={(name) => onChange({ ...form, name })}
          />
          <TextRow
            label={t('الاسم العربي', 'Nom arabe', 'Arabic name')}
            hint={t('اختياري', 'facultatif', 'optional')}
            value={form.nameAr}
            onChange={(nameAr) => onChange({ ...form, nameAr })}
          />
          <Field label={t('المصدر', 'Source', 'Source')}>
            <Select
              className="input"
              value={form.sourceId}
              onChange={(event) => onChange({ ...form, sourceId: event.target.value })}
            >
              <option value="">{t('— بلا مصدر —', '— Aucune source —', '— No source —')}</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {`${(isAr && source.display_name_ar) ? source.display_name_ar : source.display_name}`
                    + ` · ${source.relation} · ${source.required_permission}`}
                </option>
              ))}
            </Select>
          </Field>
          {timeColumns.length > 0 ? (
            <Field
              label={t('عمود الزمن الافتراضي', 'Colonne temporelle par défaut',
                'Default time column')}
              hint={t('يُستخدم عند طلب حبّة زمنية', 'utilisée quand un grain temporel est demandé',
                'used when a time grain is asked for')}
            >
              <Select
                className="input"
                value={form.defaultTimeColumn}
                onChange={(event) => onChange({ ...form, defaultTimeColumn: event.target.value })}
              >
                <option value="">{t('— لا شيء —', '— Aucune —', '— None —')}</option>
                {timeColumns.map((column) => (
                  <option key={column.column_name} value={column.column_name}>
                    {`${column.column_name} · ${column.data_type}`}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <TextRow
              label={t('عمود الزمن الافتراضي', 'Colonne temporelle par défaut',
                'Default time column')}
              hint={t('القائمة تظهر بعد ربط المصدر وحفظه',
                'la liste apparaît une fois la source liée et enregistrée',
                'the list appears once the source is bound and saved')}
              value={form.defaultTimeColumn}
              onChange={(defaultTimeColumn) => onChange({ ...form, defaultTimeColumn })}
              code
            />
          )}
        </div>

        <AreaRow
          label={t('الوصف', 'Description', 'Description')}
          value={form.description}
          onChange={(description) => onChange({ ...form, description })}
        />

        <div>
          <p className="mb-1.5 text-[12px] text-[var(--text-primary)]">
            {t('مرشّح الصفوف — يُضاف إلى كل استعلام على هذه المجموعة',
              'Filtre de lignes — ajouté à chaque requête sur ce jeu',
              'Row filter — ANDed into every query on this dataset')}
          </p>
          <BiFilterEditor
            fields={filterFields}
            filters={form.rowFilter}
            drillFrom={form.rowFilter.length}
            onAdd={(filter) => setFilters([...form.rowFilter, filter])}
            onSet={(index, filter) => setFilters(
              form.rowFilter.map((existing, at) => (at === index ? filter : existing)),
            )}
            onRemove={(index) => setFilters(form.rowFilter.filter((_, at) => at !== index))}
          />
        </div>

        <RenameWarning show={existingKey !== null && form.key.trim() !== existingKey} />
        <IssueList issues={issues} />
        <FormActions
          busy={busy}
          blocked={issues.length > 0}
          onSave={onSave}
          onCancel={onCancel}
          onDelete={null}
        />
      </div>
    </Panel>
  );
}

/**
 * One dimension: something to group by, and optionally a level below it.
 *
 * `drill_to_key` is a text box and not a picker on purpose. A hierarchy is authored
 * top-down, so `region -> city` is written while `city` does not exist yet, and
 * `private.bi_validate_dimension` allows exactly that -- refusing only a chain that returns
 * to this row, which it finds by walking 32 levels the client cannot see. A picker over the
 * dimensions that happen to exist would forbid the normal way of working.
 *
 * The drill-through pair is offered as a pair because `bi_dimensions_drill_pair` stores it as
 * one: a kind names the screen a cell opens, the expression names the id it opens it on, and
 * one without the other is a level that pretends to be clickable.
 */
export function DimensionFormCard({
  form, columns, siblings, existing, busy, onChange, onSave, onCancel, onDelete,
}: {
  form: DimensionForm;
  columns: readonly BiSourceColumn[];
  siblings: readonly BiDimension[];
  existing: BiDimension | null;
  busy: boolean;
  onChange: (form: DimensionForm) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const issues = dimensionIssues(form);
  const otherKeys = siblings.filter((row) => row.key !== form.key.trim()).map((row) => row.key);
  const forwardHint = t('قد يسمّي بعدًا غير معرَّف بعد',
    'peut nommer une dimension non encore définie', 'may name a dimension not yet defined');

  return (
    <Panel
      title={existing === null
        ? t('بعد جديد', 'Nouvelle dimension', 'New dimension')
        : t('تعديل البعد', 'Modifier la dimension', 'Edit dimension')}
      subtitle={t('شيء يُجمَّع عليه، ويمكن أن يفتح السجلات تحته',
        'Quelque chose sur quoi grouper, et qui peut ouvrir les enregistrements dessous',
        'Something to group by, which may open the records beneath it')}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextRow
            label={t('المفتاح', 'Clé', 'Key')}
            value={form.key}
            onChange={(key) => onChange({ ...form, key })}
            placeholder="departure_city"
            code
          />
          <TextRow
            label={t('الاسم المعروض', 'Nom affiché', 'Display name')}
            value={form.displayName}
            onChange={(displayName) => onChange({ ...form, displayName })}
          />
          <TextRow
            label={t('الاسم العربي', 'Nom arabe', 'Arabic name')}
            hint={t('اختياري', 'facultatif', 'optional')}
            value={form.displayNameAr}
            onChange={(displayNameAr) => onChange({ ...form, displayNameAr })}
          />
          <Field label={t('النوع', 'Type', 'Data type')}>
            <Select
              className="input"
              value={form.dataType}
              onChange={(event) => onChange({
                ...form,
                dataType: BI_DIMENSION_DATA_TYPES.find((type) => type === event.target.value)
                  ?? form.dataType,
              })}
            >
              {BI_DIMENSION_DATA_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </Select>
          </Field>
          <TextRow
            label={t('الترتيب', 'Ordre', 'Sort order')}
            value={form.sortOrder}
            onChange={(sortOrder) => onChange({ ...form, sortOrder })}
            code
          />
          <TextRow
            label={t('ينقّب إلى', 'Descend vers', 'Drills into')}
            hint={otherKeys.length > 0 ? `${forwardHint} · ${otherKeys.join(', ')}` : forwardHint}
            value={form.drillToKey}
            onChange={(drillToKey) => onChange({ ...form, drillToKey })}
            code
          />
        </div>

        <AreaRow
          label={t('التعبير', 'Expression', 'Expression')}
          hint={t('SQL على مستوى الصف فوق أعمدة المصدر',
            'SQL au niveau ligne sur les colonnes de la source',
            'row-level SQL over the source’s columns')}
          value={form.expression}
          onChange={(expression) => onChange({ ...form, expression })}
          placeholder="departure_city"
          code
        />
        <ColumnHints columns={columns} />
        <AreaRow
          label={t('الوصف', 'Description', 'Description')}
          value={form.description}
          onChange={(description) => onChange({ ...form, description })}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('نوع التنقيب العميق', 'Type de forage', 'Drill-through kind')}>
            <Select
              className="input"
              value={form.drillThroughKind}
              onChange={(event) => onChange({
                ...form,
                drillThroughKind: BI_DRILL_THROUGH_KINDS
                  .find((kind: BiDrillThroughKind) => kind === event.target.value) ?? '',
              })}
            >
              <option value="">{t('— لا شيء —', '— Aucun —', '— None —')}</option>
              {BI_DRILL_THROUGH_KINDS.map((kind) => (
                <option key={kind} value={kind}>{labels.drillThrough[kind]}</option>
              ))}
            </Select>
          </Field>
          <TextRow
            label={t('تعبير التنقيب العميق', 'Expression de forage', 'Drill-through expression')}
            hint={t('المعرّف الذي تفتح عليه الخلية', 'l’identifiant sur lequel la cellule ouvre',
              'the id a cell opens on')}
            value={form.drillThroughExpression}
            onChange={(drillThroughExpression) => onChange({ ...form, drillThroughExpression })}
            placeholder="booking_id"
            code
          />
        </div>

        <label className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={form.isDefault}
            disabled={busy}
            onChange={(event) => onChange({ ...form, isDefault: event.target.checked })}
          />
          {t('بعد افتراضي — يُقترح أولًا في الباني',
            'Dimension par défaut — proposée en premier dans le constructeur',
            'Default dimension — offered first in the builder')}
        </label>

        <RenameWarning show={existing !== null && renamesKey(form, existing)} />
        <IssueList issues={issues} />
        <FormActions
          busy={busy}
          blocked={issues.length > 0}
          onSave={onSave}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </div>
    </Panel>
  );
}
