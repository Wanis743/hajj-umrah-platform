/**
 * The builder's left rail: what may be added, what is on the shelves, and the four
 * request fields that are not fields at all.
 *
 * Drag and drop is the interaction this screen was asked for, and it is implemented
 * over the native HTML5 API with a private MIME type rather than a library, so a field
 * dragged out of the palette can only be dropped on a shelf that accepts it and a file
 * dragged in from the desktop is ignored.
 *
 * Every drag has a keyboard equivalent beside it, and that is not decoration: a shelf
 * whose order can only be changed by dragging is a shelf a keyboard user cannot use,
 * and the order is not cosmetic here -- it is the group-by order, so it decides what
 * the result means. Click a palette chip to add, use the two arrows to reorder, the ×
 * to remove.
 *
 * Nothing in this file runs a query or decides whether one is valid. It reports
 * intent; `biBuilderState` holds the rules and the canvas does the running.
 */
import { useMemo, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, Search, X } from 'lucide-react';
import Select from '@/components/admin/GlassSelect';
import {
  BI_CHART_TYPES, BI_TIME_GRAINS, type BiChartType, type BiTimeGrain,
} from '@/types/bi';
import { GroupLabel, Panel, Pill } from './atoms';
import {
  BUILDER_DRAG_MIME, BUILDER_LIMITS, decodeDrag, encodeDrag, type ShelfKind,
} from './biBuilderState';
import { fmtInt, isChartDrawn, useBiChartLabels, useBiI18n, useBiLabels } from './biFormat';

/** A field as a shelf and a palette chip need it: a key, what to print, and the text
 *  behind it. Kept structural rather than shared, so neither this file nor the canvas
 *  has to export a type from a .tsx. */
interface ChipField {
  key: string;
  label: string;
  /** The expression or formula, shown as a title. "Where does this number come from"
   *  should be answerable without leaving the builder. */
  hint?: string;
  /** A field that exists but may not be used -- a deprecated metric, which the compiler
   *  refuses outright. Offered as disabled rather than hidden, because a metric that
   *  vanished from the palette looks like a bug in the screen. */
  blocked?: boolean;
  blockedNote?: string;
}

/* -------------------------------------------------------------------------- */
/* Palette                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything this dataset defines, minus what is already on a shelf.
 *
 * Filtered by one box over both groups: an author looking for "revenue" does not know
 * or care whether it was authored as a dimension or a metric, and two search boxes for
 * one question is two places to look.
 */
export function FieldPalette({ dimensions, metrics, onAdd }: {
  dimensions: readonly ChipField[];
  metrics: readonly ChipField[];
  onAdd: (shelf: ShelfKind, key: string) => void;
}) {
  const { t } = useBiI18n();
  const [text, setText] = useState('');
  const needle = text.trim().toLowerCase();
  // The predicate is written twice rather than lifted, so each memo's dependency list
  // is exactly the data it reads: a shared closure would be a new identity per render
  // and both memos would recompute on every keystroke anyway.
  const shownDims = useMemo(
    () => dimensions.filter((f) => needle === '' || `${f.key} ${f.label}`.toLowerCase().includes(needle)),
    [dimensions, needle],
  );
  const shownMets = useMemo(
    () => metrics.filter((f) => needle === '' || `${f.key} ${f.label}`.toLowerCase().includes(needle)),
    [metrics, needle],
  );

  return (
    <Panel
      title={t('الحقول', 'Champs', 'Fields')}
      subtitle={t('اسحب إلى رفّ، أو انقر للإضافة',
        'Glissez sur une étagère, ou cliquez', 'Drag onto a shelf, or click to add')}
    >
      <label className="relative mb-3 block">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <input
          className="input ps-8"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('ابحث في الحقول', 'Rechercher un champ', 'Search fields')}
          aria-label={t('ابحث في الحقول', 'Rechercher un champ', 'Search fields')}
        />
      </label>

      <PaletteGroup
        label={t(`الأبعاد · ${fmtInt(shownDims.length)}`, `Dimensions · ${fmtInt(shownDims.length)}`,
          `Dimensions · ${fmtInt(shownDims.length)}`)}
        empty={t('لا بعد متاح', 'Aucune dimension', 'No dimension available')}
        fields={shownDims}
        shelf="DIMENSION"
        onAdd={onAdd}
      />
      <PaletteGroup
        label={t(`المقاييس · ${fmtInt(shownMets.length)}`, `Mesures · ${fmtInt(shownMets.length)}`,
          `Metrics · ${fmtInt(shownMets.length)}`)}
        empty={t('لا مقياس متاح', 'Aucune mesure', 'No metric available')}
        fields={shownMets}
        shelf="METRIC"
        onAdd={onAdd}
      />
    </Panel>
  );
}

