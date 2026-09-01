/**
 * The metric form: what a number is, and how it folds.
 *
 * A metric is two things the database keeps apart, and the form keeps them apart too. The
 * `formula` is row-level -- never an aggregate -- and `aggregate` says how the rows collapse.
 * RATIO is the exception that changes the shape of the form rather than one of its fields:
 * `private.bi_validate_metric` blanks a ratio's formula and composes two other metrics
 * instead, so a ratio is asked for two operands and never for a formula.
 *
 * Three facts about a metric are measured server-side and so are stated here rather than
 * offered as controls. `is_additive` is `aggregate in ('SUM','COUNT')`, or `false` for a
 * ratio, whatever a client sends. Both ratio operands must already be metrics of this
 * dataset, so they are pickers over the metrics that exist -- unlike a dimension's
 * `drill_to_key`, where a forward reference is the normal way to author a hierarchy.
 * And a published metric freezes exactly five columns, so the note about them names those
 * five and not the ones that stay editable.
 */
import { Lock } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import {
  BI_AGGREGATES, BI_METRIC_FORMATS, type BiAggregate, type BiFilter, type BiMetric,
  type BiMetricFormat, type BiSourceColumn,
} from '@/types/bi';
import { Field, InlineNote, Panel } from './atoms';
import { BiFilterEditor } from './BiFilterEditor';
import { useBiI18n, useBiLabels } from './biFormat';
import {
  changesPublishedMeaning, metricIssues, renamesKey, type MetricForm,
} from './biDefinitionState';
import {
  AreaRow, ColumnHints, FormActions, IssueList, RenameWarning, TextRow,
  type DefinitionFilterField,
} from './BiFormFields';

/**
 * What a published metric will and will not accept.
 *
 * `trg_bi_freeze_published_metric` refuses a PUBLISHED-to-PUBLISHED change to `formula`,
 * `aggregate`, `filter_json`, `numerator_metric_key` or `denominator_metric_key`. Everything
 * else on this form stays editable while published, which is why the quiet form of this note
 * names both lists: a reader who only saw "published, frozen" would not try to fix a typo in
 * the label, and fixing the label is allowed.
 */
function PublishedFreeze({ existing, form }: { existing: BiMetric | null; form: MetricForm }) {
  const { t } = useBiI18n();
  if (existing === null || existing.status !== 'PUBLISHED') return null;

  return changesPublishedMeaning(form, existing) ? (
    <InlineNote tone="bad">
      <Lock className="me-1 inline h-3 w-3" aria-hidden="true" />
      {t('هذا التعديل يغيّر ما يقيسه المقياس؛ أعِده إلى مسوّدة قبل الحفظ',
        'Cette modification change ce que la mesure mesure ; repassez-la en brouillon avant d’enregistrer',
        'This edit changes what the metric measures; return it to draft before saving')}
    </InlineNote>
  ) : (
    <InlineNote tone="warn">
      <Lock className="me-1 inline h-3 w-3" aria-hidden="true" />
      {t('منشور: الصيغة والتجميع والمرشّح والبسط والمقام مجمّدة. التسميات والتنسيق والوحدة والخانات والترتيب تبقى قابلة للتعديل',
        'Publié : formule, agrégat, filtre, numérateur et dénominateur sont figés. Libellés, format, unité, décimales et ordre restent modifiables',
        'Published: formula, aggregate, filter, numerator and denominator are frozen. Labels, format, unit, decimals and order stay editable')}
    </InlineNote>
  );
}

/** An operand picker. A Select and not a text box, because `bi_validate_metric` requires the
 *  operand to already be a metric of this dataset -- *"define it first"* -- so there is no
 *  legitimate forward reference to preserve. */
