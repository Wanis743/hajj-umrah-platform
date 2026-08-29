/**
 * Sheets — the grid.
 *
 * Three things here are worth explaining.
 *
 *   • Rows are windowed. A workbook with a number in `B4000` has a four-thousand-row
 *     extent, and drawing all of it is fifty thousand elements to show the four hundred
 *     a person can see; only the band around the scroll offset exists, and the rows
 *     above and below it are paid for in padding. Columns are not windowed — there are
 *     at most 256 of them and a sheet that wide is not one anybody reads across.
 *   • A column resize is local until the pointer is released. Writing the width on every
 *     pointer move would be correct and would also put a hundred steps on the undo
 *     stack for one drag.
 *   • The cells the cursor's formula reads are outlined edge by edge in the colour the
 *     formula bar gives them. In an RTL sheet column A is on the right, so the "start"
 *     edge of a range is drawn on whichever side that turns out to be.
 */
import { type AppLang, colorAt, useApp } from '@/platform/sdk';
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { references } from './engine';
import { display, naturalAlign } from './formats';
import { type Calculated, DEFAULT_WIDTH, MIN_WIDTH, ROW_HEIGHT, cellOf, widthOf } from './model';
import { type CellRange, type CellRef, contains, indexToCol, keyOf, normalize, sameRef } from './refs';
import { type SheetsApi, hotkey } from './workbook';

/** The column header band, and the row header gutter. */
const HEAD = 26;
const GUTTER = 48;
/** Rows drawn beyond the viewport, so a wheel flick does not show a blank band. */
const OVERSCAN = 4;

const series = (count: number): readonly number[] => Array.from({ length: count }, (_value, index) => index);

interface Marked {
  readonly range: CellRange;
  readonly color: string;
}

/**
 * The ranges the cursor's formula reads, coloured in the order it names them.
 *
 * Only references to this sheet are drawn: `=Sheet2!A1` has nothing to outline here, and
 * outlining *this* sheet's `A1` because another sheet's cell shares the name is how a
 * person learns to distrust the outlines entirely.
 */
function marksOf(calc: Calculated, index: number, key: string, sheetName: string): readonly Marked[] {
  const tree = calc.formulaAt(index, key);
  if (tree === null) return [];
  const here = sheetName.toLowerCase();
  return references(tree)
    .filter((found) => found.sheet === null || found.sheet.toLowerCase() === here)
    .map((found, at) => ({ range: normalize(found), color: colorAt(at) }));
}

/** The frame a referenced cell wears, one inset shadow per edge it sits on. */
function ringOf(at: CellRef, marks: readonly Marked[], rtl: boolean): string {
  const inline = rtl ? -1 : 1;
  const edges: string[] = [];
  for (const mark of marks) {
    if (!contains(mark.range, at)) continue;
    if (at.row === mark.range.start.row) edges.push(`inset 0 1px 0 0 ${mark.color}`);
    if (at.row === mark.range.end.row) edges.push(`inset 0 -1px 0 0 ${mark.color}`);
    if (at.col === mark.range.start.col) edges.push(`inset ${inline}px 0 0 0 ${mark.color}`);
    if (at.col === mark.range.end.col) edges.push(`inset ${-inline}px 0 0 0 ${mark.color}`);
  }
  return edges.join(', ');
}

const headStyle = (selected: boolean): CSSProperties => ({
  position: 'relative',
  flex: 'none',
  height: HEAD,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--fx-caption)',
  fontWeight: selected ? 600 : 400,
  color: selected ? 'var(--fx-accent-text)' : 'var(--fx-text-secondary)',
  background: selected ? 'color-mix(in srgb, var(--fx-accent) 20%, var(--fx-solid-alt))' : 'var(--fx-solid-alt)',
  borderInlineEnd: '1px solid var(--fx-divider)',
  borderBottom: '1px solid var(--fx-stroke-strong)',
  userSelect: 'none',
  cursor: 'default',
});

