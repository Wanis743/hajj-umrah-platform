/**
 * The builder — the only pane in this app that writes a question rather than reading an answer.
 *
 * Everything else here is an inspector: a dataset read out, a dashboard's tiles listed, a logged
 * run explained. This is where an analyst composes the request, and the whole of what they are
 * composing is a `BuilderState` — a dataset, a chart type, an ordered list of dimension keys, an
 * ordered list of metric keys, some filters, a grain, a sort and a limit. Every control below
 * dispatches one `BuilderAction` and reads nothing back, because `builderReducer` already owns
 * every rule about what those actions mean: it refuses `bi_period` on the dimension shelf, it
 * clears a sort that no longer names a selected column, and it drops the drill trail when the
 * dataset changes. A panel that re-decided any of that would be a second reducer with a slightly
 * different opinion.
 *
 * **The shelves are ordered, and the order is the `GROUP BY`.** That is why a dimension can be
 * dragged within its own shelf and why the drop lands at an index rather than at the end. Two
 * dimensions in the other order is a different query with a different answer.
 *
 * **Readiness is drawn, not enforced.** `readiness` returns nine kinds of issue and `blocksRun`
 * says which five stop a run. The four that do not — a chart short of a dimension, short of a
 * measure, short of a date, or of a type this app cannot yet draw — are notes rather than errors,
 * because the *request* is valid and the reader is entitled to run it and read the table. The
 * five that do are stated in the same list, tinted differently, and the Run button in the command
 * bar is dark for exactly the condition `blocked` reports.
 *
 * The palette drags carry a private MIME type. A field dragged out of here cannot be dropped into
 * a text input somewhere else in the OS as a stray word, and a file dragged in off the desktop is
 * not mistaken for a metric.
 */
import type { CSSProperties, DragEvent, ReactElement } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  Info,
  Play,
  X,
} from 'lucide-react';
import {
  Breadcrumb,
  Button,
  Field,
  IconButton,
  Input,
  Select,
  toneColor,
  useLocale,
  type BreadcrumbSegment,
  type SelectOption,
} from '@/platform/sdk';
import {
  BUILDER_DRAG_MIME,
  blocksRun,
  clampLimit,
  decodeDrag,
  encodeDrag,
  orderOptions,
  type BuilderIssue,
  type BuilderState,
  type ShelfKind,
} from './builder';
import { FilterRows } from './fields';
import { CHART_LABEL, GRAIN_LABEL } from './labels';
import { isChartDrawn } from './model';
import type { Desk } from './pane';
import type { BiShell } from './shell';
import { CAPTION } from './styles';
import {
  BI_CHART_TYPES,
  BI_PERIOD_KEY,
  BI_ROW_LIMIT_MAX,
  BI_TIME_GRAINS,
  type BiChartType,
  type BiDimension,
  type BiMetric,
  type BiTimeGrain,
} from './types';

/**
 * The builder's own pane, which is not the inspector's.
 *
 * A 12px gap rather than the 14 `styles.ts` sets, because this column is twenty-odd controls
 * deep where an inspector is six sections, and the tighter rhythm is what keeps the Run button
 * reachable without a scroll on a 900px window.
 */
const PANE: CSSProperties = {
  display: 'grid',
  gap: 12,
  alignContent: 'start',
  padding: 14,
  minWidth: 0,
};

/** A shelf is a bordered well, so an empty one still reads as somewhere to drop. */
const WELL: CSSProperties = {
  display: 'grid',
  gap: 4,
  minHeight: 38,
  padding: 5,
  borderRadius: 'var(--fx-radius-control)',
  border: '1px dashed var(--fx-control-stroke)',
  background: 'var(--fx-control)',
};

/** A field on a shelf or in the palette: grip, name, and whatever sits at the end. */
const PILL: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: '4px 6px',
  borderRadius: 4,
  fontSize: 'var(--fx-caption)',
  cursor: 'grab',
};

/**
 * What an issue says, in one sentence that names the fix.
 *
 * Private, because this file exports components only. The wording carries the numbers rather
 * than a generic complaint — *"a line needs one grouping column and has none"* is actionable and
 * *"invalid chart configuration"* is not.
 */