function OperandPicker({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly BiMetric[];
  onChange: (key: string) => void;
}) {
  const { t } = useBiI18n();

  return (
    <Field label={label}>
      <Select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('— اختر —', '— Choisir —', '— Choose —')}</option>
        {options.map((metric) => (
          <option key={metric.key} value={metric.key}>
            {`${metric.display_name} · ${metric.key}`}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function MetricFormCard({
  form, columns, siblings, existing, filterFields, busy, onChange, onSave, onCancel, onDelete,
}: {
  form: MetricForm;
  columns: readonly BiSourceColumn[];
  siblings: readonly BiMetric[];
  existing: BiMetric | null;
  filterFields: readonly DefinitionFilterField[];
  busy: boolean;
  onChange: (form: MetricForm) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const ratio = form.aggregate === 'RATIO';
  const issues = metricIssues(form, siblings);
  const frozen = existing !== null && existing.status === 'PUBLISHED'
    && changesPublishedMeaning(form, existing);
  const operands = siblings.filter(
    (metric) => metric.aggregate !== 'RATIO' && metric.key !== form.key.trim(),
  );
  const setFilters = (filter: readonly BiFilter[]) => onChange({ ...form, filter });

  return (
    <Panel
      title={existing === null
        ? t('مقياس جديد', 'Nouvelle mesure', 'New metric')
        : t('تعديل المقياس', 'Modifier la mesure', 'Edit metric')}
      subtitle={t('تعبير على مستوى الصف، وطريقة انطوائه',
        'Une expression au niveau ligne, et la façon dont elle se replie',
        'A row-level expression, and how it folds')}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextRow
            label={t('المفتاح', 'Clé', 'Key')}
            value={form.key}
            onChange={(key) => onChange({ ...form, key })}
            placeholder="net_revenue"
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
          <Field
            label={t('التجميع', 'Agrégat', 'Aggregate')}
            hint={t('الجمعية تُقاس من هذا: SUM و COUNT فقط',
              'L’additivité en découle : SUM et COUNT seulement',
              'additivity is measured from this: SUM and COUNT only')}
          >
            <Select
              className="input"
              value={form.aggregate}
              onChange={(event) => onChange({
                ...form,
                aggregate: BI_AGGREGATES
                  .find((option: BiAggregate) => option === event.target.value) ?? form.aggregate,
              })}
            >
              {BI_AGGREGATES.map((option) => (
                <option key={option} value={option}>{labels.aggregate[option]}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('التنسيق', 'Format', 'Format')}>
            <Select
              className="input"
              value={form.format}
              onChange={(event) => onChange({
                ...form,
                format: BI_METRIC_FORMATS
                  .find((option: BiMetricFormat) => option === event.target.value) ?? form.format,
              })}
            >
              {BI_METRIC_FORMATS.map((option) => (
                <option key={option} value={option}>{labels.metricFormat[option]}</option>
              ))}
            </Select>
          </Field>
          <TextRow
            label={t('الوحدة', 'Unité', 'Unit')}
            hint={t('اختياري، مثل ليلة أو حاج', 'facultatif, p. ex. nuit ou pèlerin',
              'optional, e.g. night or pilgrim')}
            value={form.unit}
            onChange={(unit) => onChange({ ...form, unit })}
          />
          <TextRow
            label={t('الخانات العشرية', 'Décimales', 'Decimals')}
            hint="0 – 6"
            value={form.decimals}
            onChange={(decimals) => onChange({ ...form, decimals })}
            code
          />
          <TextRow
            label={t('الترتيب', 'Ordre', 'Sort order')}
            value={form.sortOrder}
            onChange={(sortOrder) => onChange({ ...form, sortOrder })}
            code
          />
        </div>
        {ratio ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <OperandPicker
              label={t('البسط', 'Numérateur', 'Numerator')}
              value={form.numeratorKey}
              options={operands}
              onChange={(numeratorKey) => onChange({ ...form, numeratorKey })}
            />
            <OperandPicker
              label={t('المقام', 'Dénominateur', 'Denominator')}
              value={form.denominatorKey}
              options={operands}
              onChange={(denominatorKey) => onChange({ ...form, denominatorKey })}
            />
          </div>
        ) : (
          <>
            <AreaRow
              label={t('الصيغة', 'Formule', 'Formula')}
              hint={t('تعبير على مستوى الصف — التجميع يُطبَّق فوقه',
                'Expression au niveau ligne — l’agrégat s’applique par-dessus',
                'a row-level expression — the aggregate is applied over it')}
              value={form.formula}
              onChange={(formula) => onChange({ ...form, formula })}
              placeholder="total_amount - discount_amount"
              code
            />
            <ColumnHints columns={columns} />
          </>
        )}

        <AreaRow
          label={t('الوصف', 'Description', 'Description')}
          value={form.description}
          onChange={(description) => onChange({ ...form, description })}
        />

        <div>
          <p className="mb-1.5 text-[12px] text-[var(--text-primary)]">
            {t('مرشّح المقياس — يُطوى داخل التجميع، فيقيس هذا المقياس مجموعة صفوف أضيق',
              'Filtre de la mesure — replié dans l’agrégat, pour que cette mesure porte sur moins de lignes',
              'Metric filter — folded into the aggregate, so this metric measures fewer rows')}
          </p>
          <BiFilterEditor
            fields={filterFields}
            filters={form.filter}
            drillFrom={form.filter.length}
            onAdd={(filter) => setFilters([...form.filter, filter])}
            onSet={(index, filter) => setFilters(
              form.filter.map((current, at) => (at === index ? filter : current)),
            )}
            onRemove={(index) => setFilters(form.filter.filter((_, at) => at !== index))}
          />
        </div>
        <PublishedFreeze existing={existing} form={form} />
        <RenameWarning show={existing !== null && renamesKey(form, existing)} />
        <IssueList issues={issues} />
        <FormActions
          busy={busy}
          blocked={issues.length > 0 || frozen}
          onSave={onSave}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </div>
    </Panel>
  );
}