interface HeadsProps {
  readonly cols: readonly number[];
  readonly widthAt: (col: number) => number;
  readonly range: CellRange;
  readonly rtl: boolean;
  readonly onColumn: (col: number, extend: boolean) => void;
  readonly onAll: () => void;
  readonly onDrag: (col: number, width: number) => void;
  readonly onDrop: (col: number, width: number) => void;
}

/** The letters, with a 6px grip on every border. */
function ColumnHeads({ cols, widthAt, range, rtl, onColumn, onAll, onDrag, onDrop }: HeadsProps) {
  const from = useRef<{ readonly col: number; readonly x: number; readonly width: number } | null>(null);

  const widthFrom = (event: PointerEvent<HTMLElement>): number | null => {
    const start = from.current;
    if (start === null) return null;
    return Math.max(MIN_WIDTH, Math.round(start.width + (event.clientX - start.x) * (rtl ? -1 : 1)));
  };

  return (
    <div role="row" style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 3 }}>
      <button
        type="button"
        onClick={onAll}
        title="A1"
        style={{ ...headStyle(false), width: GUTTER, position: 'sticky', insetInlineStart: 0, zIndex: 4, border: 'none' }}
      />
      {cols.map((col) => (
        <div
          key={col}
          role="columnheader"
          aria-colindex={col + 1}
          style={{ ...headStyle(col >= range.start.col && col <= range.end.col), width: widthAt(col) }}
        >
          <span onPointerDown={(event) => onColumn(col, event.shiftKey)} style={{ flex: 1, textAlign: 'center' }}>
            {indexToCol(col)}
          </span>
          <span
            role="presentation"
            onPointerDown={(event) => {
              from.current = { col, x: event.clientX, width: widthAt(col) };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const next = widthFrom(event);
              if (next !== null && from.current !== null) onDrag(from.current.col, next);
            }}
            onPointerUp={(event) => {
              const next = widthFrom(event);
              if (next !== null && from.current !== null) onDrop(from.current.col, next);
              from.current = null;
            }}
            onDoubleClick={() => onDrop(col, DEFAULT_WIDTH)}
            style={{ position: 'absolute', insetInlineEnd: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }}
          />
        </div>
      ))}
    </div>
  );
}

/** The numbers. Clicking one takes the whole row, as it does everywhere else. */
function RowHead({ row, selected, onPick }: { readonly row: number; readonly selected: boolean; readonly onPick: (extend: boolean) => void }) {
  return (
    <div
      role="rowheader"
      onPointerDown={(event) => onPick(event.shiftKey)}
      style={{
        ...headStyle(selected),
        width: GUTTER,
        height: ROW_HEIGHT,
        position: 'sticky',
        insetInlineStart: 0,
        zIndex: 2,
        borderBottom: '1px solid var(--fx-divider)',
        borderInlineEnd: '1px solid var(--fx-stroke-strong)',
      }}
    >
      {row + 1}
    </div>
  );
}

/**
 * The in-cell editor.
 *
 * The caret starts at the end rather than selecting the text, because the editor is
 * opened both by F2 (where the text is the cell's own and should be kept) and by typing
 * (where the text is the character just typed and must not be replaced by the next one).
 */
