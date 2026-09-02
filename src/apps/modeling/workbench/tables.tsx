/**
 * Modeling workbench — the four grids, and the control that names what gets certified.
 *
 * `panels.tsx` renders what a model *is*: its rail, its verdict, its status bar. This file renders
 * what a model *holds*, and every grid below is one array from `ModelDocument` shown beside the
 * numbers the engine derived from it. Neither half can be recovered from the other, so each table
 * takes both.
 *
 * The derived halves are all optional, deliberately. A model whose formulas do not parse still has
 * assumptions somebody typed, and a grid that renders nothing until the compile succeeds hides the
 * very rows a person needs in order to fix it. So `values`, `reach` and `depth` arrive as maps that
 * may be empty, and each column states what it does not know rather than the table refusing to draw.
 *
 * An override is set in the grid rather than in a dialog. `model.override.set` wants one number
 * against one assumption, and a modal that asks for a single figure — after a click that already
 * pointed at the cell holding it — is a dialog charging rent. The scenario column is therefore an
 * input, and scenario editing lives where the numbers being compared already are.
 *
 * `ResultsGrid` is a hand-written table rather than a `DataGrid`, the one place this file leaves
 * the kit. `DataGrid` shares horizontal space between its columns; a model may declare six hundred
 * periods, and six hundred shared columns is not a grid but a smear. A period axis needs a sticky
 * first column and its own horizontal scroll, which is what it gets.
 */
import { type CSSProperties, useMemo, useState } from 'react';
import { AlertTriangle, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  type AppLang,
  Badge,
  type Column,
  DataGrid,
  EmptyState,
  Field,
  fmt,
  IconButton,
  Input,
  Select,
  useLocale,
} from '@/platform/sdk';
import type { AssumptionUnit, EvalNote, ModelRun, Target, TargetKind } from '../engine';
import type { DocAssumption, DocRow, DocScenario } from './document';
import { EVAL_NOTE_LABEL, TARGET_KIND_LABEL, UNIT_LABEL, UNIT_SUFFIX } from './labels';

/* ------------------------------------------------------------------ *
 * Numbers, in the unit they were declared in
 * ------------------------------------------------------------------ */

/**
 * One number, formatted by what it measures.
 *
 * A rate stored as `0.12` is twelve per cent, and printing it as `0.12` in a column beside a
 * currency is how a reader mistakes a margin for a dinar. Counts and days round to whole numbers
 * because a fractional headcount is an error in the model, not a precision the grid should smooth.
 *
 * File-local. Every table that needs it is below, and exporting a plain function beside components
 * is what `react-refresh/only-export-components` refuses: Fast Refresh cannot tell whether a save
 * changed a component or a helper, so it discards the state of everything downstream.
 */
function inUnit(value: number, unit: AssumptionUnit, lang: AppLang): string {
  if (!Number.isFinite(value)) return '—';
  switch (unit) {
    case 'RATE':
      return fmt.percent(value, lang, 1);
    case 'COUNT':
    case 'DAYS':
      return fmt.integer(value, lang);
    default:
      return fmt.amount(value, lang);
  }
}

/**
 * The range as a person would say it, including the two half-open cases.
 *
 * A bound may be declared on one side only — "at least zero" is the commonest range in any model —
 * and rendering that as `0 – ∞` states a ceiling the author never claimed.
 */
function rangeText(
  low: number | null,
  high: number | null,
  unit: AssumptionUnit,
  lang: AppLang,
): string {
  if (low === null && high === null) return '—';
  if (high === null) return `≥ ${inUnit(low ?? 0, unit, lang)}`;
  if (low === null) return `≤ ${inUnit(high, unit, lang)}`;
  return `${inUnit(low, unit, lang)} – ${inUnit(high, unit, lang)}`;
}

/** Row actions sit in one line, right-aligned by the column's own `align`. */
const ACTIONS: CSSProperties = { display: 'flex', gap: 2, justifyContent: 'flex-end' };