function issueText(
  issue: BuilderIssue,
  tr: (ar: string, fr: string, en: string) => string,
  chart: string,
): string {
  switch (issue.kind) {
    case 'NO_DATASET':
      return tr(
        'اختر مجموعة بيانات لتبدأ.',
        'Choisissez un jeu de données pour commencer.',
        'Pick a dataset to begin.',
      );
    case 'EMPTY':
      return tr(
        'ضع بُعدًا أو مقياسًا على الرفوف.',
        'Posez une dimension ou une mesure sur les étagères.',
        'Put a dimension or a metric on the shelves.',
      );
    case 'NEEDS_DIMENSION':
      return tr(
        `${chart} يحتاج ${issue.need} عمود تجميع، ولديه ${issue.have}.`,
        `${chart} demande ${issue.need} colonne(s) de regroupement, il y en a ${issue.have}.`,
        `${chart} needs ${issue.need} grouping column(s) and has ${issue.have}.`,
      );
    case 'NEEDS_MEASURE':
      return tr(
        `${chart} يحتاج ${issue.need} مقياسًا، ولديه ${issue.have}.`,
        `${chart} demande ${issue.need} mesure(s), il y en a ${issue.have}.`,
        `${chart} needs ${issue.need} measure(s) and has ${issue.have}.`,
      );
    case 'NEEDS_TEMPORAL':
      return tr(
        `${chart} يحتاج تاريخًا: اضبط حبيبة زمنية أو اختر بُعدًا من نوع تاريخ.`,
        `${chart} demande une date : réglez une granularité ou choisissez une dimension de type date.`,
        `${chart} needs a date: set a time grain, or pick a date-typed dimension.`,
      );
    case 'NOT_DRAWN':
      return tr(
        `${chart} غير مرسوم بعد؛ ستُقرأ النتيجة كجدول.`,
        `${chart} n’est pas encore dessiné ; le résultat se lira sous forme de table.`,
        `${chart} is not drawn yet; the result will read as a table.`,
      );
    case 'FILTER_INCOMPLETE':
      return tr(
        `الشرط ${issue.index + 1} على ${issue.field} ناقص القيمة.`,
        `Le filtre ${issue.index + 1} sur ${issue.field} n’a pas de valeur.`,
        `Filter ${issue.index + 1} on ${issue.field} has no value.`,
      );
    case 'DEPRECATED_METRIC':
      return tr(
        `المقياس ${issue.key} موقوف، والمُصرِّف يرفضه.`,
        `La mesure ${issue.key} est dépréciée ; le compilateur la refuse.`,
        `The metric ${issue.key} is deprecated, and the compiler refuses it.`,
      );
    case 'ORDER_UNSELECTED':
      return tr(
        `الترتيب على ${issue.key} وهو ليس من الأعمدة المختارة.`,
        `Le tri porte sur ${issue.key}, qui n’est pas une colonne sélectionnée.`,
        `The sort is on ${issue.key}, which is not a selected column.`,
      );
  }
}

/**
 * The readiness list, blockers first.
 *
 * One list rather than two, because a reader fixing a request wants everything wrong with it in
 * one place — but tinted in two, because five of these nine stop the run and four do not, and a
 * panel that drew them the same way would teach somebody to ignore all of them.
 */