function CellEditor({ api }: { readonly api: SheetsApi }) {
  const box = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  return (
    <input
      ref={box}
      value={api.editing ?? ''}
      onChange={(event) => api.change(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') api.commit(0, event.shiftKey ? -1 : 1);
        else if (event.key === 'Tab') api.commit(event.shiftKey ? -1 : 1, 0);
        else if (event.key === 'Escape') api.cancel();
        else if (event.ctrlKey || event.metaKey) return; // Ctrl+S still reaches the grid.
        else {
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
      style={{
        width: '100%',
        height: '100%',
        padding: '0 5px',
        border: 'none',
        outline: 'none',
        borderRadius: 0,
        font: 'inherit',
        color: 'var(--fx-text-primary)',
        background: 'var(--fx-solid)',
        boxShadow: 'inset 0 0 0 2px var(--fx-accent)',
      }}
    />
  );
}

interface CellProps {
  readonly api: SheetsApi;
  readonly at: CellRef;
  readonly width: number;
  readonly marks: readonly Marked[];
  readonly rtl: boolean;
  readonly lang: AppLang;
  readonly onPick: (at: CellRef, extend: boolean) => void;
  readonly onSweep: (at: CellRef) => void;
  readonly cursorRef: (element: HTMLDivElement | null) => void;
}

/** One cell: what it shows, whether it is in the selection, and what reads it. */
function CellView({ api, at, width, marks, rtl, lang, onPick, onSweep, cursorRef }: CellProps) {
  const key = keyOf(at);
  const cell = cellOf(api.sheet, key);
  const value = api.calc.valueAt(api.index, key);
  const cursor = sameRef(at, api.selection.cursor);
  const selected = contains(api.selection.range, at);
  const editing = cursor && api.editing !== null;
  const align = cell.align === 'auto' ? naturalAlign(value, cell.format) : cell.align;
  const rings = [cursor ? 'inset 0 0 0 2px var(--fx-accent)' : '', ringOf(at, marks, rtl)].filter((part) => part !== '');

  return (
    <div
      ref={cursor ? cursorRef : undefined}
      role="gridcell"
      aria-colindex={at.col + 1}
      aria-selected={selected}
      onPointerDown={(event) => {
        if (event.button === 0) onPick(at, event.shiftKey);
      }}
      onPointerEnter={() => onSweep(at)}
      onDoubleClick={() => api.begin(null)}
      style={{
        flex: 'none',
        width,
        height: ROW_HEIGHT,
        padding: editing ? 0 : '0 6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'end' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        borderInlineEnd: '1px solid var(--fx-divider)',
        borderBottom: '1px solid var(--fx-divider)',
        background: cursor || !selected ? undefined : 'color-mix(in srgb, var(--fx-accent) 14%, transparent)',
        boxShadow: rings.length === 0 ? undefined : rings.join(', '),
        fontWeight: cell.bold ? 600 : undefined,
        fontStyle: cell.italic ? 'italic' : undefined,
        color: value.kind === 'error' ? 'var(--fx-danger)' : undefined,
        fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        scrollMarginTop: HEAD,
        scrollMarginInlineStart: GUTTER,
        cursor: 'cell',
      }}
    >
      {editing ? <CellEditor api={api} /> : display(value, cell.format, lang)}
    </div>
  );
}

/**
 * The keys a command id cannot carry.
 *
 * An arrow extends the selection when Shift is down, which is a second argument, so
 * these live here rather than in `hotkey`. In an RTL sheet the columns run right to left,
 * so ArrowLeft moves to the *next* column — the direction the person actually sees — while
 * Tab still moves forward in reading order, which is the other way.
 */
function navigate(api: SheetsApi, event: KeyboardEvent<HTMLDivElement>, rtl: boolean): boolean {
  const extend = event.shiftKey;
  const step = rtl ? -1 : 1;
  const { cursor } = api.selection;
  switch (event.key) {
    case 'ArrowUp':
      api.selection.move(0, -1, extend);
      return true;
    case 'ArrowDown':
      api.selection.move(0, 1, extend);
      return true;
    case 'ArrowLeft':
      api.selection.move(-step, 0, extend);
      return true;
    case 'ArrowRight':
      api.selection.move(step, 0, extend);
      return true;
    case 'PageUp':
      api.selection.move(0, -20, extend);
      return true;
    case 'PageDown':
      api.selection.move(0, 20, extend);
      return true;
    case 'Home':
      api.selection.select({ col: 0, row: event.ctrlKey ? 0 : cursor.row }, extend);
      return true;
    case 'End':
      api.selection.select({ col: api.extent.cols - 1, row: cursor.row }, extend);
      return true;
    case 'Enter':
      api.selection.move(0, extend ? -1 : 1, false);
      return true;
    case 'Tab':
      api.selection.move(extend ? -1 : 1, 0, false);
      return true;
    default:
      return false;
  }
}

export function SheetGrid({ api }: { readonly api: SheetsApi }) {
  const { lang, rtl } = useApp().locale;
  const scroller = useRef<HTMLDivElement | null>(null);
  const cursorCell = useRef<HTMLDivElement | null>(null);
  const sweeping = useRef(false);
  const [drag, setDrag] = useState<{ readonly col: number; readonly width: number } | null>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(560);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    element.focus();
    const watch = new ResizeObserver(() => setHeight(element.clientHeight));
    watch.observe(element);
    setHeight(element.clientHeight);
    return () => watch.disconnect();
  }, []);

  // An arrow key can walk the cursor past the viewport. `scrollMargin` on the cell is what
  // keeps it clear of the sticky header instead of tucked underneath it.
  useEffect(() => {
    cursorCell.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [api.cursorKey]);

  // A sweep ends wherever the button comes up, including outside this window.
  useEffect(() => {
    const stop = (): void => {
      sweeping.current = false;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const widthAt = useCallback(
    (col: number): number => (drag !== null && drag.col === col ? drag.width : widthOf(api.sheet, col)),
    [api.sheet, drag],
  );

  const marks = useMemo(
    () => marksOf(api.calc, api.index, api.cursorKey, api.sheet.name),
    [api.calc, api.cursorKey, api.index, api.sheet.name],
  );
  const cols = useMemo(() => series(api.view.cols), [api.view.cols]);

  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(api.view.rows - 1, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
  const box = api.selection.range;

  const pick = (at: CellRef, extend: boolean): void => {
    sweeping.current = true;
    api.selection.select(at, extend);
  };

  const sweep = (at: CellRef): void => {
    if (sweeping.current) api.selection.select(at, true);
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (api.editing !== null) return;
    if (navigate(api, event, rtl)) {
      event.preventDefault();
      return;
    }
    const id = hotkey(event);
    if (id !== null) {
      event.preventDefault();
      api.command(id);
      return;
    }
    // Anything else printable starts an edit with that character, as a grid should.
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    event.preventDefault();
    api.begin(event.key);
  };

  return (
    <div
      ref={scroller}
      tabIndex={0}
      role="grid"
      aria-rowcount={api.view.rows}
      aria-colcount={api.view.cols}
      onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      onKeyDown={keys}
      style={{ flex: 1, minHeight: 0, overflow: 'auto', outline: 'none', background: 'var(--fx-solid)' }}
    >
      <div style={{ width: 'max-content', minWidth: '100%' }}>
        <ColumnHeads
          cols={cols}
          widthAt={widthAt}
          range={box}
          rtl={rtl}
          onColumn={api.selection.column}
          onAll={api.selection.all}
          onDrag={(col, width) => setDrag({ col, width })}
          onDrop={(col, width) => {
            setDrag(null);
            api.width(col, width);
          }}
        />
        <div
          style={{
            paddingTop: first * ROW_HEIGHT,
            paddingBottom: Math.max(0, api.view.rows - 1 - last) * ROW_HEIGHT,
          }}
        >
          {series(Math.max(0, last - first + 1)).map((offset) => {
            const row = first + offset;
            return (
              <div key={row} role="row" aria-rowindex={row + 1} style={{ display: 'flex', height: ROW_HEIGHT }}>
                <RowHead
                  row={row}
                  selected={row >= box.start.row && row <= box.end.row}
                  onPick={(extend) => api.selection.row(row, extend)}
                />
                {cols.map((col) => (
                  <CellView
                    key={col}
                    api={api}
                    at={{ col, row }}
                    width={widthAt(col)}
                    marks={marks}
                    rtl={rtl}
                    lang={lang}
                    onPick={pick}
                    onSweep={sweep}
                    cursorRef={(element) => {
                      cursorCell.current = element;
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
