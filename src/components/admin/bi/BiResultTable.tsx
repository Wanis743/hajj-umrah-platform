/**
 * The result grid: the same compiled result the chart drew, as rows.
 *
 * A chart and a table over one result must never disagree, so both read the same
 * `columns` array and every cell prints through `formatCell` -- the column says how it
 * prints and this file never decides. What the grid adds is the two things a mark cannot
 * show: the exact value behind it, and the two kinds of drill a dimension can carry.
 *
 * Those two are different acts and are kept apart here. A cell whose column carries
 * `drill_to_key` regroups the query one level deeper, which is a new query and therefore
 * the builder's to run -- this file only reports the click. A cell whose column carries
 * `drill_through_kind` leaves the semantic layer: it asks the server for the record ids
 * behind that cell, and gets ids rather than rows, because the screens that open those
 * records are already authorized and returning whole rows here would be a second read
 * path around the one that guards them.
 */
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, Copy, CornerDownRight, ExternalLink, Loader2, X,
} from 'lucide-react';
import type {
  BiDrillThroughKind, BiDrillThroughSuccess, BiFilter, BiQuerySuccess, BiResultColumn,
  BiResultRow, BiScalar,
} from '@/types/bi';
import { biAnalytics } from '@/services/biAnalytics';
import { fmtInt, fmtMs, formatCell, useBiI18n, useBiLabels } from './biFormat';
import { InlineNote, Pill } from './atoms';

export interface BiResultTableProps {
  result: BiQuerySuccess;
  /** Required for drill-through only: the RPC re-resolves the dimension against the
   *  dataset it belongs to. Absent leaves the cells non-openable, which is how a
   *  read-only tile is expressed. */
  datasetId?: string | null;
  /** The filter state the result was produced under, forwarded to a drill-through so an
   *  opened cell means "this value, under everything else that was already in force". */
  filters?: readonly BiFilter[];
  /** A cell in a column carrying `drill_to_key` was opened. The next level's key comes
   *  with it, so the builder can regroup without re-reading the column. */
  onDrillDown?: (column: BiResultColumn, value: BiScalar, nextKey: string) => void;
  /** Rows printed before the grid stops and offers the rest. A compiled result may
   *  carry five thousand rows, and eight columns of those is forty thousand DOM nodes
   *  nobody asked to scroll. */
  maxRows?: number;
}

/** Which cell is open, by row rather than by value: the same dimension value can appear
 *  on two rows of a two-dimension result, and only the one that was clicked should open. */
interface OpenCell {
  rowIndex: number;
  alias: string;
  column: BiResultColumn;
  value: BiScalar;
}

/**
 * Two cells of one column, ordered.
 *
 * Numbers compare as numbers and everything else as text, because a text sort over
 * `'10' < '9'` is the classic way a grid reorders a result into nonsense. Nulls are
 * handled by the caller rather than here: they belong at the bottom in both directions,
 * since "not known" is not the smallest value, and a comparator multiplied by a direction
 * cannot express that.
 */
function compareScalar(a: BiScalar, b: BiScalar): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Per-column chrome, resolved once instead of per cell. A two-hundred-row grid asks its
 *  column the same six questions sixteen hundred times otherwise. */
interface ColumnChrome {
  col: BiResultColumn;
  label: string;
  metric: boolean;
  /** The next level down, when this column has one. */
  next: string | null;
  through: BiDrillThroughKind | null;
}

/**
 * The one open cell's answer.
 *
 * Kept out of the component because the interesting part is not the drawing: two clicks
 * can be in flight at once, and the second must win rather than whichever reply arrives
 * last. The sequence ticket does that, and the value the server echoes back is checked
 * against the cell that was clicked for the same reason.
 */
function useDrillThrough(datasetId: string | null | undefined, filters: readonly BiFilter[]) {
  const [open, setOpen] = useState<OpenCell | null>(null);
  const [hit, setHit] = useState<BiDrillThroughSuccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const close = useCallback(() => {
    seq.current += 1;
    setOpen(null);
    setHit(null);
    setError(null);
    setBusy(false);
  }, []);

  const openCell = useCallback(async (cell: OpenCell) => {
    if (!datasetId) return;
    const ticket = seq.current + 1;
    seq.current = ticket;
    setOpen(cell);
    setHit(null);
    setError(null);
    setBusy(true);
    const res = await biAnalytics.drillThrough({
      datasetId, dimensionKey: cell.column.key, value: cell.value, filters,
    });
    if (seq.current !== ticket) return;
    setBusy(false);
    if (res.data && res.data.value !== cell.value) return;
    setHit(res.data);
    setError(res.error);
  }, [datasetId, filters]);

  return { open, hit, busy, error, openCell, close };
}