function PaletteGroup({ label, empty, fields, shelf, onAdd }: {
  label: string;
  empty: string;
  fields: readonly ChipField[];
  shelf: ShelfKind;
  onAdd: (shelf: ShelfKind, key: string) => void;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <GroupLabel>{label}</GroupLabel>
      {fields.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {fields.map((field) => (
            <PaletteChip key={field.key} field={field} shelf={shelf} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One draggable field. `effectAllowed = 'copy'` because the palette keeps the field:
 *  what moves onto the shelf is a reference, and the definition stays where it is. */
function PaletteChip({ field, shelf, onAdd }: {
  field: ChipField;
  shelf: ShelfKind;
  onAdd: (shelf: ShelfKind, key: string) => void;
}) {
  const start = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(BUILDER_DRAG_MIME, encodeDrag({ shelf, key: field.key, from: null }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  if (field.blocked) {
    return (
      <span
        title={field.blockedNote ?? field.hint}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-2 py-1 text-[12px] text-[var(--text-muted)] line-through"
      >
        {field.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={start}
      onClick={() => onAdd(shelf, field.key)}
      title={field.hint}
      className="inline-flex cursor-grab items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] active:cursor-grabbing"
    >
      <Plus className="h-3 w-3" aria-hidden="true" />
      {field.label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Shelves                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One shelf: an ordered list of fields, and a drop target.
 *
 * The order is load-bearing on the dimension shelf -- it is the group-by order, so it
 * decides which column a chart draws along its axis and which one splits it into
 * series. That is why a reorder is a first-class act here rather than a nicety, and why
 * it has arrows as well as a drag.
 *
 * A drop on an item inserts before it; a drop on the empty space below appends. Both
 * are the same action to the reducer, which is what keeps this file free of any rule
 * about what may sit where.
 */
export function FieldShelf({ shelf, title, hint, fields, empty, onAdd, onMove, onRemove }: {
  shelf: ShelfKind;
  title: string;
  hint: string;
  fields: readonly ChipField[];
  empty: string;
  onAdd: (shelf: ShelfKind, key: string, at: number) => void;
  onMove: (shelf: ShelfKind, from: number, to: number) => void;
  onRemove: (shelf: ShelfKind, key: string) => void;
}) {
  const [over, setOver] = useState(false);

  /** A drop resolved into either an add or a reorder. `at` is the slot it landed on. */
  const drop = (e: DragEvent<HTMLElement>, at: number) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const drag = decodeDrag(e.dataTransfer.getData(BUILDER_DRAG_MIME));
    if (!drag || drag.shelf !== shelf) return;
    if (drag.from === null) onAdd(shelf, drag.key, at);
    else onMove(shelf, drag.from, at);
  };

  const allow = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer.types.includes(BUILDER_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(true);
  };

  return (
    <div className="mb-3 last:mb-0">
      <GroupLabel>{title}</GroupLabel>
      <ul
        onDragOver={allow}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => drop(e, fields.length)}
        className={`space-y-1.5 rounded-lg border border-dashed p-2 transition-colors ${
          over ? 'border-[var(--accent)] bg-[var(--bg-hover)]' : 'border-[var(--border)]'
        }`}
      >
        {fields.length === 0 ? (
          <li className="py-3 text-center text-[11px] text-[var(--text-muted)]">{empty}</li>
        ) : (
          fields.map((field, index) => (
            <ShelfItem
              key={field.key}
              field={field}
              index={index}
              count={fields.length}
              shelf={shelf}
              onDrop={drop}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))
        )}
      </ul>
      <p className="mt-1 px-1 text-[11px] text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

function ShelfItem({ field, index, count, shelf, onDrop, onMove, onRemove }: {
  field: ChipField;
  index: number;
  count: number;
  shelf: ShelfKind;
  onDrop: (e: DragEvent<HTMLElement>, at: number) => void;
  onMove: (shelf: ShelfKind, from: number, to: number) => void;
  onRemove: (shelf: ShelfKind, key: string) => void;
}) {
  const { t } = useBiI18n();
  const start = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData(BUILDER_DRAG_MIME, encodeDrag({ shelf, key: field.key, from: index }));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <li
      draggable
      onDragStart={start}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(BUILDER_DRAG_MIME)) e.preventDefault();
      }}
      onDrop={(e) => onDrop(e, index)}
      className="flex cursor-grab items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2 py-1 active:cursor-grabbing"
    >
      <span className="w-4 shrink-0 text-center text-[10px] tabular text-[var(--text-muted)]">
        {index + 1}
      </span>
      <span className="min-w-0 grow truncate text-[12px] text-[var(--text-primary)]" title={field.hint}>
        {field.label}
      </span>
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMove(shelf, index, index - 1)}
        aria-label={t('حرّك لأعلى', 'Monter', 'Move up')}
        className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
      >
        <ChevronUp className="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={index === count - 1}
        onClick={() => onMove(shelf, index, index + 1)}
        aria-label={t('حرّك لأسفل', 'Descendre', 'Move down')}
        className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-30"
      >
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onRemove(shelf, field.key)}
        aria-label={t('أزل', 'Retirer', 'Remove')}
        className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Chart type and query options                                               */
/* -------------------------------------------------------------------------- */

/**
 * The chart type, over all thirty-three the CHECK constraint accepts.
 *
 * The seven with no renderer yet are offered anyway, suffixed with the reason. Hiding
 * them would make a saved tile impossible to reproduce in the builder -- the constraint
 * allows them and a saved analysis may already name one -- and choosing one is not
 * blocked either: it is a shape issue, not one of the compiler's refusals, so the
 * request still runs and the frame says what it could not draw.
 */
export function ChartPicker({ value, onChange }: {
  value: BiChartType;
  onChange: (chartType: BiChartType) => void;
}) {
  const { t } = useBiI18n();
  const names = useBiChartLabels();
  const pending = t('لا يُرسم بعد', 'pas encore tracé', 'not drawn yet');

  return (
    <div>
      <GroupLabel>{t('نوع الرسم', 'Type de graphique', 'Chart type')}</GroupLabel>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value as BiChartType)}
        className="input"
        aria-label={t('نوع الرسم', 'Type de graphique', 'Chart type')}
      >
        {BI_CHART_TYPES.map((type) => (
          <option key={type} value={type}>
            {isChartDrawn(type) ? names[type] : `${names[type]} — ${pending}`}
          </option>
        ))}
      </Select>
      {!isChartDrawn(value) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Pill tone="warn">{pending}</Pill>
          {t('يُحفظ ويُشغّل، والإطار يذكر ما لم يُرسم',
            'Enregistré et exécuté ; le cadre indique ce qui n’a pas été tracé',
            'It saves and runs; the frame names what it could not draw')}
        </p>
      )}
    </div>
  );
}

/**
 * Time grain, ordering and row limit -- the four request fields that are not fields.
 *
 * The grain is one of them and it is the subtle one: choosing a grain adds a period
 * column to the result, which the compiler builds itself as the first column. It is
 * therefore not on the dimension shelf and cannot be, which is why it lives here.
 *
 * The order choices are supplied by the caller rather than derived, because only the
 * shelves know which columns will exist, and the compiler refuses an order-by that is
 * not one of them. The null option is labelled with what the compiler actually does
 * when it is not told: the first measure descending, or the first grouping column.
 */
export function QueryOptions({
  timeGrain, orderBy, orderDesc, limit, orderChoices, onGrain, onOrder, onLimit,
}: {
  timeGrain: BiTimeGrain | null;
  orderBy: string | null;
  orderDesc: boolean;
  limit: number;
  orderChoices: readonly { key: string; label: string }[];
  onGrain: (grain: BiTimeGrain | null) => void;
  onOrder: (key: string | null, desc: boolean) => void;
  onLimit: (limit: number) => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();

  return (
    <Panel
      title={t('الاستعلام', 'Requête', 'Query')}
      subtitle={t('حبيبة الزمن والترتيب والحد الأقصى للصفوف',
        'Granularité, tri et plafond de lignes', 'Grain, ordering and row cap')}
    >
      <div className="space-y-3">
        <div>
          <GroupLabel>{t('حبيبة الزمن', 'Granularité', 'Time grain')}</GroupLabel>
          <Select
            value={timeGrain ?? ''}
            onChange={(e) => onGrain(e.target.value === '' ? null : e.target.value as BiTimeGrain)}
            className="input"
            aria-label={t('حبيبة الزمن', 'Granularité', 'Time grain')}
          >
            <option value="">{t('بلا زمن', 'Sans temps', 'No time column')}</option>
            {BI_TIME_GRAINS.map((grain) => (
              <option key={grain} value={grain}>{labels.grain[grain]}</option>
            ))}
          </Select>
          <p className="mt-1 px-1 text-[11px] text-[var(--text-muted)]">
            {t('يضيف عمود فترة كأول عمود، يبنيه المُصرّف نفسه',
              'Ajoute une colonne de période en première position, construite par le compilateur',
              'Adds a period column first, built by the compiler itself')}
          </p>
        </div>

        <div>
          <GroupLabel>{t('الترتيب', 'Tri', 'Order by')}</GroupLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={orderBy ?? ''}
              onChange={(e) => onOrder(e.target.value === '' ? null : e.target.value, orderDesc)}
              className="input min-w-0 grow"
              aria-label={t('الترتيب', 'Tri', 'Order by')}
            >
              <option value="">
                {t('افتراضي — أول مقياس تنازليًا', 'Par défaut — première mesure, décroissant',
                  'Default — first measure, descending')}
              </option>
              {orderChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>{choice.label}</option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => onOrder(orderBy, !orderDesc)}
              aria-pressed={orderDesc}
              className="btn btn-sm shrink-0"
            >
              {orderDesc
                ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                : <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />}
              {orderDesc ? t('تنازلي', 'Décroissant', 'Descending') : t('تصاعدي', 'Croissant', 'Ascending')}
            </button>
          </div>
        </div>

        <div>
          <GroupLabel>{t('حد الصفوف', 'Plafond de lignes', 'Row limit')}</GroupLabel>
          <LimitInput value={limit} onChange={onLimit} />
          <p className="mt-1 px-1 text-[11px] text-[var(--text-muted)]">
            {t(`يُقصّ إلى ${fmtInt(BUILDER_LIMITS.min)}–${fmtInt(BUILDER_LIMITS.max)} في الخادم`,
              `Borné à ${fmtInt(BUILDER_LIMITS.min)}–${fmtInt(BUILDER_LIMITS.max)} côté serveur`,
              `Clamped to ${fmtInt(BUILDER_LIMITS.min)}–${fmtInt(BUILDER_LIMITS.max)} on the server`)}
          </p>
        </div>
      </div>
    </Panel>
  );
}

/**
 * The row cap, as a number input that lets a number be half-typed.
 *
 * Clamping on every keystroke would turn "500" into 5 at the first digit, so the text
 * being typed is local and the committed number is the prop. `seen` reconciles the two
 * when the value changes from outside -- picking a different dataset resets the whole
 * request, and an input still showing the old cap would be lying about what will run.
 */
function LimitInput({ value, onChange }: { value: number; onChange: (limit: number) => void }) {
  const { t } = useBiI18n();
  const [draft, setDraft] = useState({ text: String(value), seen: value });
  if (draft.seen !== value) setDraft({ text: String(value), seen: value });

  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setDraft({ text: String(value), seen: value });
      return;
    }
    const next = Math.min(BUILDER_LIMITS.max, Math.max(BUILDER_LIMITS.min, Math.trunc(n)));
    setDraft({ text: String(next), seen: next });
    onChange(next);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={BUILDER_LIMITS.min}
      max={BUILDER_LIMITS.max}
      value={draft.text}
      onChange={(e) => setDraft({ text: e.target.value, seen: value })}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); }}
      className="input tabular"
      dir="ltr"
      aria-label={t('حد الصفوف', 'Plafond de lignes', 'Row limit')}
    />
  );
}
