/**
 * The eleven dialogs, and the one rule that governs all of them.
 *
 * **A primary button is dark under exactly the condition its commit refuses.** The
 * commits in `./shell.ts` deliberately validate nothing about form contents — the
 * database does, through CHECK constraints and BEFORE triggers, and a second opinion
 * in TypeScript would eventually disagree with the first. What the commits *do* refuse
 * is structural: `commitAnalysis` returns early when its member carries no query, and
 * `saveVia` leaves the dialog open when the server says no. So this file's job is to
 * make the impossible save visibly impossible rather than to re-implement the schema:
 * a key with nothing in it, a ratio missing an operand, a predicate with no value.
 *
 * Anything past that is the server's answer to give. A duplicate key, an expression
 * that does not compile, a permission the caller does not hold — all three come back
 * as a refusal with a sentence, the dialog stays open with what was typed still in it,
 * and the reader fixes the thing the server actually named.
 *
 * ## What is drawn and what is not
 *
 * Seven of the eleven are editors over a `*Form` from `./forms`, and every one of them
 * edits through a patch setter on the shell rather than local state. A dialog that kept
 * its own copy would be a second place the truth lived, and the commit reads the
 * shell's — so a field the dialog forgot to push would be a field that silently did not
 * save.
 *
 * Two are governance verbs with no form at all. The last two ask nothing and only show
 * an answer — a drill-through result and a compiled statement — and live in
 * `./answers.tsx` for that reason: no form, no patch setter, no commit, and so nothing
 * in common with this file's subject.
 *
 * `react-refresh/only-export-components` is error-level, so this file exports one
 * component and nothing else. The label tables it needs live in `./labels`, the
 * predicate editor in `./fields`, and the one table it duplicates from nowhere — the
 * six data types a dimension may declare — is written below with a note saying why it
 * cannot be imported.
 */
import type { CSSProperties, ReactElement } from 'react';

import {
  Checkbox,
  Dialog,
  Field,
  InfoBar,
  Input,
  PropertyRow,
  Select,
  TextArea,
  useLocale,
  type SelectOption,
} from '@/platform/sdk';

import { BiDrillDialog, BiSqlDialog } from './answers';
import { filterComplete } from './builder';
import { FilterField } from './fields';
import { int } from './format';
import { isRatio } from './forms';
import {
  AGGREGATE_LABEL,
  CHART_LABEL,
  DRILL_LABEL,
  GOVERNED_KIND_LABEL,
  METRIC_FORMAT_LABEL,
  STATUS_LABEL,
} from './labels';
import type { BiCrudKind, BiDialog, BiShell } from './shell';
import {
  BI_AGGREGATES,
  BI_DRILL_KINDS,
  BI_METRIC_FORMATS,
  BI_STATUSES,
  type BiAggregate,
  type BiDimensionDataType,
  type BiDrillKind,
  type BiFilter,
  type BiMetricFormat,
  type BiSourceColumn,
  type BiStatus,
} from './types';

/* ------------------------------------------------------------------ *
 * Furniture
 * ------------------------------------------------------------------ */

const GRID: CSSProperties = { display: 'grid', gap: 12 };
const PAIR: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const CAPTION: CSSProperties = { color: 'var(--fx-text-tertiary)', fontSize: 'var(--fx-caption)' };
const RULE: CSSProperties = { borderTop: '1px solid var(--fx-divider)', paddingTop: 12 };

/** Whitespace alone is blank, which is the same reading `said` in `./forms` gives a
 *  name before it decides whether one was supplied. */
const blank = (text: string): boolean => text.trim() === '';

/** Every predicate has whatever its operator's arity asks for. The same function the
 *  filter row marks itself red with and the same one `readiness` reports as
 *  `FILTER_INCOMPLETE`, so the button, the row and the run all agree. */
const complete = (filters: readonly BiFilter[]): boolean => filters.every(filterComplete);

/** A grid box as `gridOf` in `./forms` will read it: blank and unreadable both fall
 *  back to the stated number rather than to `NaN`. */