export function BiResultTable({
  result, datasetId = null, filters = [], onDrillDown, maxRows = 200,
}: BiResultTableProps) {
  const { t, isAr } = useBiI18n();
  const [sort, setSort] = useState<{ alias: string; desc: boolean } | null>(null);
  const [cap, setCap] = useState(maxRows);
  const drill = useDrillThrough(datasetId, filters);

  const chrome: ColumnChrome[] = useMemo(() => result.columns.map((col) => ({
    col,
    label: (isAr && col.label_ar) ? col.label_ar : col.label,
    metric: col.kind === 'METRIC',
    next: col.drill_to_key ?? null,
    through: col.drill_through_kind ?? null,
  })), [result.columns, isAr]);

  // Sorting reorders the rows that came back; it does not re-run the query. That is why
  // the note below says so whenever the result was truncated -- re-sorting the first 500
  // of 4,000 rows produces a top that was never the top.
  const rows = useMemo(() => {
    const order = sort;
    if (!order) return result.rows;
    const dir = order.desc ? -1 : 1;
    return [...result.rows].sort((a, b) => {
      const av = a[order.alias] ?? null;
      const bv = b[order.alias] ?? null;
      // Nulls last in both directions: "not known" is not the smallest value.
      if (av === null || bv === null) return av === bv ? 0 : (av === null ? 1 : -1);
      return dir * compareScalar(av, bv);
    });
  }, [result.rows, sort]);

  const shown = rows.slice(0, cap);
  const toggleSort = (alias: string) => {
    drill.close();
    setSort((prev) => (prev && prev.alias === alias
      ? (prev.desc ? null : { alias, desc: true })
      : { alias, desc: false }));
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--border)] py-8 text-center text-[13px] text-[var(--text-muted)]">
        {t('لم يُرجع الاستعلام أي صفوف', 'La requête n’a renvoyé aucune ligne', 'The query returned no rows')}
      </p>
    );
  }

  const drillTitle = t('تفصيل إلى', 'Descendre vers', 'Drill down to');
  const openTitle = t('فتح السجلات', 'Ouvrir les enregistrements', 'Open records');

  return (
    <div className="space-y-2">
      <div className="max-h-[30rem] overflow-auto rounded-lg border border-[var(--border)]">
        <table className="table w-full min-w-max">
          <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)]">
            <tr>
              {chrome.map((c) => (
                <HeaderCell
                  key={c.col.alias}
                  c={c}
                  dir={sort?.alias === c.col.alias ? (sort.desc ? 'desc' : 'asc') : null}
                  onSort={() => toggleSort(c.col.alias)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <Fragment key={`row-${i}`}>
                <Row
                  chrome={chrome} row={row} index={i}
                  drillTitle={drillTitle} openTitle={openTitle}
                  onDrillDown={onDrillDown}
                  onOpen={datasetId ? (cell) => { void drill.openCell(cell); } : undefined}
                />
                {drill.open?.rowIndex === i && (
                  <DrillThroughRow
                    span={chrome.length} cell={drill.open} hit={drill.hit}
                    busy={drill.busy} error={drill.error} onClose={drill.close}
                  />
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--text-muted)]">
        <span>
          {shown.length < rows.length
            ? t(`${fmtInt(shown.length)} من ${fmtInt(rows.length)} صف`,
                `${fmtInt(shown.length)} sur ${fmtInt(rows.length)} lignes`,
                `${fmtInt(shown.length)} of ${fmtInt(rows.length)} rows`)
            : t(`${fmtInt(rows.length)} صف`,
                `${fmtInt(rows.length)} lignes`,
                `${fmtInt(rows.length)} rows`)}
          {' · '}
          <span className="tabular">{fmtMs(result.duration_ms)}</span>
        </span>
        {shown.length < rows.length && (
          <button
            type="button"
            onClick={() => setCap(rows.length)}
            className="font-medium text-[var(--accent)] underline underline-offset-2"
          >
            {t('اعرض كل الصفوف', 'Afficher toutes les lignes', 'Show all rows')}
          </button>
        )}
      </div>

      {result.truncated && (
        <InlineNote>
          {t(`بلغت النتيجة حدّ ${fmtInt(result.row_limit)} صف، وقد يكون هناك المزيد`,
            `Le résultat a atteint la limite de ${fmtInt(result.row_limit)} lignes ; il peut y en avoir d’autres`,
            `The result reached the ${fmtInt(result.row_limit)} row limit; there may be more`)}
        </InlineNote>
      )}
      {sort && result.truncated && (
        <InlineNote>
          {t('الترتيب هنا يعيد ترتيب الصفوف المُعادة فقط، لا الاستعلام نفسه',
            'Le tri réordonne les lignes renvoyées, pas la requête elle-même',
            'Sorting reorders the rows that came back, not the query itself')}
        </InlineNote>
      )}
    </div>
  );
}

const SORT_ARIA = { asc: 'ascending', desc: 'descending' } as const;

/**
 * One column heading, and the sort control.
 *
 * A metric heading carries how it folds in its title, because "Revenue" over a SUM and
 * "Revenue" over an AVG are different numbers and a heading that shows only the name
 * leaves the reader to guess which of the two they have.
 */
function HeaderCell({ c, dir, onSort }: {
  c: ColumnChrome;
  dir: 'asc' | 'desc' | null;
  onSort: () => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const agg = c.col.aggregate;
  const detail = agg ? `${c.col.key} · ${labels.aggregate[agg]}` : c.col.key;

  return (
    <th
      className={c.metric ? 'end whitespace-nowrap' : 'whitespace-nowrap'}
      title={detail}
      aria-sort={dir ? SORT_ARIA[dir] : 'none'}
    >
      <button
        type="button"
        onClick={onSort}
        aria-label={`${t('رتّب حسب', 'Trier par', 'Sort by')} ${c.label}`}
        className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
      >
        {c.label}
        {dir === 'asc' && <ArrowUp className="h-3 w-3" aria-hidden="true" />}
        {dir === 'desc' && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
      </button>
    </th>
  );
}

/** One row. The two drill affordances are decided here rather than inside the cell,
 *  because whether a drill exists is a property of the column and whether it can be
 *  taken is a property of this value: a null group has nothing to open. */
function Row({ chrome, row, index, drillTitle, openTitle, onDrillDown, onOpen }: {
  chrome: readonly ColumnChrome[];
  row: BiResultRow;
  index: number;
  drillTitle: string;
  openTitle: string;
  onDrillDown?: (column: BiResultColumn, value: BiScalar, nextKey: string) => void;
  onOpen?: (cell: OpenCell) => void;
}) {
  return (
    <tr className="hover:bg-[var(--bg-hover)]">
      {chrome.map((c) => {
        const value = row[c.col.alias] ?? null;
        const next = c.next;
        const open = onOpen;
        return (
          <Cell
            key={c.col.alias}
            c={c}
            value={value}
            drillTitle={next ? `${drillTitle} ${next}` : drillTitle}
            openTitle={openTitle}
            onDrillDown={onDrillDown && next && value !== null
              ? () => onDrillDown(c.col, value, next)
              : undefined}
            onOpen={open && c.through && value !== null
              ? () => open({ rowIndex: index, alias: c.col.alias, column: c.col, value })
              : undefined}
          />
        );
      })}
    </tr>
  );
}

/** One cell. Prints through the column that described it and nothing else -- a grid that
 *  reformats a value the chart printed differently is two answers to one question. */
function Cell({ c, value, drillTitle, openTitle, onDrillDown, onOpen }: {
  c: ColumnChrome;
  value: BiScalar;
  drillTitle: string;
  openTitle: string;
  onDrillDown?: () => void;
  onOpen?: () => void;
}) {
  const text = formatCell(value, c.col);
  return (
    <td className={c.metric ? 'end tabular whitespace-nowrap' : 'whitespace-nowrap'}>
      <span className={value === null ? 'text-[var(--text-muted)]' : ''}>{text}</span>
      {onDrillDown && (
        <button
          type="button"
          onClick={onDrillDown}
          title={drillTitle}
          aria-label={`${drillTitle}: ${text}`}
          className="ms-1.5 inline-flex align-middle text-[var(--text-muted)] hover:text-[var(--accent)]"
        >
          <CornerDownRight className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          title={openTitle}
          aria-label={`${openTitle}: ${text}`}
          className="ms-1 inline-flex align-middle text-[var(--text-muted)] hover:text-[var(--accent)]"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </td>
  );
}

/**
 * What one cell opened, under the row it was opened from.
 *
 * Ids, not records. The count is the finding -- "this bar is 41 bookings" -- and the ids
 * are what a reader carries to the screen that shows them, which is why they can be taken
 * in one go rather than read off the screen.
 */
function DrillThroughRow({ span, cell, hit, busy, error, onClose }: {
  span: number;
  cell: OpenCell;
  hit: BiDrillThroughSuccess | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const { t } = useBiI18n();
  const labels = useBiLabels();
  const [copied, setCopied] = useState(false);
  const kind = hit?.kind ?? cell.column.drill_through_kind ?? null;
  const ids = hit?.entity_ids ?? [];

  const copy = () => {
    void navigator.clipboard?.writeText(ids.join('\n')).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <tr>
      <td colSpan={span} className="bg-[var(--bg-subtle)] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {kind && <Pill tone="info">{labels.drillThrough[kind]}</Pill>}
          <span className="text-[12px] text-[var(--text-secondary)]">
            {formatCell(cell.value, cell.column)}
          </span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" aria-hidden="true" />}
          {hit && (
            <span className="text-[12px] tabular text-[var(--text-primary)]">
              {t(`${fmtInt(hit.entity_count)} سجل`,
                `${fmtInt(hit.entity_count)} enregistrements`,
                `${fmtInt(hit.entity_count)} records`)}
            </span>
          )}
          <span className="grow" />
          {ids.length > 0 && (
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              {copied
                ? <Check className="h-3 w-3 text-[var(--success)]" aria-hidden="true" />
                : <Copy className="h-3 w-3" aria-hidden="true" />}
              {t('انسخ المعرّفات', 'Copier les identifiants', 'Copy ids')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('إغلاق', 'Fermer', 'Close')}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {error && <InlineNote tone="bad">{error}</InlineNote>}
        <IdList ids={ids} truncated={hit?.truncated ?? false} settled={hit !== null && !busy} />
      </td>
    </tr>
  );
}

/** How many ids are printed before the rest are counted. The full list still copies. */
const ID_CHIPS = 40;

/**
 * The ids behind one cell.
 *
 * Each chip is the first segment, with the whole value in its title -- a uuid is eight
 * useful characters and thirty-two more that push the next one off the line. A truncated
 * answer says so, because two hundred ids under a bar of nine hundred is a sample, and a
 * sample read as the whole is the kind of number somebody acts on.
 */
function IdList({ ids, truncated, settled }: {
  ids: readonly string[];
  truncated: boolean;
  /** The answer arrived. Distinguishes "no records" from "not asked yet". */
  settled: boolean;
}) {
  const { t } = useBiI18n();

  if (ids.length === 0) {
    if (!settled) return null;
    return (
      <p className="text-[12px] text-[var(--text-muted)]">
        {t('لا سجلات خلف هذه الخلية', 'Aucun enregistrement derrière cette cellule', 'No records behind this cell')}
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-1" dir="ltr">
        {ids.slice(0, ID_CHIPS).map((id) => (
          <code
            key={id}
            title={id}
            className="rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
          >
            {id.slice(0, 8)}
          </code>
        ))}
        {ids.length > ID_CHIPS && (
          <span className="px-1 py-0.5 text-[10px] text-[var(--text-muted)]">
            {`+${fmtInt(ids.length - ID_CHIPS)}`}
          </span>
        )}
      </div>
      {truncated && (
        <InlineNote>
          {t('هذه عيّنة من السجلات، لا كلها',
            'Ceci est un échantillon, pas la totalité',
            'This is a sample of the records, not all of them')}
        </InlineNote>
      )}
    </>
  );
}