/** A formula, clipped rather than wrapped: one line per row keeps the grid scannable. */
const CODE: CSSProperties = { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** What a cell looks like when it has nothing to report, as opposed to nothing to show. */
const MUTED: CSSProperties = { color: 'var(--fx-text-tertiary)' };

/**
 * The Arabic name when there is one and the reader is reading right to left, else the Latin one.
 *
 * Keyed on `rtl` rather than on `lang === 'ar'` because `dz` is also written right to left, and a
 * Darja reader handed the French label while the Arabic one sits unused in the row is a bug that
 * only ever shows up on somebody else's screen.
 */
function nameFor(rtl: boolean, arabic: string, latin: string): string {
  return rtl && arabic !== '' ? arabic : latin;
}

/* ------------------------------------------------------------------ *
 * The assumptions, and the one cell in this file that can be typed into
 * ------------------------------------------------------------------ */

/**
 * The scenario's value for one assumption, editable in place.
 *
 * The state is text rather than a number, which is not a shortcut. A controlled numeric input whose
 * state is a `number` cannot hold `"0."` — the parse drops the trailing dot and React writes the
 * value back — so the decimal point a person just typed vanishes under their cursor. Text state
 * with `fmt.parseAmount` on commit is the house answer, and it is also the only one that can tell
 * "not a number yet" from "zero".
 *
 * Commit is Enter or blur, and Escape puts back what was there. Nothing commits on every keystroke:
 * each override is a ledger command, and a five-digit figure typed into a live cell would be five
 * commands, four of them describing numbers nobody meant.
 */
function OverrideCell({
  value,
  base,
  unit,
  own,
  editable,
  onSet,
  onClear,
}: {
  readonly value: number;
  readonly base: number;
  readonly unit: AssumptionUnit;
  readonly own: boolean;
  readonly editable: boolean;
  readonly onSet: (next: number) => void;
  readonly onClear: () => void;
}) {
  const { lang, tr } = useLocale();
  const [text, setText] = useState<string | null>(null);

  if (!editable) {
    return <span className="fx-mono">{inUnit(value, unit, lang)}</span>;
  }

  const shown = text ?? String(value);
  const parsed = fmt.parseAmount(shown);
  const commit = () => {
    setText(null);
    if (parsed !== null && parsed !== value) onSet(parsed);
  };
  return (
    <span style={{ alignItems: 'center', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
      <Input
        value={shown}
        onChange={setText}
        onEnter={commit}
        onEscape={() => setText(null)}
        onBlur={commit}
        // An untouched cell is never marked invalid: `1e-7` is a number the model may hold and
        // `parseAmount` will not read, and a red border on a value nobody typed accuses the reader.
        invalid={text !== null && parsed === null}
        mono
        inputMode="decimal"
        style={{ textAlign: 'end', width: 96 }}
        title={own ? `${tr('الأصل', 'Base', 'Base')} ${inUnit(base, unit, lang)}` : undefined}
      />
      {own ? (
        <IconButton
          icon={RotateCcw}
          label={tr('إلغاء التعديل', 'Annuler l’ajustement', 'Clear the override')}
          onClick={onClear}
          size={28}
        />
      ) : null}
    </span>
  );
}

export interface AssumptionTableProps {
  readonly assumptions: readonly DocAssumption[];
  /**
   * What each assumption is worth under the scenario on screen.
   *
   * Empty when the model does not compile, in which case the base value is the only truth there is
   * and the scenario column says so rather than showing a stale figure from the last good run.
   */
  readonly values: ReadonlyMap<string, number>;
  /** Keys the active scenario overrides itself — the only ones it is able to clear. */
  readonly own: ReadonlySet<string>;
  /** Keys moved further up the inheritance chain, and the name of the scenario that moved them. */
  readonly inherited: ReadonlyMap<string, string>;
  /** Keys whose resolved value sits outside the range the assumption declares. */
  readonly outOfRange: ReadonlySet<string>;
  /**
   * How many rows each assumption reaches.
   *
   * Null when the model does not compile — which is a different statement from an assumption that
   * reaches nothing, and the column renders the two differently.
   */
  readonly reach: ReadonlyMap<string, number> | null;
  /** Only a draft can be edited. Published and archived models render the same grid, read-only. */
  readonly editable: boolean;
  readonly onEdit: (subject: DocAssumption) => void;
  readonly onDelete: (subject: DocAssumption) => void;
  readonly onOverride: (key: string, value: number) => void;
  readonly onClear: (key: string) => void;
  readonly loading: boolean;
}

/**
 * Six columns: what it is called, what it is worth, what it is allowed to be, and what it touches.
 *
 * `reach` is the column that earns its place. An assumption reaching no row is dead weight — it is
 * declared, it is maintained, it changes nothing, and `NO_DEAD_ASSUMPTIONS` is the check that will
 * refuse the certificate over it. Showing the count here means the reader sees the reason before
 * they see the verdict.
 */
export function AssumptionTable({
  assumptions,
  values,
  own,
  inherited,
  outOfRange,
  reach,
  editable,
  onEdit,
  onDelete,
  onOverride,
  onClear,
  loading,
}: AssumptionTableProps) {
  const { lang, rtl, t, tr } = useLocale();

  const columns: readonly Column<DocAssumption>[] = [
    {
      id: 'key',
      header: tr('المفتاح', 'Clé', 'Key'),
      width: 160,
      mono: true,
      render: (row) => row.key,
      sort: (a, b) => a.key.localeCompare(b.key),
    },
    {
      id: 'label',
      header: tr('الاسم', 'Libellé', 'Label'),
      render: (row) => (
        <span title={row.note === '' ? undefined : row.note}>{nameFor(rtl, row.labelAr, row.label)}</span>
      ),
      sort: (a, b) => a.label.localeCompare(b.label),
    },
    {
      id: 'unit',
      header: tr('الوحدة', 'Unité', 'Unit'),
      width: 104,
      render: (row) => <Badge>{t(UNIT_LABEL[row.unit])}</Badge>,
      sort: (a, b) => a.unit.localeCompare(b.unit),
    },
    {
      id: 'base',
      header: tr('القيمة الأصلية', 'Valeur de base', 'Base'),
      width: 132,
      align: 'end',
      mono: true,
      render: (row) => inUnit(row.value, row.unit, lang),
      sort: (a, b) => a.value - b.value,
    },
    {
      /**
       * The scenario's value, and the only writable cell in the workbench.
       *
       * When the model does not compile there is no resolution, so `values` is empty and this falls
       * back to the base — stated as a fallback by the absent override marks rather than dressed up
       * as a computed figure.
       */
      id: 'scenario',
      header: tr('في السيناريو', 'Dans le scénario', 'In scenario'),
      width: 160,
      align: 'end',
      render: (row) => {
        const by = inherited.get(row.key);
        return (
          <span style={{ alignItems: 'center', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {by === undefined ? null : (
              <Badge tone="info" title={tr('موروث', 'Hérité', 'Inherited')}>
                {by}
              </Badge>
            )}
            {outOfRange.has(row.key) ? (
              <span
                title={tr(
                  'القيمة خارج المجال المسموح',
                  'Valeur hors de la plage admise',
                  'Outside the range this assumption declares',
                )}
                style={{ display: 'inline-flex' }}
              >
                <AlertTriangle size={13} aria-hidden style={{ color: 'var(--fx-warning)' }} />
              </span>
            ) : null}
            <OverrideCell
              key={row.key}
              value={values.get(row.key) ?? row.value}
              base={row.value}
              unit={row.unit}
              own={own.has(row.key)}
              editable={editable}
              onSet={(next) => onOverride(row.key, next)}
              onClear={() => onClear(row.key)}
            />
          </span>
        );
      },
    },
    {
      id: 'range',
      header: tr('المجال المسموح', 'Plage admise', 'Allowed range'),
      width: 168,
      align: 'end',
      mono: true,
      render: (row) => rangeText(row.low, row.high, row.unit, lang),
    },
    {
      /**
       * How many rows the assumption reaches, and the one column that reads `null` as a sentence.
       *
       * An absent map means nobody has computed reach — the model does not compile — and a zero
       * means the assumption is declared, maintained and read by nothing. The first is the
       * reader's own problem to fix upstream; the second is what `NO_DEAD_ASSUMPTIONS` will
       * refuse the certificate over, so only the second gets the warning.
       */
      id: 'reach',
      header: tr('يؤثّر في', 'Touche', 'Reaches'),
      width: 132,
      align: 'end',
      render: (row) => {
        if (reach === null) return <span style={MUTED}>—</span>;
        const count = reach.get(row.key) ?? 0;
        if (count === 0) {
          return <Badge tone="warning">{tr('لا شيء', 'Rien', 'Nothing')}</Badge>;
        }
        return <span className="fx-mono">{fmt.integer(count, lang)}</span>;
      },
      sort:
        reach === null
          ? undefined
          : (a, b) => (reach.get(a.key) ?? 0) - (reach.get(b.key) ?? 0),
    },
    {
      /**
       * Edit and delete, and nothing at all on a published model.
       *
       * A disabled pair of buttons would have been the kinder-looking choice and the worse one:
       * the reason they cannot be used is the model's status, which the toolbar already states,
       * and two greyed icons per row restate it forty times without adding the word "published".
       */
      id: 'do',
      header: '',
      width: 88,
      align: 'end',
      render: (row) =>
        editable ? (
          <span style={ACTIONS}>
            <IconButton
              icon={Pencil}
              label={tr('تعديل', 'Modifier', 'Edit')}
              onClick={() => onEdit(row)}
              size={28}
            />
            <IconButton
              icon={Trash2}
              label={tr('حذف', 'Supprimer', 'Delete')}
              onClick={() => onDelete(row)}
              size={28}
              tone="danger"
            />
          </span>
        ) : null,
    },
  ];

  return (
    <DataGrid
      rows={assumptions}
      columns={columns}
      rowKey={(row) => row.key}
      loading={loading}
      initialSort={{ columnId: 'key', direction: 'asc' }}
      empty={
        <EmptyState
          compact
          title={tr('لا افتراضات', 'Aucune hypothèse', 'No assumptions')}
          description={tr(
            'الافتراض هو الرقم الذي يمكن للسيناريو أن يغيّره.',
            'Une hypothèse est le nombre qu’un scénario peut changer.',
            'An assumption is the number a scenario is able to change.',
          )}
        />
      }
    />
  );
}
/* ------------------------------------------------------------------ *
 * The rows, and what each one is made of
 * ------------------------------------------------------------------ */

export interface RowTableProps {
  readonly rows: readonly DocRow[];
  /**
   * How deep in the dependency graph each row sits, from `ModelGraph.depth`.
   *
   * Null when the model does not compile, which is when a reader most wants it and is exactly
   * when nobody can supply it: depth is a property of a graph, and a model with a cycle or an
   * unparseable formula has no graph.
   */
  readonly depth: ReadonlyMap<string, number> | null;
  /** Rows the run had to hold at a value, keyed by row key → the period it stopped moving. */
  readonly held: ReadonlyMap<string, number>;
  /** How many periods the model declares, so a `GIVEN` row can say how much of its series is typed. */
  readonly periods: number;
  readonly editable: boolean;
  readonly onEdit: (subject: DocRow) => void;
  readonly onDelete: (subject: DocRow) => void;
  readonly loading: boolean;
}

/**
 * Five columns, of which `definition` is the reason anybody opens this tab.
 *
 * A computed row shows its formula as written, monospaced and clipped to one line, with the whole
 * text in the title so a long one is still readable without the grid growing a second row height.
 * A typed row shows how much of its series actually exists — "8 of 12" is a row somebody will
 * have to finish, and it is invisible in every other view of the model.
 */
export function RowTable({
  rows,
  depth,
  held,
  periods,
  editable,
  onEdit,
  onDelete,
  loading,
}: RowTableProps) {
  const { lang, rtl, t, tr } = useLocale();

  const columns: readonly Column<DocRow>[] = [
    {
      id: 'key',
      header: tr('المفتاح', 'Clé', 'Key'),
      width: 160,
      mono: true,
      render: (row) => row.key,
      sort: (a, b) => a.key.localeCompare(b.key),
    },
    {
      /**
       * The name, and the one mark that belongs beside a name rather than beside a number.
       *
       * A held row is one the run could not carry forward — a `prior` that reached past the first
       * period, most often — so from some period onward its series is a repeated value rather than
       * a computed one. That is a fact about the row, not about any single cell, which is why the
       * warning sits here and the cells themselves are marked separately in `ResultsGrid`.
       */
      id: 'label',
      header: tr('الاسم', 'Libellé', 'Label'),
      render: (row) => {
        const from = held.get(row.key);
        return (
          <span style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
            <span title={row.note === '' ? undefined : row.note}>
              {nameFor(rtl, row.labelAr, row.label)}
            </span>
            {from === undefined ? null : (
              // The tooltip sits on a wrapper, not on the glyph: `title` is not an SVG attribute,
              // and an `aria-hidden` element's title would not be read out even if it were.
              <span
                title={tr(
                  // One-based, because the period is being read here rather than indexed.
                  `ثابت من الفترة ${from + 1}`,
                  `Figé à partir de la période ${from + 1}`,
                  `Held from period ${from + 1}`,
                )}
                style={{ display: 'inline-flex' }}
              >
                <AlertTriangle size={13} aria-hidden style={{ color: 'var(--fx-warning)' }} />
              </span>
            )}
          </span>
        );
      },
      sort: (a, b) => a.label.localeCompare(b.label),
    },
    {
      id: 'unit',
      header: tr('الوحدة', 'Unité', 'Unit'),
      width: 104,
      render: (row) => <Badge>{t(UNIT_LABEL[row.unit])}</Badge>,
      sort: (a, b) => a.unit.localeCompare(b.unit),
    },
    {
      /**
       * What the row *is*, in the two forms a row can take.
       *
       * A computed row shows the formula as the author wrote it — clipped to one line, with the
       * whole text in the title, because a grid that grows its row height around one long formula
       * makes every other row harder to scan. A typed row shows how much of its series exists:
       * "8 / 12" is a row somebody still has to finish, and there is no other view in the app
       * where that shortfall is visible at all.
       */
      id: 'definition',
      header: tr('التعريف', 'Définition', 'Definition'),
      render: (row) =>
        row.formula === null ? (
          <span style={row.given.length < periods ? { color: 'var(--fx-warning)' } : MUTED}>
            {tr(
              `${fmt.integer(row.given.length, lang)} / ${fmt.integer(periods, lang)} مُدخلة`,
              `${fmt.integer(row.given.length, lang)} / ${fmt.integer(periods, lang)} saisies`,
              `${fmt.integer(row.given.length, lang)} / ${fmt.integer(periods, lang)} typed in`,
            )}
          </span>
        ) : (
          // `dir="ltr"` because a formula is code: in a right-to-left column the browser would
          // reorder `a - b * c` around its operators and show the reader an expression nobody wrote.
          <span className="fx-mono" style={CODE} title={row.formula} dir="ltr">
            {row.formula}
          </span>
        ),
      sort: (a, b) => (a.formula ?? '').localeCompare(b.formula ?? ''),
    },
    {
      /**
       * How far the row sits from the assumptions, and the number the certificate has an opinion on.
       *
       * `MAX_DEPTH` refuses a certificate over a chain longer than twelve, so a reader who can see
       * the depth per row can find the offending chain without recompiling anything. A typed row
       * has depth zero by definition and says so as a dash rather than a nought — nought is a
       * measurement, and this is the absence of one.
       */
      id: 'depth',
      header: tr('العمق', 'Profondeur', 'Depth'),
      width: 112,
      align: 'end',
      render: (row) => {
        if (depth === null) return <span style={MUTED}>—</span>;
        const level = depth.get(row.key);
        if (level === undefined) return <span style={MUTED}>—</span>;
        return <span className="fx-mono">{fmt.integer(level, lang)}</span>;
      },
      sort:
        depth === null ? undefined : (a, b) => (depth.get(a.key) ?? 0) - (depth.get(b.key) ?? 0),
    },
    {
      id: 'do',
      header: '',
      width: 88,
      align: 'end',
      render: (row) =>
        editable ? (
          <span style={ACTIONS}>
            <IconButton
              icon={Pencil}
              label={tr('تعديل', 'Modifier', 'Edit')}
              onClick={() => onEdit(row)}
              size={28}
            />
            <IconButton
              icon={Trash2}
              label={tr('حذف', 'Supprimer', 'Delete')}
              onClick={() => onDelete(row)}
              size={28}
              tone="danger"
            />
          </span>
        ) : null,
    },
  ];

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      loading={loading}
      initialSort={{ columnId: 'key', direction: 'asc' }}
      rowTone={(row) => (held.has(row.key) ? 'warning' : undefined)}
      empty={
        <EmptyState
          compact
          title={tr('لا سطور', 'Aucune ligne', 'No rows')}
          description={tr(
            'السطر إمّا صيغة تُحسب أو سلسلة تُكتب.',
            'Une ligne est soit une formule calculée, soit une série saisie.',
            'A row is either a formula that gets computed or a series that gets typed in.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The scenarios, and what each one moves
 * ------------------------------------------------------------------ */

export interface ScenarioTableProps {
  readonly scenarios: readonly DocScenario[];
  /** Which scenario the workbench is currently resolving against. */
  readonly activeId: string;
  readonly onActivate: (id: string) => void;
  readonly editable: boolean;
  readonly onEdit: (subject: DocScenario) => void;
  readonly onDelete: (subject: DocScenario) => void;
  readonly loading: boolean;
}

/**
 * Four columns and a click that changes what every other grid in the workbench is showing.
 *
 * Selection is controlled here rather than left to the grid, because the scenario a person picks
 * is not a UI preference — it is the input to `runCompiled`, and the numbers in the results grid,
 * the override marks in the assumptions grid and the verdict on the certificate all move with it.
 * A single click activates, rather than the double-click `onActivate` would want: switching
 * scenario is what this grid is *for*, and making the primary act the secondary gesture would be
 * a puzzle rather than a table.
 *
 * The base column shows the parent's *name*, not its key. A key is what the author typed and a
 * name is what the reader recognises, and inheritance is read far more often than it is edited.
 */
export function ScenarioTable({
  scenarios,
  activeId,
  onActivate,
  editable,
  onEdit,
  onDelete,
  loading,
}: ScenarioTableProps) {
  const { lang, rtl, tr } = useLocale();

  const nameOf = new Map(scenarios.map((row) => [row.id, nameFor(rtl, row.nameAr, row.name)]));

  const columns: readonly Column<DocScenario>[] = [
    {
      id: 'name',
      header: tr('السيناريو', 'Scénario', 'Scenario'),
      render: (row) => (
        <span
          style={{ fontWeight: row.id === activeId ? 600 : 400 }}
          title={row.note === '' ? undefined : row.note}
        >
          {nameFor(rtl, row.nameAr, row.name)}
        </span>
      ),
      sort: (a, b) => a.name.localeCompare(b.name),
    },
    {
      id: 'key',
      header: tr('المفتاح', 'Clé', 'Key'),
      width: 160,
      mono: true,
      render: (row) => row.id,
      sort: (a, b) => a.id.localeCompare(b.id),
    },
    {
      /**
       * The parent, by name, or a word for the root.
       *
       * A scenario naming a parent that is not in the list is not drawn as a dash: the resolution
       * would silently treat it as a root, and a dash here would agree with that silence. It shows
       * the key it asked for instead, so a broken chain looks broken.
       */
      id: 'base',
      header: tr('يرث من', 'Hérite de', 'Inherits from'),
      width: 200,
      render: (row) => {
        if (row.baseId === null) return <span style={MUTED}>{tr('الأساس', 'Racine', 'Root')}</span>;
        const parent = nameOf.get(row.baseId);
        if (parent === undefined) {
          return (
            <Badge tone="danger" title={tr('سيناريو غير موجود', 'Scénario introuvable', 'No such scenario')}>
              {row.baseId}
            </Badge>
          );
        }
        return <Badge tone="info">{parent}</Badge>;
      },
      sort: (a, b) => (a.baseId ?? '').localeCompare(b.baseId ?? ''),
    },
    {
      id: 'overrides',
      header: tr('التعديلات', 'Ajustements', 'Overrides'),
      width: 128,
      align: 'end',
      render: (row) =>
        row.overrides.size === 0 ? (
          <span style={MUTED}>—</span>
        ) : (
          <span className="fx-mono">{fmt.integer(row.overrides.size, lang)}</span>
        ),
      sort: (a, b) => a.overrides.size - b.overrides.size,
    },
    {
      /**
       * Edit and delete, and one row that cannot be deleted at all.
       *
       * The scenario being resolved right now is the one every other grid is reading from. Deleting
       * it would leave the workbench resolving against a key that no longer exists, so the button
       * is absent rather than disabled — there is nothing to explain, the reader just switches
       * scenario first and the button comes back.
       */
      id: 'do',
      header: '',
      width: 88,
      align: 'end',
      render: (row) =>
        editable ? (
          <span style={ACTIONS}>
            <IconButton
              icon={Pencil}
              label={tr('تعديل', 'Modifier', 'Edit')}
              onClick={() => onEdit(row)}
              size={28}
            />
            {row.id === activeId ? null : (
              <IconButton
                icon={Trash2}
                label={tr('حذف', 'Supprimer', 'Delete')}
                onClick={() => onDelete(row)}
                size={28}
                tone="danger"
              />
            )}
          </span>
        ) : null,
    },
  ];

  return (
    <DataGrid
      rows={scenarios}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      selectedKeys={new Set([activeId])}
      onSelectionChange={(keys) => {
        // The grid hands back the whole selection; this table only ever wants one, and a click
        // that cleared it would leave nothing to resolve against — so an empty set is ignored.
        for (const key of keys) {
          if (key !== activeId) onActivate(key);
        }
      }}
      empty={
        <EmptyState
          compact
          title={tr('لا سيناريوهات', 'Aucun scénario', 'No scenarios')}
          description={tr(
            'السيناريو مجموعة تعديلات على الافتراضات، ويمكن أن يرث من غيره.',
            'Un scénario est un jeu d’ajustements d’hypothèses, et peut hériter d’un autre.',
            'A scenario is a set of overrides on the assumptions, and may inherit from another.',
          )}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ *
 * The results, on a period axis that may be six hundred wide
 * ------------------------------------------------------------------ */

/** The two facts every line in the results grid needs, whichever array it came from. */
interface Line {
  readonly key: string;
  readonly name: string;
  readonly unit: AssumptionUnit;
}

/** A cell's coordinates, flattened to one string so one map serves the whole grid. */
const at = (key: string, period: number): string => `${key} ${period}`;

/** Column and cell geometry. A period column is fixed, never shared: see the file header. */
const HEAD_WIDTH = 240;
const CELL_WIDTH = 116;

const SHELL: CSSProperties = {
  overflow: 'auto',
  flex: 1,
  minHeight: 0,
  border: '1px solid var(--fx-divider)',
  borderRadius: 8,
};

const TABLE: CSSProperties = { borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 };

/**
 * The row-head column, pinned to the reading edge.
 *
 * The background is `--fx-solid-alt` — the opaque token, the one `sheets/grid.tsx` pins its own
 * heads with — and not one of the translucent `--fx-layer` pair. A sticky element paints over the
 * content sliding beneath it, so a translucent background would show six hundred period columns
 * scrolling through the row labels.
 */
const STICKY: CSSProperties = {
  position: 'sticky',
  insetInlineStart: 0,
  zIndex: 2,
  width: HEAD_WIDTH,
  minWidth: HEAD_WIDTH,
  maxWidth: HEAD_WIDTH,
  background: 'var(--fx-solid-alt)',
  borderInlineEnd: '1px solid var(--fx-stroke-strong)',
  textAlign: 'start',
  padding: '5px 10px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
/** A period column: a fixed width, so six hundred of them scroll rather than shrink. */
const CELL: CSSProperties = {
  width: CELL_WIDTH,
  minWidth: CELL_WIDTH,
  maxWidth: CELL_WIDTH,
  padding: '5px 10px',
  textAlign: 'end',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--fx-divider)',
};

/** The period names, pinned to the top edge. */
const HEAD: CSSProperties = {
  ...CELL,
  position: 'sticky',
  top: 0,
  zIndex: 3,
  background: 'var(--fx-solid-alt)',
  color: 'var(--fx-text-secondary)',
  fontWeight: 500,
  borderBottom: '1px solid var(--fx-stroke-strong)',
};

/** Where the two sticky axes cross — the one cell that is pinned twice, so it sits above both. */
const CORNER: CSSProperties = {
  ...STICKY,
  top: 0,
  zIndex: 4,
  color: 'var(--fx-text-secondary)',
  fontWeight: 500,
  borderBottom: '1px solid var(--fx-stroke-strong)',
};

/** What "the certificate will be measured here" looks like. */
const MARKED: CSSProperties = {
  background: 'color-mix(in srgb, var(--fx-accent) 16%, transparent)',
  color: 'var(--fx-accent-text)',
  fontWeight: 600,
};

/** The band that separates the rows from the assumptions, since `run.series` holds them flat. */
const BAND: CSSProperties = {
  textAlign: 'start',
  padding: '11px 10px 4px',
  borderTop: '1px solid var(--fx-stroke-strong)',
  borderBottom: '1px solid var(--fx-divider)',
  color: 'var(--fx-text-secondary)',
  fontSize: 11,
  fontWeight: 600,
};

/** …and its text, pinned inside a cell that spans the whole axis: the word survives a scroll. */
const BAND_TEXT: CSSProperties = { position: 'sticky', insetInlineStart: 10 };
interface ResultRowProps {
  readonly line: Line;
  /** One value per period. Always the full horizon: the engine holds a short given row forward. */
  readonly series: readonly number[];
  readonly notes: ReadonlyMap<string, EvalNote>;
  /** The period a given row ran out of stated values, or null when it never did. */
  readonly from: number | null;
  /** The cell to mark: `AT` names its own period, `FINAL` the last, `TOTAL` none — see `whole`. */
  readonly mark: number | null;
  /** True when the target is the sum of this line, which is a claim about every cell in it. */
  readonly whole: boolean;
  /** True when a cell on this line may be named as the target. See `Block.pickable`. */
  readonly pickable: boolean;
  readonly onPick: (period: number) => void;
}

/**
 * One line of results, as a `<tr>` of plain cells rather than a component per cell.
 *
 * Six hundred periods against forty lines is twenty-four thousand cells, and twenty-four
 * thousand components — each with a props object and a place in the reconciler — is a cost paid
 * again on every keystroke in the editors above. So the cells are `<td>`s built in one map, and
 * the locale is read once per line instead of once per cell.
 */
function ResultRow({ line, series, notes, from, mark, whole, pickable, onPick }: ResultRowProps) {
  const { lang, t, tr } = useLocale();
  return (
    <tr>
      <th scope="row" style={STICKY} title={line.key}>
        {line.name}
        <span style={{ ...MUTED, fontWeight: 400, marginInlineStart: 6 }}>{t(UNIT_SUFFIX[line.unit])}</span>
      </th>
      {series.map((value, period) => {
        const note = notes.get(at(line.key, period));
        const repeated = from !== null && period >= from;
        const marked = whole || period === mark;
        // A note names what the evaluator ran into; a repeat is the axis outliving the row.
        // Both are things the number alone cannot say, and neither is an error — the run
        // finished and this cell holds a figure either way.
        let why: string | undefined;
        if (note !== undefined) why = `${t(EVAL_NOTE_LABEL[note.code])} — ${note.where}`;
        else if (repeated) {
          why = tr(
            'قيمة مُعادة: هذا السطر توقّف عن التصريح قبل هذه الفترة.',
            'Valeur répétée : cette ligne s’arrête avant cette période.',
            'A repeat: this row stopped stating values before this period.',
          );
        }
        return (
          <td
            key={period}
            onClick={pickable ? () => onPick(period) : undefined}
            title={why}
            aria-current={marked ? true : undefined}
            style={{
              ...CELL,
              cursor: pickable ? 'pointer' : 'default',
              ...(repeated ? MUTED : {}),
              ...(marked ? MARKED : {}),
              ...(note === undefined ? {} : { color: 'var(--fx-warning)' }),
            }}
          >
            {inUnit(value, line.unit, lang)}
          </td>
        );
      })}
    </tr>
  );
}
/**
 * Which cell of `key` the target names, if any.
 *
 * `TOTAL` names no single cell — it is the sum of the line — so it comes back as `whole` rather
 * than as a period, and the row marks every cell instead of lying about one of them.
 */
function marksOf(
  target: Target | null,
  key: string,
  last: number,
): { readonly mark: number | null; readonly whole: boolean } {
  if (target === null || target.key !== key) return { mark: null, whole: false };
  if (target.kind === 'TOTAL') return { mark: null, whole: true };
  return { mark: target.kind === 'FINAL' ? last : target.period, whole: false };
}

/** One block of lines under one heading. `id` keys it, so a translated title never has to. */
interface Block {
  readonly id: string;
  readonly title: string;
  readonly lines: readonly Line[];
  /**
   * Whether a cell here can become the certificate's target.
   *
   * False for the assumptions. A target is the number the model is going to be quoted on, and
   * sensitivity measures how it moves when an assumption moves — so an assumption as its own
   * target answers 1 by construction and every other assumption answers 0. That is not a
   * measurement, and a grid that let somebody ask for it would be offering a certificate whose
   * only honest grade is meaningless.
   */
  readonly pickable: boolean;
}

export interface ResultsGridProps {
  readonly run: ModelRun;
  readonly rows: readonly DocRow[];
  readonly assumptions: readonly DocAssumption[];
  /** The cell the certificate will be measured at, so the grid can show which one it is. */
  readonly target: Target | null;
  /** A click on a cell names it as the target. */
  readonly onPick: (key: string, period: number) => void;
}
/**
 * Every line the run produced, on one scrolling period axis.
 *
 * Expects a flex column for a parent: the shell takes `flex: 1` and owns the scrolling, so the
 * grid never grows the window — it grows its own scrollbars.
 *
 * Clicking a cell names it as the certificate's target, which is a mouse accelerator rather than
 * the way in: twenty-four thousand tabbable cells would be a keyboard trap, so the cells are not
 * focusable and `TargetPicker` states the same three facts in three selects that are.
 */
export function ResultsGrid({ run, rows, assumptions, target, onPick }: ResultsGridProps) {
  const { rtl, tr } = useLocale();
  const last = run.periods.length - 1;

  /**
   * Two lookups built once, rather than a scan of `run.notes` per cell.
   *
   * Six hundred periods against forty lines asks twenty-four thousand questions, and a linear
   * find would answer each of them by walking the whole array.
   */
  const notes = useMemo(() => {
    const out = new Map<string, EvalNote>();
    for (const note of run.notes) out.set(at(note.key, note.period), note.note);
    return out;
  }, [run.notes]);

  const held = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of run.held) out.set(row.key, row.from);
    return out;
  }, [run.held]);

  /**
   * Rows first, then assumptions.
   *
   * `run.series` holds both flat and in no particular order, so the order and the grouping have
   * to come from the document. The two blocks are what tell a reader that the axis below the
   * band means something else: a row is derived, an assumption is an input somebody chose.
   */
  const blocks = useMemo<readonly Block[]>(
    () => [
      {
        id: 'rows',
        title: tr('السطور', 'Lignes', 'Rows'),
        pickable: true,
        lines: rows.map((row) => ({ key: row.key, name: nameFor(rtl, row.labelAr, row.label), unit: row.unit })),
      },
      {
        id: 'assumptions',
        title: tr('الافتراضات', 'Hypothèses', 'Assumptions'),
        pickable: false,
        lines: assumptions.map((row) => ({ key: row.key, name: nameFor(rtl, row.labelAr, row.label), unit: row.unit })),
      },
    ],
    [assumptions, rows, rtl, tr],
  );
  return (
    <div style={SHELL}>
      <table style={TABLE}>
        <thead>
          <tr>
            <th scope="col" style={CORNER}>
              {tr('السطر', 'Ligne', 'Line')}
            </th>
            {run.periods.map((name, index) => (
              <th key={index} scope="col" style={HEAD} title={name}>
                {/*
                  `dir="ltr"` on the text and not on the cell. A period name is usually digits
                  around punctuation — `2026-01` — which a right-to-left paragraph reorders into
                  `01-2026`; putting the attribute on the `<th>` would fix that and flip the
                  column's own logical alignment away from its cells at the same time.
                */}
                <span dir="ltr">{name}</span>
              </th>
            ))}
          </tr>
        </thead>
        {blocks.map((block) =>
          block.lines.length === 0 ? null : (
            <tbody key={block.id}>
              <tr>
                <th scope="colgroup" colSpan={run.periods.length + 1} style={BAND}>
                  <span style={BAND_TEXT}>{block.title}</span>
                </th>
              </tr>
              {block.lines.map((line) => {
                const series = run.series.get(line.key);
                // A line with no series is not a result. The compile refuses a model before it
                // can run, so this cannot happen for a document that got this far — it is the
                // map's return type being honest, and the failure panel does the explaining.
                if (series === undefined) return null;
                const { mark, whole } = marksOf(target, line.key, last);
                return (
                  <ResultRow
                    key={line.key}
                    line={line}
                    series={series}
                    notes={notes}
                    from={held.get(line.key) ?? null}
                    mark={mark}
                    whole={whole}
                    pickable={block.pickable}
                    onPick={(period) => onPick(line.key, period)}
                  />
                );
              })}
            </tbody>
          ),
        )}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * What the certificate is about
 * ------------------------------------------------------------------ */

/**
 * Narrows a `<select>` value back to the union it came from.
 *
 * `TARGET_KIND_LABEL` is total over `TargetKind`, so the options and this guard are both derived
 * from the same record: a fourth kind added to the ABI appears in the dropdown and passes this
 * test on the same commit, with nothing here to remember to update.
 */
const isKind = (value: string): value is TargetKind => value in TARGET_KIND_LABEL;

export interface TargetPickerProps {
  /** Rows only. An assumption cannot be a target — see `Block.pickable`. */
  readonly rows: readonly DocRow[];
  readonly periods: readonly string[];
  /** Null until somebody chooses; a certificate cannot be recorded without one. */
  readonly target: Target | null;
  readonly onChange: (next: Target) => void;
  readonly disabled?: boolean;
}

/** A field wide enough for a row name, beside two narrower ones. */
const PICK: CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' };
/**
 * The three facts a target is made of, in three keyboard-reachable selects.
 *
 * This is the accessible route to what a click in `ResultsGrid` does with the mouse, and the only
 * route to the two targets that are not a single cell: `TOTAL` is the sum of a line and `FINAL`
 * follows the horizon, so neither has a cell of its own to click on.
 *
 * Every change emits a whole `Target` rather than a patch. When nothing is chosen yet the selects
 * already display the first row, period one — so emitting that triple is not a guess, it is the
 * state the reader is looking at.
 */
export function TargetPicker({ rows, periods, target, onChange, disabled }: TargetPickerProps) {
  const { rtl, t, tr } = useLocale();

  const rowOptions = useMemo(
    () => rows.map((row) => ({ value: row.key, label: nameFor(rtl, row.labelAr, row.label) })),
    [rows, rtl],
  );
  const kindOptions = useMemo(
    () => Object.entries(TARGET_KIND_LABEL).map(([kind, label]) => ({ value: kind, label: t(label) })),
    [t],
  );
  // One-based, because these are read rather than indexed — the same choice `RowTable` makes
  // when it says which period a given row was held from.
  const periodOptions = useMemo(
    () => periods.map((name, index) => ({ value: String(index), label: `${index + 1} · ${name}` })),
    [periods],
  );

  const current: Target = target ?? { key: rows.length === 0 ? '' : rows[0].key, kind: 'AT', period: 0 };
  const off = disabled === true || rows.length === 0;

  return (
    <div style={PICK}>
      <div style={{ flex: '2 1 200px' }}>
        <Field label={tr('السطر', 'La ligne', 'The row')}>
          <Select
            value={current.key}
            options={rowOptions}
            disabled={off}
            placeholder={tr('اختر سطرًا', 'Choisir une ligne', 'Pick a row')}
            onChange={(key) => onChange({ ...current, key })}
          />
        </Field>
      </div>
      <div style={{ flex: '1 1 150px' }}>
        <Field label={tr('كيف يُقرأ', 'Lecture', 'Read as')}>
          <Select
            value={current.kind}
            options={kindOptions}
            disabled={off}
            onChange={(kind) => {
              if (isKind(kind)) onChange({ ...current, kind });
            }}
          />
        </Field>
      </div>
      <div style={{ flex: '1 1 150px' }}>
        <Field
          label={tr('الفترة', 'La période', 'Period')}
          hint={
            current.kind === 'AT'
              ? undefined
              : tr('لا تُستعمل مع هذه القراءة.', 'Sans effet sur cette lecture.', 'Not used by this reading.')
          }
        >
          <Select
            value={String(current.period)}
            options={periodOptions}
            // The engine ignores `period` for `TOTAL` and `FINAL`. Leaving the select live would
            // let somebody change a number that changes nothing and watch the grid not move.
            disabled={off || current.kind !== 'AT'}
            onChange={(index) => {
              const period = Number(index);
              if (Number.isInteger(period)) onChange({ ...current, period });
            }}
          />
        </Field>
      </div>
    </div>
  );
}