const num = (text: string, fallback: number): number => {
  const parsed = Number.parseInt(text.trim(), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

type Say = ReturnType<typeof useLocale>['t'];

/** A union and its translation table as select options, in the order the constant
 *  array declares — which is the order the migration declares, and not alphabetical:
 *  `DRAFT`, `PUBLISHED`, `DEPRECATED` is a lifecycle and sorting it by name would
 *  scramble it. */
function options<K extends string>(
  keys: readonly K[],
  labels: Readonly<Record<K, { readonly ar: string; readonly fr: string; readonly en: string }>>,
  t: Say,
): readonly SelectOption[] {
  return keys.map((key) => ({ value: key, label: t(labels[key]) }));
}

/**
 * The six types a dimension may declare.
 *
 * `BiDimensionDataType` is `Exclude<BiDataType, 'json'>` — a structural type with no
 * constant array anywhere to import, because nothing server-side enumerates it. So the
 * list is written here as an exhaustive `Record`, which is the one shape the compiler
 * checks in both directions: a type added to the union fails to compile until it is
 * added here, and one removed fails on the key that no longer exists.
 *
 * The words are Postgres's own and are deliberately untranslated, for the reason
 * `./labels` states about {@link BiDataType}: a reader comparing a dimension to the
 * source catalog needs the name the catalog uses.
 */
const DIMENSION_DATA_TYPE: Readonly<Record<BiDimensionDataType, string>> = {
  text: 'text',
  number: 'number',
  date: 'date',
  timestamp: 'timestamp',
  boolean: 'boolean',
  uuid: 'uuid',
};

const DATA_TYPE_OPTIONS: readonly SelectOption[] = Object.entries(DIMENSION_DATA_TYPE)
  .map(([value, label]) => ({ value, label }));

/** The temporal types, for the dataset's default time column. A grain can only be cut
 *  over a date, so offering a text column here would offer a query the compiler
 *  refuses. */
const TEMPORAL = new Set(['date', 'timestamp']);

/**
 * The seven definition tables, named as a sentence names them.
 *
 * `BiCrudKind`'s members are lowercase table words rather than the SCREAMING enum the
 * governed kinds use, and `GOVERNED_KIND_LABEL` covers only four of the seven — so a
 * delete confirmation, which is the one place all seven are spoken aloud, needs its own
 * table. Singular, because a delete dialog is always about one row.
 */
const CRUD_NOUN: Readonly<Record<BiCrudKind, { ar: string; fr: string; en: string }>> = {
  dataset: { ar: 'مجموعة البيانات', fr: 'Le jeu de données', en: 'Dataset' },
  dimension: { ar: 'البُعد', fr: 'La dimension', en: 'Dimension' },
  metric: { ar: 'المقياس', fr: 'La mesure', en: 'Metric' },
  analysis: { ar: 'التحليل', fr: "L'analyse", en: 'Analysis' },
  report: { ar: 'التقرير', fr: 'Le rapport', en: 'Report' },
  dashboard: { ar: 'لوحة المعلومات', fr: 'Le tableau de bord', en: 'Dashboard' },
  tile: { ar: 'البطاقة', fr: 'La tuile', en: 'Tile' },
};

/**
 * What a delete takes with it.
 *
 * Three of the seven own rows in other tables, and the cascade is a fact the reader
 * should meet before the button rather than after. The other four are leaves — a tile
 * is a placement, an analysis is a saved query, and removing either leaves the thing it
 * pointed at exactly where it was.
 */
const CASCADE: Readonly<Partial<Record<BiCrudKind, { ar: string; fr: string; en: string }>>> = {
  dataset: {
    ar: 'ستُحذف أبعاده ومقاييسه معه، وستتوقف كل تحليلاته عن العمل.',
    fr: 'Ses dimensions et ses mesures partent avec lui, et ses analyses cessent de fonctionner.',
    en: 'Its dimensions and metrics go with it, and every analysis built on it stops working.',
  },
  report: {
    ar: 'ستفقد تحليلاته انتماءها إلى تقرير، ولن تُحذف.',
    fr: 'Ses analyses perdent leur rapport sans être supprimées.',
    en: 'Its analyses lose their report but are not themselves deleted.',
  },
  dashboard: {
    ar: 'ستُحذف بطاقاته، أما التحليلات التي تعرضها فتبقى.',
    fr: 'Ses tuiles partent avec lui ; les analyses qu’elles montrent restent.',
    en: 'Its tiles go with it; the analyses they showed remain.',
  },
};

/* ------------------------------------------------------------------ *
 * Reading the open detail
 * ------------------------------------------------------------------ */

/**
 * The columns of the source a dataset reads, and nothing when they are not this
 * dataset's.
 *
 * `model.dataset` is keyed on the selected id, which follows the selection by a render,
 * so the identity check is the point rather than ceremony — the same guard `./detail.tsx`
 * puts at the top of every pane. An empty list is also the honest answer for a dataset
 * being created: nothing has been read yet, the predicate editor disables its own Add
 * button when it has no fields, and a filter over columns nobody has fetched would be a
 * guess.
 */
function columnsOf(shell: BiShell, datasetId: string | null): readonly BiSourceColumn[] {
  const detail = shell.model.dataset.value;
  if (detail === null || datasetId === null || detail.dataset.id !== datasetId) return [];
  return detail.columns;
}

/** The metrics a ratio may compose: this dataset's, minus the one being edited. A
 *  ratio of a thing to itself is one, and offering it is offering a mistake. */
function siblingMetrics(shell: BiShell, datasetId: string, selfId: string | null): readonly SelectOption[] {
  const detail = shell.model.dataset.value;
  if (detail === null || detail.dataset.id !== datasetId) return [];
  return detail.metrics
    .filter((metric) => metric.id !== selfId)
    .map((metric) => ({ value: metric.key, label: metric.name }));
}

/* ------------------------------------------------------------------ *
 * The seven editors
 * ------------------------------------------------------------------ */

interface Arm<K extends BiDialog['kind']> {
  readonly shell: BiShell;
  readonly dialog: Extract<BiDialog, { kind: K }>;
}

function DatasetDialog({ shell, dialog }: Arm<'dataset'>): ReactElement {
  const { tr } = useLocale();
  const form = dialog.form;
  const columns = columnsOf(shell, dialog.id);
  const temporal = columns.filter((column) => TEMPORAL.has(column.dataType));

  const sources: readonly SelectOption[] = shell.model.sources.map((source) => ({
    value: source.id,
    label: `${source.name} · ${source.relation}`,
  }));

  return (
    <Dialog
      open
      width={560}
      title={dialog.id === null
        ? tr('مجموعة بيانات جديدة', 'Nouveau jeu de données', 'New dataset')
        : tr('تعديل مجموعة البيانات', 'Modifier le jeu de données', 'Edit dataset')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: () => void shell.commitDataset(),
        busy: shell.busy === 'save',
        disabled: blank(form.key) || blank(form.name) || !complete(dialog.filters),
      }}
    >
      <div style={GRID}>
        <div style={PAIR}>
          <Field label={tr('المفتاح', 'Clé', 'Key')} required>
            <Input
              value={form.key}
              mono
              placeholder="bookings_by_branch"
              onChange={(key) => shell.setDataset({ key })}
            />
          </Field>
          <Field label={tr('الاسم', 'Nom', 'Name')} required>
            <Input value={form.name} onChange={(name) => shell.setDataset({ name })} />
          </Field>
        </div>
        <Field label={tr('الاسم بالعربية', 'Nom en arabe', 'Arabic name')}>
          <Input value={form.nameAr} onChange={(nameAr) => shell.setDataset({ nameAr })} />
        </Field>
        <Field label={tr('الوصف', 'Description', 'Description')}>
          <TextArea
            rows={2}
            value={form.description}
            onChange={(description) => shell.setDataset({ description })}
          />
        </Field>
        <Field
          label={tr('المصدر', 'Source', 'Source')}
          hint={tr(
            'يمكن ترك المصدر فارغًا في المسودة؛ النشر وحده يتطلبه.',
            'Peut rester vide sur un brouillon ; seule la publication en exige un.',
            'May be left empty on a draft. Only publishing requires one.',
          )}
        >
          <Select
            value={form.sourceId}
            options={sources}
            placeholder={tr('— لم يُختَر —', '— Non choisie —', '— Not chosen —')}
            onChange={(sourceId) => shell.setDataset({ sourceId })}
          />
        </Field>
        <Field
          label={tr('عمود الزمن', 'Colonne temporelle', 'Time column')}
          hint={tr(
            'العمود الذي تُقطع عليه الحبيبات الزمنية.',
            'La colonne sur laquelle les granularités sont découpées.',
            'The column a time grain is cut over.',
          )}
        >
          {temporal.length > 0 ? (
            <Select
              value={form.timeColumn}
              options={temporal.map((column) => ({ value: column.columnName, label: column.columnName }))}
              placeholder={tr('— لا شيء —', '— Aucune —', '— None —')}
              onChange={(timeColumn) => shell.setDataset({ timeColumn })}
            />
          ) : (
            // Nothing has been read about this source yet, so the box is the only
            // honest control: a select with no options would read as "there are none".
            <Input
              value={form.timeColumn}
              mono
              placeholder="created_at"
              onChange={(timeColumn) => shell.setDataset({ timeColumn })}
            />
          )}
        </Field>
        <div style={RULE}>
          <FilterField
            filters={dialog.filters}
            columns={columns}
            onChange={shell.setFilters}
            label={tr('شروط الصفوف', 'Filtres de lignes', 'Row filters')}
            hint={tr(
              'تُطبَّق على كل استعلام على هذه المجموعة.',
              'Appliqués à toute requête sur ce jeu de données.',
              'Applied to every query on this dataset.',
            )}
          />
        </div>
      </div>
    </Dialog>
  );
}

function DimensionDialog({ shell, dialog }: Arm<'dimension'>): ReactElement {
  const { t, tr } = useLocale();
  const form = dialog.form;
  /** Half a drill pair is dropped by `dimensionValues`, because the CHECK reads the
   *  kind and the expression together. Said out loud rather than enforced, since a
   *  dimension with neither is the ordinary case and saving is not blocked by it. */
  const halfDrill = (form.drillKind === '') !== blank(form.drillExpression);

  return (
    <Dialog
      open
      width={560}
      title={dialog.id === null
        ? tr('بُعد جديد', 'Nouvelle dimension', 'New dimension')
        : tr('تعديل البُعد', 'Modifier la dimension', 'Edit dimension')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: () => void shell.commitDimension(),
        busy: shell.busy === 'save',
        disabled: blank(form.key) || blank(form.displayName) || blank(form.expression),
      }}
    >
      <div style={GRID}>
        <div style={PAIR}>
          <Field label={tr('المفتاح', 'Clé', 'Key')} required>
            <Input value={form.key} mono onChange={(key) => shell.setDimension({ key })} />
          </Field>
          <Field label={tr('الاسم المعروض', 'Nom affiché', 'Display name')} required>
            <Input
              value={form.displayName}
              onChange={(displayName) => shell.setDimension({ displayName })}
            />
          </Field>
        </div>
        <Field label={tr('الاسم بالعربية', 'Nom en arabe', 'Arabic name')}>
          <Input
            value={form.displayNameAr}
            onChange={(displayNameAr) => shell.setDimension({ displayNameAr })}
          />
        </Field>
        <Field
          label={tr('التعبير', 'Expression', 'Expression')}
          required
          hint={tr(
            'SQL على المصدر. يتحقق منه مشغّل قبل الحفظ؛ هذا التطبيق لا يحلّله.',
            'SQL sur la source. Un trigger le valide à l’enregistrement ; cette application ne l’analyse pas.',
            'SQL over the source. A trigger validates it on save; this app does not parse it.',
          )}
        >
          <TextArea
            rows={2}
            mono
            value={form.expression}
            placeholder="b.branch_name"
            onChange={(expression) => shell.setDimension({ expression })}
          />
        </Field>
        <div style={PAIR}>
          <Field label={tr('النوع', 'Type', 'Data type')}>
            <Select
              value={form.dataType}
              options={DATA_TYPE_OPTIONS}
              onChange={(next) => shell.setDimension({ dataType: next as BiDimensionDataType })}
            />
          </Field>
          <Field label={tr('الترتيب', 'Rang', 'Sort order')}>
            <Input
              value={form.sortOrder}
              inputMode="numeric"
              onChange={(sortOrder) => shell.setDimension({ sortOrder })}
            />
          </Field>
        </div>
        <Checkbox
          checked={form.isDefault}
          onChange={(isDefault) => shell.setDimension({ isDefault })}
          label={tr(
            'بُعد افتراضي لهذه المجموعة',
            'Dimension par défaut de ce jeu de données',
            'Default dimension for this dataset',
          )}
        />
        <div style={RULE}>
          <div style={{ ...CAPTION, marginBottom: 8 }}>
            {tr('التنقيب', 'Exploration', 'Drill-through')}
          </div>
          <div style={GRID}>
            {halfDrill ? (
              <InfoBar tone="warning">
                {tr(
                  'يحتاج التنقيب إلى النوع والتعبير معًا؛ أحدهما دون الآخر يُهمَل عند الحفظ.',
                  'Une exploration a besoin du type et de l’expression ; l’un sans l’autre est ignoré à l’enregistrement.',
                  'A drill needs both a kind and an expression. One without the other is dropped on save.',
                )}
              </InfoBar>
            ) : null}
            <div style={PAIR}>
              <Field label={tr('النوع', 'Type', 'Target kind')}>
                <Select
                  value={form.drillKind}
                  options={options(BI_DRILL_KINDS, DRILL_LABEL, t)}
                  placeholder={tr('— لا تنقيب —', '— Aucune —', '— No drill —')}
                  onChange={(next) => shell.setDimension({ drillKind: next as BiDrillKind | '' })}
                />
              </Field>
              <Field
                label={tr('بُعد أدنى', 'Dimension enfant', 'Drills down to')}
                hint={tr('مفتاح بُعد في المجموعة نفسها.', 'Clé d’une dimension du même jeu.', 'A dimension key on the same dataset.')}
              >
                <Input
                  value={form.drillToKey}
                  mono
                  onChange={(drillToKey) => shell.setDimension({ drillToKey })}
                />
              </Field>
            </div>
            <Field
              label={tr('تعبير المعرّفات', 'Expression des identifiants', 'Id expression')}
              hint={tr(
                'SQL يُرجع معرّفات الصفوف التي تقف خلف العلامة.',
                'SQL renvoyant les identifiants des lignes derrière la marque.',
                'SQL returning the ids of the rows behind a mark.',
              )}
            >
              <Input
                value={form.drillExpression}
                mono
                placeholder="b.customer_id"
                onChange={(drillExpression) => shell.setDimension({ drillExpression })}
              />
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function MetricDialog({ shell, dialog }: Arm<'metric'>): ReactElement {
  const { t, tr } = useLocale();
  const form = dialog.form;
  const ratio = isRatio(form.aggregate);
  const siblings = siblingMetrics(shell, dialog.datasetId, dialog.id);
  const operandsMissing = ratio && (blank(form.numeratorKey) || blank(form.denominatorKey));

  /** A ratio composes two sibling metrics; everything else folds one expression. The
   *  half that is not shown is also the half `toMetricDraft` refuses to send, so the
   *  form and the draft agree about which one is live. */
  const operand = (
    label: string,
    value: string,
    onChange: (next: string) => void,
  ): ReactElement => (
    <Field label={label} required>
      {siblings.length > 0 ? (
        <Select
          value={value}
          options={siblings}
          placeholder={tr('— اختر —', '— Choisir —', '— Choose —')}
          onChange={onChange}
        />
      ) : (
        <Input value={value} mono onChange={onChange} />
      )}
    </Field>
  );

  return (
    <Dialog
      open
      width={560}
      title={dialog.id === null
        ? tr('مقياس جديد', 'Nouvelle mesure', 'New metric')
        : tr('تعديل المقياس', 'Modifier la mesure', 'Edit metric')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: () => void shell.commitMetric(),
        busy: shell.busy === 'save',
        disabled:
          blank(form.key) ||
          blank(form.displayName) ||
          operandsMissing ||
          (!ratio && blank(form.formula)) ||
          !complete(dialog.filters),
      }}
    >
      <div style={GRID}>
        <div style={PAIR}>
          <Field label={tr('المفتاح', 'Clé', 'Key')} required>
            <Input value={form.key} mono onChange={(key) => shell.setMetric({ key })} />
          </Field>
          <Field label={tr('الاسم المعروض', 'Nom affiché', 'Display name')} required>
            <Input
              value={form.displayName}
              onChange={(displayName) => shell.setMetric({ displayName })}
            />
          </Field>
        </div>
        <Field label={tr('الاسم بالعربية', 'Nom en arabe', 'Arabic name')}>
          <Input
            value={form.displayNameAr}
            onChange={(displayNameAr) => shell.setMetric({ displayNameAr })}
          />
        </Field>
        <Field label={tr('التجميع', 'Agrégation', 'Aggregate')}>
          <Select
            value={form.aggregate}
            options={options(BI_AGGREGATES, AGGREGATE_LABEL, t)}
            onChange={(next) => shell.setMetric({ aggregate: next as BiAggregate })}
          />
        </Field>
        {ratio ? (
          <div style={PAIR}>
            {operand(
              tr('البسط', 'Numérateur', 'Numerator'),
              form.numeratorKey,
              (numeratorKey) => shell.setMetric({ numeratorKey }),
            )}
            {operand(
              tr('المقام', 'Dénominateur', 'Denominator'),
              form.denominatorKey,
              (denominatorKey) => shell.setMetric({ denominatorKey }),
            )}
          </div>
        ) : (
          <Field
            label={tr('التعبير', 'Expression', 'Expression')}
            required
            hint={tr(
              'ما يُجمَّع. التجميع نفسه يُضاف حوله.',
              'Ce qui est agrégé. L’agrégation elle-même est ajoutée autour.',
              'What is folded. The aggregate itself is wrapped around it.',
            )}
          >
            <TextArea
              rows={2}
              mono
              value={form.formula}
              placeholder="b.total_amount"
              onChange={(formula) => shell.setMetric({ formula })}
            />
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label={tr('الصيغة', 'Format', 'Format')}>
            <Select
              value={form.format}
              options={options(BI_METRIC_FORMATS, METRIC_FORMAT_LABEL, t)}
              onChange={(next) => shell.setMetric({ format: next as BiMetricFormat })}
            />
          </Field>
          <Field label={tr('الوحدة', 'Unité', 'Unit')}>
            <Input value={form.unit} onChange={(unit) => shell.setMetric({ unit })} />
          </Field>
          <Field label={tr('المنازل', 'Décimales', 'Decimals')}>
            <Input
              value={form.decimals}
              inputMode="numeric"
              onChange={(decimals) => shell.setMetric({ decimals })}
            />
          </Field>
        </div>
        <Field label={tr('الترتيب', 'Rang', 'Sort order')}>
          <Input
            value={form.sortOrder}
            inputMode="numeric"
            onChange={(sortOrder) => shell.setMetric({ sortOrder })}
          />
        </Field>
        <div style={RULE}>
          <FilterField
            filters={dialog.filters}
            columns={columnsOf(shell, dialog.datasetId)}
            onChange={shell.setFilters}
            hint={tr(
              'تُطبَّق على هذا المقياس وحده، لا على الاستعلام كله.',
              'Appliqués à cette mesure seule, pas à toute la requête.',
              'Applied to this measure only, not to the whole query.',
            )}
          />
        </div>
      </div>
    </Dialog>
  );
}

function AnalysisDialog({ shell, dialog }: Arm<'analysis'>): ReactElement {
  const { t, tr, lang } = useLocale();
  const form = dialog.form;
  const request = dialog.request;

  return (
    <Dialog
      open
      title={dialog.id === null
        ? tr('حفظ التحليل', "Enregistrer l'analyse", 'Save analysis')
        : tr('تعديل التحليل', "Modifier l'analyse", 'Edit analysis')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: () => void shell.commitAnalysis(),
        busy: shell.busy === 'save',
        disabled: request === null || blank(form.key) || blank(form.title),
      }}
    >
      <div style={GRID}>
        {request === null ? (
          <InfoBar tone="danger">
            {tr(
              'لا يوجد استعلام يُحفَظ: اختر مجموعة بيانات في المُنشئ أولًا.',
              'Aucune requête à enregistrer : choisissez d’abord un jeu de données dans le constructeur.',
              'There is no query to save. Choose a dataset in the builder first.',
            )}
          </InfoBar>
        ) : (
          // What this save will write, stated before it is written. The query was
          // captured when the dialog opened — from the shelves for a save, from the
          // record for a rename — so this is the query that will be stored and not
          // whatever the builder happens to hold at the moment the button is pressed.
          <div style={GRID}>
            <PropertyRow label={tr('الأبعاد', 'Dimensions', 'Dimensions')}>
              {int(request.dimensions.length, lang)}
            </PropertyRow>
            <PropertyRow label={tr('المقاييس', 'Mesures', 'Measures')}>
              {int(request.metrics.length, lang)}
            </PropertyRow>
            <PropertyRow label={tr('الشروط', 'Filtres', 'Filters')}>
              {/* Optional on the wire, because a query with no predicates omits the key
                  rather than sending an empty array. Absent and empty count the same. */}
              {int(request.filters?.length ?? 0, lang)}
            </PropertyRow>
            <PropertyRow label={tr('الرسم', 'Graphique', 'Chart')}>
              {t(CHART_LABEL[dialog.chartType])}
            </PropertyRow>
          </div>
        )}
        <div style={PAIR}>
          <Field label={tr('المفتاح', 'Clé', 'Key')} required>
            <Input value={form.key} mono onChange={(key) => shell.setAnalysisForm({ key })} />
          </Field>
          <Field label={tr('العنوان', 'Titre', 'Title')} required>
            <Input value={form.title} onChange={(title) => shell.setAnalysisForm({ title })} />
          </Field>
        </div>
        <Field label={tr('العنوان بالعربية', 'Titre en arabe', 'Arabic title')}>
          <Input value={form.titleAr} onChange={(titleAr) => shell.setAnalysisForm({ titleAr })} />
        </Field>
        <Field label={tr('الترتيب', 'Rang', 'Sort order')}>
          <Input
            value={form.sortOrder}
            inputMode="numeric"
            onChange={(sortOrder) => shell.setAnalysisForm({ sortOrder })}
          />
        </Field>
        {dialog.reportId === null ? (
          <div style={CAPTION}>
            {tr(
              'لا ينتمي إلى تقرير.',
              'N’appartient à aucun rapport.',
              'Belongs to no report.',
            )}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function ReportDialog({ shell, dialog }: Arm<'report'>): ReactElement {
  const { tr } = useLocale();
  const form = dialog.form;

  return (
    <Dialog
      open
      title={dialog.id === null
        ? tr('تقرير جديد', 'Nouveau rapport', 'New report')
        : tr('تعديل التقرير', 'Modifier le rapport', 'Edit report')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: () => void shell.commitReport(),
        busy: shell.busy === 'save',
        disabled: blank(form.key) || blank(form.title),
      }}
    >
      <div style={GRID}>
        <div style={PAIR}>
          <Field label={tr('المفتاح', 'Clé', 'Key')} required>
            <Input value={form.key} mono onChange={(key) => shell.setReport({ key })} />
          </Field>
          <Field label={tr('العنوان', 'Titre', 'Title')} required>
            <Input value={form.title} onChange={(title) => shell.setReport({ title })} />
          </Field>
        </div>
        <Field label={tr('العنوان بالعربية', 'Titre en arabe', 'Arabic title')}>
          <Input value={form.titleAr} onChange={(titleAr) => shell.setReport({ titleAr })} />
        </Field>
        <Field label={tr('الوصف', 'Description', 'Description')}>
          <TextArea
            rows={2}
            value={form.description}
            onChange={(description) => shell.setReport({ description })}
          />
        </Field>
        <Field label={tr('الترتيب', 'Rang', 'Sort order')}>
          <Input
            value={form.sortOrder}
            inputMode="numeric"
            onChange={(sortOrder) => shell.setReport({ sortOrder })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function DashboardDialog({ shell, dialog }: Arm<'dashboard'>): ReactElement {
  const { tr } = useLocale();
  const form = dialog.form;

  return (
    <Dialog
      open
      title={dialog.id === null
        ? tr('لوحة جديدة', 'Nouveau tableau de bord', 'New dashboard')
        : tr('تعديل اللوحة', 'Modifier le tableau de bord', 'Edit dashboard')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: () => void shell.commitDashboard(),
        busy: shell.busy === 'save',
        disabled: blank(form.key) || blank(form.title),
      }}
    >
      <div style={GRID}>
        <div style={PAIR}>
          <Field label={tr('المفتاح', 'Clé', 'Key')} required>
            <Input value={form.key} mono onChange={(key) => shell.setDashboard({ key })} />
          </Field>
          <Field label={tr('العنوان', 'Titre', 'Title')} required>
            <Input value={form.title} onChange={(title) => shell.setDashboard({ title })} />
          </Field>
        </div>
        <Field label={tr('العنوان بالعربية', 'Titre en arabe', 'Arabic title')}>
          <Input value={form.titleAr} onChange={(titleAr) => shell.setDashboard({ titleAr })} />
        </Field>
        <Field label={tr('الوصف', 'Description', 'Description')}>
          <TextArea
            rows={2}
            value={form.description}
            onChange={(description) => shell.setDashboard({ description })}
          />
        </Field>
        <div style={PAIR}>
          <Field label={tr('الترتيب', 'Rang', 'Sort order')}>
            <Input
              value={form.sortOrder}
              inputMode="numeric"
              onChange={(sortOrder) => shell.setDashboard({ sortOrder })}
            />
          </Field>
          <div style={{ alignSelf: 'end', paddingBottom: 6 }}>
            <Checkbox
              checked={form.isDefault}
              onChange={(isDefault) => shell.setDashboard({ isDefault })}
              label={tr('اللوحة الافتراضية', 'Tableau par défaut', 'Default dashboard')}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function TileDialog({ shell, dialog }: Arm<'tile'>): ReactElement {
  const { tr } = useLocale();
  const form = dialog.form;
  const x = num(form.gridX, 0);
  const w = num(form.gridW, 6);
  const h = num(form.gridH, 4);
  /** The grid is twelve columns and `x + w <= 12` is a CHECK. Stated here rather than
   *  left to the server, because a tile that hangs off the edge is a mistake with an
   *  obvious fix and a round trip to learn it is a round trip wasted. */
  const fits = x + w <= 12 && w >= 1 && h >= 1;

  const box = (label: string, value: string, onChange: (next: string) => void): ReactElement => (
    <Field label={label}>
      <Input value={value} inputMode="numeric" onChange={onChange} />
    </Field>
  );

  return (
    <Dialog
      open
      title={dialog.id === null
        ? tr('إضافة بطاقة', 'Ajouter une tuile', 'Add tile')
        : tr('تعديل البطاقة', 'Modifier la tuile', 'Edit tile')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حفظ', 'Enregistrer', 'Save'),
        onClick: () => void shell.commitTile(),
        busy: shell.busy === 'save',
        disabled: !fits,
      }}
    >
      <div style={GRID}>
        {fits ? null : (
          <InfoBar tone="danger">
            {tr(
              'الشبكة اثنا عشر عمودًا: يجب ألا يتجاوز الموضع زائد العرض اثني عشر، وألا يقل العرض أو الارتفاع عن واحد.',
              'La grille fait douze colonnes : position plus largeur ne doit pas dépasser douze, et largeur comme hauteur valent au moins un.',
              'The grid is twelve columns wide: position plus width may not exceed twelve, and width and height are at least one.',
            )}
          </InfoBar>
        )}
        <div style={PAIR}>
          {box(tr('س', 'X', 'Column'), form.gridX, (gridX) => shell.setTile({ gridX }))}
          {box(tr('ص', 'Y', 'Row'), form.gridY, (gridY) => shell.setTile({ gridY }))}
        </div>
        <div style={PAIR}>
          {box(tr('العرض', 'Largeur', 'Width'), form.gridW, (gridW) => shell.setTile({ gridW }))}
          {box(tr('الارتفاع', 'Hauteur', 'Height'), form.gridH, (gridH) => shell.setTile({ gridH }))}
        </div>
        <Field label={tr('الترتيب', 'Rang', 'Sort order')}>
          <Input
            value={form.sortOrder}
            inputMode="numeric"
            onChange={(sortOrder) => shell.setTile({ sortOrder })}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * The two governance verbs
 * ------------------------------------------------------------------ */

/**
 * A status change, with the note that explains it.
 *
 * The note is optional and the button never refuses one — `commitStatus` trims it and
 * sends `undefined` for a blank, exactly as `./forms` does with a name. What the dialog
 * does say out loud is what the transition means, because `DEPRECATED` is the one that
 * keeps working: a deprecated metric still computes, and the analyses already built on
 * it still run. It is a warning to readers, not a switch.
 */
function StatusDialog({ shell, dialog }: Arm<'status'>): ReactElement {
  const { t, tr } = useLocale();

  return (
    <Dialog
      open
      title={tr('تغيير الحالة', 'Changer le statut', 'Change status')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('تطبيق', 'Appliquer', 'Apply'),
        onClick: () => void shell.commitStatus(),
        busy: shell.busy === 'status',
      }}
    >
      <div style={GRID}>
        <PropertyRow label={t(GOVERNED_KIND_LABEL[dialog.target])}>{dialog.title}</PropertyRow>
        <Field label={tr('الحالة', 'Statut', 'Status')}>
          <Select
            value={dialog.status}
            options={options(BI_STATUSES, STATUS_LABEL, t)}
            onChange={(next) => shell.setStatus(next as BiStatus)}
          />
        </Field>
        {dialog.status === 'DEPRECATED' ? (
          <InfoBar tone="warning">
            {tr(
              'الإهمال تحذير وليس إيقافًا: ما بُني على هذا التعريف يستمر في العمل.',
              'La dépréciation est un avertissement, pas un arrêt : ce qui est bâti dessus continue de fonctionner.',
              'Deprecating is a warning, not a stop. Everything already built on this keeps working.',
            )}
          </InfoBar>
        ) : null}
        <Field
          label={tr('ملاحظة', 'Note', 'Note')}
          hint={tr(
            'تُسجَّل في السجل بجانب الانتقال.',
            'Consignée au journal à côté de la transition.',
            'Recorded in the ledger beside the transition.',
          )}
        >
          <TextArea rows={3} value={dialog.text} onChange={shell.setNote} />
        </Field>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ shell, dialog }: Arm<'delete'>): ReactElement {
  const { t, tr } = useLocale();
  const cascade = CASCADE[dialog.target];

  return (
    <Dialog
      open
      title={tr('حذف', 'Supprimer', 'Delete')}
      onClose={shell.closeDialog}
      primary={{
        label: tr('حذف', 'Supprimer', 'Delete'),
        onClick: () => void shell.commitDelete(),
        busy: shell.busy === 'delete',
        danger: true,
      }}
    >
      <div style={GRID}>
        <PropertyRow label={t(CRUD_NOUN[dialog.target])}>{dialog.title}</PropertyRow>
        {cascade === undefined ? null : <InfoBar tone="warning">{t(cascade)}</InfoBar>}
        <div style={CAPTION}>
          {tr(
            'لا يمكن التراجع عن هذا من هنا.',
            'Cette action ne peut pas être annulée ici.',
            'This cannot be undone from here.',
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * The host
 * ------------------------------------------------------------------ */

export interface BiDialogHostProps {
  readonly shell: BiShell;
}

/**
 * One member open at a time, or none.
 *
 * The switch has no `default`, so a twelfth member added to {@link BiDialog} fails to
 * compile here rather than opening nothing at run time. Each arm is handed its own
 * narrowed member, which is what lets the editors read `dialog.form` without re-proving
 * the kind the way every commit has to.
 */
export function BiDialogHost({ shell }: BiDialogHostProps): ReactElement | null {
  const dialog = shell.dialog;
  if (dialog === null) return null;

  switch (dialog.kind) {
    case 'dataset':
      return <DatasetDialog shell={shell} dialog={dialog} />;
    case 'dimension':
      return <DimensionDialog shell={shell} dialog={dialog} />;
    case 'metric':
      return <MetricDialog shell={shell} dialog={dialog} />;
    case 'analysis':
      return <AnalysisDialog shell={shell} dialog={dialog} />;
    case 'report':
      return <ReportDialog shell={shell} dialog={dialog} />;
    case 'dashboard':
      return <DashboardDialog shell={shell} dialog={dialog} />;
    case 'tile':
      return <TileDialog shell={shell} dialog={dialog} />;
    case 'status':
      return <StatusDialog shell={shell} dialog={dialog} />;
    case 'delete':
      return <DeleteDialog shell={shell} dialog={dialog} />;
    case 'drill':
      return <BiDrillDialog shell={shell} dialog={dialog} />;
    case 'sql':
      return <BiSqlDialog shell={shell} dialog={dialog} />;
  }
}