function Issues({ shell }: Desk) {
  const { t, tr } = useLocale();
  if (shell.issues.length === 0) return null;
  const ordered = [...shell.issues].sort((a, b) => Number(blocksRun(b)) - Number(blocksRun(a)));
  const chart = t(CHART_LABEL[shell.builder.chartType]);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {ordered.map((issue, index) => {
        const stops = blocksRun(issue);
        return (
          <div
            key={`${issue.kind}:${index}`}
            style={{
              display: 'flex',
              alignItems: 'start',
              gap: 6,
              fontSize: 'var(--fx-caption)',
              color: toneColor(stops ? 'danger' : 'neutral'),
            }}
          >
            <span style={{ flex: 'none', paddingTop: 1 }}>
              {stops ? <AlertTriangle size={13} /> : <Info size={13} />}
            </span>
            <span style={{ minWidth: 0, lineHeight: 1.45 }}>{issueText(issue, tr, chart)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Drag and drop
 * ------------------------------------------------------------------ */

/** Whether the thing being dragged is one of ours. `getData` is empty during a drag by design —
 *  the browser will not let a page read a payload it has not been dropped — so the type list is
 *  the only thing available to answer with, and it is enough. */
const isOurs = (event: DragEvent<HTMLElement>): boolean =>
  event.dataTransfer.types.includes(BUILDER_DRAG_MIME);

interface FieldPillProps {
  readonly shelf: ShelfKind;
  readonly fieldKey: string;
  readonly label: string;
  readonly hint: string;
  /** Its index on the shelf, or null when it is sitting in the palette. That difference is what
   *  separates a reorder from an add, and the reducer reads it off the payload. */
  readonly at: number | null;
  readonly tone?: 'danger' | 'warning';
  readonly onDrop?: (event: DragEvent<HTMLElement>) => void;
  readonly onRemove?: () => void;
}

/**
 * One field, draggable, and — when it is on a shelf — a drop target in its own right.
 *
 * Per-item drop zones rather than one zone per shelf with arithmetic over the pointer position.
 * The index a drop lands at is *this pill's* index, which is exact, and the alternative is a
 * calculation against `getBoundingClientRect` that has to be right at every zoom level and in
 * both writing directions. A shelf that groups in the wrong order is not a cosmetic bug.
 */
function FieldPill({
  shelf, fieldKey, label, hint, at, tone, onDrop, onRemove,
}: FieldPillProps) {
  const { tr } = useLocale();
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(BUILDER_DRAG_MIME, encodeDrag({ shelf, key: fieldKey, from: at }));
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={onDrop === undefined ? undefined : (event) => {
        if (!isOurs(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
      title={hint}
      style={{
        ...PILL,
        background: tone === undefined ? 'var(--fx-card)' : undefined,
        border: `1px solid ${tone === undefined ? 'var(--fx-control-stroke)' : toneColor(tone)}`,
        color: tone === undefined ? undefined : toneColor(tone),
      }}
    >
      <GripVertical size={12} style={{ flex: 'none', color: 'var(--fx-text-tertiary)' }} />
      <span className="fx-title-ellipsis" style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {onRemove === undefined ? null : (
        <IconButton
          icon={X}
          size={12}
          label={tr('إزالة', 'Retirer', 'Remove')}
          onClick={onRemove}
        />
      )}
    </div>
  );
}

interface ShelfProps {
  readonly shell: BiShell;
  readonly shelf: ShelfKind;
  readonly keys: readonly string[];
  readonly dimensions: readonly BiDimension[];
  readonly metrics: readonly BiMetric[];
}

/**
 * One shelf: an ordered well that accepts its own kind and refuses the other.
 *
 * A metric dropped on the dimension shelf is dropped on the floor rather than converted. The two
 * are not interchangeable — a dimension is what you group by and a metric is what gets computed —
 * and a shelf that quietly accepted the wrong one would produce a request the compiler refuses
 * with a message about a column it cannot aggregate.
 *
 * The period column is drawn here when a grain is set and is not one of the keys. `bi_compile_query`
 * adds it itself, `builderReducer` refuses to put it on the shelf, and so the only honest rendering
 * is a pill that says where it came from and cannot be dragged or removed — because the way to
 * remove it is to clear the grain.
 */
function Shelf({ shell, shelf, keys, dimensions, metrics }: ShelfProps) {
  const { tr } = useLocale();
  const grained = shelf === 'DIMENSION' && shell.builder.timeGrain !== null;

  const drop = (to: number) => (event: DragEvent<HTMLElement>) => {
    if (!isOurs(event)) return;
    event.preventDefault();
    const drag = decodeDrag(event.dataTransfer.getData(BUILDER_DRAG_MIME));
    if (drag === null || drag.shelf !== shelf) return;
    if (drag.from === null) shell.dispatch({ type: 'ADD_FIELD', shelf, key: drag.key, at: to });
    else shell.dispatch({ type: 'MOVE_FIELD', shelf, from: drag.from, to });
  };

  return (
    <div
      style={WELL}
      onDragOver={(event) => {
        if (!isOurs(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={drop(keys.length)}
    >
      {grained ? (
        <div
          style={{ ...PILL, cursor: 'default', border: '1px solid var(--fx-accent)', color: 'var(--fx-accent)' }}
          title={tr(
            'يضيف المُصرِّف عمود الفترة نفسه؛ أزِل الحبيبة لإزالته.',
            'Le compilateur ajoute lui-même la colonne de période ; retirez la granularité pour l’enlever.',
            'The compiler adds the period column itself; clear the grain to remove it.',
          )}
        >
          <span className="fx-mono fx-title-ellipsis" style={{ flex: 1, minWidth: 0 }}>
            {BI_PERIOD_KEY}
          </span>
        </div>
      ) : null}

      {keys.length === 0 && !grained ? (
        <span style={{ ...CAPTION, padding: '6px 4px' }}>
          {shelf === 'DIMENSION'
            ? tr('اسحب بُعدًا إلى هنا', 'Glissez une dimension ici', 'Drag a dimension here')
            : tr('اسحب مقياسًا إلى هنا', 'Glissez une mesure ici', 'Drag a metric here')}
        </span>
      ) : null}

      {keys.map((key, index) => {
        const dimension = shelf === 'DIMENSION'
          ? dimensions.find((one) => one.key === key)
          : undefined;
        const metric = shelf === 'METRIC' ? metrics.find((one) => one.key === key) : undefined;
        const found = dimension ?? metric;
        const dead = metric?.status === 'DEPRECATED';
        return (
          <FieldPill
            key={key}
            shelf={shelf}
            fieldKey={key}
            at={index}
            label={found?.name ?? key}
            hint={found === undefined
              ? tr(
                  'هذا المفتاح غير معرَّف في مجموعة البيانات الحالية.',
                  'Cette clé n’est pas définie dans le jeu de données courant.',
                  'This key is not defined on the current dataset.',
                )
              : key}
            tone={found === undefined ? 'warning' : dead ? 'danger' : undefined}
            onDrop={drop(index)}
            onRemove={() => shell.dispatch({ type: 'REMOVE_FIELD', shelf, key })}
          />
        );
      })}
    </div>
  );
}

interface PaletteProps {
  readonly shelf: ShelfKind;
  readonly dimensions: readonly BiDimension[];
  readonly metrics: readonly BiMetric[];
  readonly used: readonly string[];
}

/**
 * The dataset's unused definitions, as things to drag.
 *
 * Used fields are hidden rather than greyed. A dimension can only sit on the shelf once — the
 * reducer refuses a duplicate — so a pill that is still visible and still draggable and does
 * nothing on drop is a control that lies about itself.
 */
function Palette({ shelf, dimensions, metrics, used }: PaletteProps) {
  const { tr } = useLocale();
  const rows: readonly { key: string; name: string; hint: string; dead: boolean }[] = shelf === 'DIMENSION'
    ? dimensions.map((one) => ({ key: one.key, name: one.name, hint: one.expression, dead: false }))
    : metrics.map((one) => ({
        key: one.key,
        name: one.name,
        hint: one.formula === '' ? one.key : one.formula,
        dead: one.status === 'DEPRECATED',
      }));
  const free = rows.filter((row) => !used.includes(row.key));

  if (free.length === 0) {
    return (
      <span style={CAPTION}>
        {rows.length === 0
          ? tr('لا تعريفات على هذه المجموعة.', 'Aucune définition sur ce jeu.', 'No definitions on this dataset.')
          : tr('كلها على الرفوف.', 'Toutes sur les étagères.', 'All on the shelves.')}
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {free.map((row) => (
        <FieldPill
          key={row.key}
          shelf={shelf}
          fieldKey={row.key}
          at={null}
          label={row.name}
          hint={row.hint}
          tone={row.dead ? 'danger' : undefined}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The two halves of the question that are not shelves
 * ------------------------------------------------------------------ */

interface SourceProps {
  readonly shell: BiShell;
  readonly state: BuilderState;
}

/**
 * What is being read, and how it will be drawn.
 *
 * The dataset picker lists datasets this reader cannot query. They are disabled rather than
 * hidden and the disabled option says why: a catalog the analyst can see but not read from is
 * a permission problem somebody can act on, and a picker that silently omitted them would
 * present it as an empty workspace.
 *
 * The chart picker does the same thing with a different absence. `BI_CHART_TYPES` is every
 * type the CHECK constraint allows, and this app draws a subset of them — so a type it cannot
 * draw is offered, marked *table*, and read as a table. Hiding it would make the database's
 * own vocabulary look smaller than it is, and a saved analysis of that type would then load
 * into a picker with no matching option.
 */
function SourceFields({ shell, state }: SourceProps): ReactElement {
  const { t, tr } = useLocale();

  const datasets: readonly SelectOption[] = shell.model.datasets.map((one) => ({
    value: one.id,
    label: one.readableByMe ? one.name : `${one.name} · ${tr('ممنوع', 'refusé', 'denied')}`,
    disabled: !one.readableByMe,
  }));

  const charts: readonly SelectOption[] = BI_CHART_TYPES.map((type: BiChartType) => ({
    value: type,
    label: isChartDrawn(type)
      ? t(CHART_LABEL[type])
      : `${t(CHART_LABEL[type])} · ${tr('جدول', 'table', 'table')}`,
  }));

  return (
    <>
      <Field label={tr('مجموعة البيانات', 'Jeu de données', 'Dataset')}>
        <Select
          value={state.datasetId ?? ''}
          options={datasets}
          placeholder={tr('اختر مجموعة…', 'Choisir un jeu…', 'Pick a dataset…')}
          onChange={(next) => shell.dispatch({ type: 'DATASET', datasetId: next === '' ? null : next })}
        />
      </Field>

      <Field
        label={tr('الرسم', 'Graphique', 'Chart')}
        hint={isChartDrawn(state.chartType)
          ? undefined
          : tr(
              'هذا النوع مسموح في القاعدة ولم يُرسم بعد؛ النتيجة تُقرأ كجدول.',
              'Ce type est permis par la base mais pas encore dessiné ; le résultat se lit en table.',
              'This type is allowed by the database and not drawn yet; the result reads as a table.',
            )}
      >
        <Select
          value={state.chartType}
          options={charts}
          onChange={(next) => shell.dispatch({ type: 'CHART', chartType: next as BiChartType })}
        />
      </Field>
    </>
  );
}

interface ShapeProps {
  readonly shell: BiShell;
  readonly state: BuilderState;
  readonly dimensions: readonly BiDimension[];
  readonly metrics: readonly BiMetric[];
  /** Whether the dataset carries a time column at all. A grain over a dataset with none is
   *  a control that does nothing, so it is disabled and says why rather than silently
   *  producing the same query it produced before. */
  readonly timed: boolean;
}

/**
 * At what grain, in what order, and how many rows.
 *
 * The three decisions taken after the shelves are full — none of them changes *what* is being
 * measured, all three change what comes back. The sort list is `orderOptions(state)`, which is
 * the selected keys and nothing else: a sort naming a column that is not in the projection is
 * a query the compiler refuses, so it is not offered.
 *
 * The limit is parsed and clamped rather than validated. `clampLimit` is the same function the
 * reducer uses, so a number typed here and a number arriving from a loaded analysis land on
 * the same bounds; a non-numeric keystroke is dropped rather than zeroing the field, because
 * a limit that briefly reads `0` is a query nobody asked for.
 */
function ShapeFields({ shell, state, dimensions, metrics, timed }: ShapeProps): ReactElement {
  const { t, tr } = useLocale();

  const grains: readonly SelectOption[] = [
    { value: '', label: tr('بلا حبيبة', 'Aucune', 'No grain') },
    ...BI_TIME_GRAINS.map((grain: BiTimeGrain) => ({ value: grain, label: t(GRAIN_LABEL[grain]) })),
  ];

  const sorts: readonly SelectOption[] = [
    { value: '', label: tr('افتراضي المُصرِّف', 'Défaut du compilateur', 'Compiler default') },
    ...orderOptions(state).map((key) => {
      const found = dimensions.find((one) => one.key === key) ?? metrics.find((one) => one.key === key);
      return { value: key, label: key === BI_PERIOD_KEY ? tr('الفترة', 'Période', 'Period') : found?.name ?? key };
    }),
  ];

  return (
    <>
      <Field
        label={tr('الحبيبة الزمنية', 'Granularité', 'Time grain')}
        hint={timed
          ? undefined
          : tr(
              'لا عمود زمن على هذه المجموعة، فالحبيبة لا تفعل شيئًا.',
              'Aucune colonne temporelle sur ce jeu : la granularité ne fait rien.',
              'No time column on this dataset, so a grain does nothing.',
            )}
      >
        <Select
          value={state.timeGrain ?? ''}
          options={grains}
          disabled={!timed}
          onChange={(next) => shell.dispatch({
            type: 'GRAIN',
            timeGrain: next === '' ? null : (next as BiTimeGrain),
          })}
        />
      </Field>

      <Field label={tr('الترتيب', 'Tri', 'Sort')}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Select
            value={state.orderBy ?? ''}
            options={sorts}
            onChange={(next) => shell.dispatch({
              type: 'ORDER',
              orderBy: next === '' ? null : next,
              orderDesc: state.orderDesc,
            })}
          />
          <IconButton
            icon={state.orderDesc ? ArrowDown : ArrowUp}
            label={state.orderDesc
              ? tr('تنازلي', 'Décroissant', 'Descending')
              : tr('تصاعدي', 'Croissant', 'Ascending')}
            onClick={() => shell.dispatch({
              type: 'ORDER',
              orderBy: state.orderBy,
              orderDesc: !state.orderDesc,
            })}
          />
        </div>
      </Field>

      <Field
        label={tr('حد الصفوف', 'Limite de lignes', 'Row limit')}
        hint={tr(
          `بين 1 و ${BI_ROW_LIMIT_MAX}. النتيجة المقتطعة مجموعها جزئي.`,
          `Entre 1 et ${BI_ROW_LIMIT_MAX}. Un résultat tronqué donne des totaux partiels.`,
          `Between 1 and ${BI_ROW_LIMIT_MAX}. A truncated result gives partial totals.`,
        )}
      >
        <Input
          value={String(state.limit)}
          inputMode="numeric"
          onChange={(next) => {
            const parsed = Number.parseInt(next, 10);
            if (!Number.isNaN(parsed)) shell.dispatch({ type: 'LIMIT', limit: clampLimit(parsed) });
          }}
        />
      </Field>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The pane
 * ------------------------------------------------------------------ */

export interface BiShelvesProps {
  readonly shell: BiShell;
}

/**
 * The question, composed.
 *
 * Order of the pane is the order of the decisions: which data, drawn how, grouped by what,
 * measuring what, narrowed to which rows, at what grain, sorted how, capped where. Readiness
 * sits at the top rather than the bottom — it is the reason the Run button is dark, and a reason
 * printed below the fold is not a reason.
 *
 * The pane keeps the shelves and the filters and hands the rest to {@link SourceFields} and
 * {@link ShapeFields}, which is the same seam the paragraph above describes: what is being read
 * and how it is drawn, then the shelves that say what is measured, then how the answer is
 * shaped on the way back. None of the three holds state; all three dispatch.
 */
export function BiShelves({ shell }: BiShelvesProps): ReactElement {
  const { tr } = useLocale();
  const state = shell.builder;
  const detail = shell.model.dataset.value;
  const onThisDataset = detail !== null && detail.dataset.id === state.datasetId;
  const dimensions = onThisDataset ? detail.dimensions : [];
  const metrics = onThisDataset ? detail.metrics : [];
  const columns = onThisDataset ? detail.columns : [];

  const trail: readonly BreadcrumbSegment[] = [
    { label: tr('الكل', 'Tout', 'All'), value: '0' },
    ...state.trail.map((step, index) => ({ label: step.label, value: String(index + 1) })),
  ];

  return (
    <div style={PANE} className="fx-scroll">
      <Issues shell={shell} />

      {state.trail.length === 0 ? null : (
        <Field
          label={tr('مسار التنقيب', 'Chemin de forage', 'Drill path')}
          hint={tr(
            'كل خطوة أضافت شرط تساوٍ؛ ارجع لخطوة لتُسقط ما بعدها.',
            'Chaque étape a ajouté une égalité ; revenez à une étape pour abandonner les suivantes.',
            'Each step added an equality; go back to a step to drop the ones after it.',
          )}
        >
          <Breadcrumb
            segments={trail}
            onNavigate={(value) => shell.dispatch({ type: 'TRAIL_TO', depth: Number(value) })}
          />
        </Field>
      )}

      <SourceFields shell={shell} state={state} />

      <Field
        label={tr('الأبعاد', 'Dimensions', 'Dimensions')}
        hint={tr(
          'الترتيب هو ترتيب التجميع.',
          'L’ordre est celui du regroupement.',
          'The order is the grouping order.',
        )}
      >
        <Shelf
          shell={shell}
          shelf="DIMENSION"
          keys={state.dimensions}
          dimensions={dimensions}
          metrics={metrics}
        />
      </Field>

      <Field label={tr('المقاييس', 'Mesures', 'Metrics')}>
        <Shelf
          shell={shell}
          shelf="METRIC"
          keys={state.metrics}
          dimensions={dimensions}
          metrics={metrics}
        />
      </Field>

      <Field label={tr('أبعاد متاحة', 'Dimensions disponibles', 'Available dimensions')}>
        <Palette shelf="DIMENSION" dimensions={dimensions} metrics={metrics} used={state.dimensions} />
      </Field>

      <Field label={tr('مقاييس متاحة', 'Mesures disponibles', 'Available metrics')}>
        <Palette shelf="METRIC" dimensions={dimensions} metrics={metrics} used={state.metrics} />
      </Field>

      <FilterRows
        filters={state.filters}
        columns={columns}
        onChange={(filters) => {
          // The reducer has no "replace them all" action, on purpose: every other caller of
          // ADD/SET/REMOVE_FILTER is a single edit, and a bulk setter would be the one path that
          // could plant a filter list nothing had validated. `FilterRows` hands back the whole
          // list, so the three actions are replayed against it.
          const before = state.filters;
          if (filters.length > before.length) {
            const added = filters[filters.length - 1];
            if (added !== undefined) shell.dispatch({ type: 'ADD_FILTER', filter: added });
            return;
          }
          if (filters.length < before.length) {
            const gone = before.findIndex((one, index) => filters[index] !== one);
            shell.dispatch({ type: 'REMOVE_FILTER', index: gone === -1 ? before.length - 1 : gone });
            return;
          }
          filters.forEach((filter, index) => {
            if (filter !== before[index]) shell.dispatch({ type: 'SET_FILTER', index, filter });
          });
        }}
      />

      <ShapeFields
        shell={shell}
        state={state}
        dimensions={dimensions}
        metrics={metrics}
        timed={detail !== null && detail.dataset.timeColumn !== null}
      />

      <Button
        icon={Play}
        variant="accent"
        block
        busy={shell.busy === 'query'}
        disabled={shell.blocked || shell.busy !== null}
        onClick={() => shell.command('run')}
      >
        {tr('تشغيل', 'Exécuter', 'Run')}
      </Button>

      {shell.loadedAnalysis === null ? null : (
        <span style={CAPTION}>
          {tr(
            `مُحمَّل من: ${shell.loadedAnalysis.title}`,
            `Chargé depuis : ${shell.loadedAnalysis.title}`,
            `Loaded from: ${shell.loadedAnalysis.title}`,
          )}
          {shell.stale
            ? ` · ${tr('تغيَّرت الرفوف', 'les étagères ont changé', 'the shelves have changed')}`
            : ''}
        </span>
      )}

      <span style={CAPTION}>
        {tr(
          `${dimensions.length} بُعدًا و${metrics.length} مقياسًا متاحة`,
          `${dimensions.length} dimensions et ${metrics.length} mesures disponibles`,
          `${dimensions.length} dimensions and ${metrics.length} metrics available`,
        )}
      </span>
    </div>
  );
}
