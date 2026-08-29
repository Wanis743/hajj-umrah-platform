/**
 * Sheets — the document, its history, and the selection.
 *
 * Undo is a stack of whole workbooks. That sounds extravagant until you remember what
 * `model.ts` guarantees: an edit copies the cell record and shares everything else, so
 * a hundred undo steps on a thousand-cell sheet cost a hundred small objects, not a
 * hundred sheets. The alternative — recording inverse operations — has to get every
 * inverse right, and the one it gets wrong is the one that loses a number.
 *
 * Three behaviours here are deliberate departures from the obvious:
 *
 *   • Cut removes the cells immediately rather than showing a marching-ants border
 *     that resolves on paste. The ABI has one clipboard and no notion of a pending
 *     move, and a cut that quietly does nothing until a paste that never comes is
 *     worse than one that plainly happened and can be undone.
 *   • Paste prefers the block this app copied over the text on the clipboard, but only
 *     while the clipboard still holds exactly what that copy wrote. That is how a
 *     formula survives a round trip through a clipboard that can only carry text.
 *   • Saving as `.csv` warns only when the workbook actually has something to lose.
 *     `fs.write` is unprivileged, so the kernel raises no consent for it: if this app
 *     does not ask, nothing does.
 */
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHANNEL_ACTIVATED, useApp, useIpc } from '@/platform/sdk';
import { DOCUMENTS, basename, dirname } from '../shared/paths';
import { type Clip, autoSumRange, clipSize, fillEdits, fromTsv, pasteEdits, pasteText, readClip } from './edits';
import {
  CSV_CONTENT_TYPE,
  SHEET_CONTENT_TYPE,
  csvToSheet,
  deserialize,
  isSheetPath,
  losesData,
  serialize,
  toCsv,
} from './files';
import { type NumberFormat, display } from './formats';
import {
  type Calculated,
  type Cell,
  type Sheet,
  type Workbook,
  activate,
  addSheet,
  applyEdits,
  calculator,
  cellOf,
  clearRange,
  extentOf,
  moveSheet,
  newWorkbook,
  removeSheet,
  renameSheet,
  restyle,
  setInput,
  setWidth,
  sheetAt,
} from './model';
import { type CellRange, type CellRef, MAX_COLS, MAX_ROWS, clampRef, formatRange, keyOf, normalize } from './refs';

/** How many workbooks back Ctrl+Z reaches. Excel's own limit is 100. */
const HISTORY = 100;

const ORIGIN: CellRef = { col: 0, row: 0 };

interface Doc {
  readonly past: readonly Workbook[];
  readonly present: Workbook;
  readonly future: readonly Workbook[];
  /** The workbook as it was written to disk — the dirty comparison, by identity. */
  readonly saved: Workbook;
  readonly path: string | null;
  readonly name: string;
}

const opened = (book: Workbook, path: string | null, name: string): Doc => ({
  past: [],
  present: book,
  future: [],
  saved: book,
  path,
  name,
});

/** The stack, and the two ways a workbook changes. Nothing here touches a file. */
function useHistory() {
  const { tr } = useApp().locale;
  const [doc, setDoc] = useState<Doc>(() => opened(newWorkbook(), null, tr('مصنف1', 'Classeur1', 'Book1')));

  /** One undo step. A change that returns the same workbook is not a step at all. */
  const edit = useCallback((change: (book: Workbook) => Workbook): void => {
    setDoc((current) => {
      const next = change(current.present);
      if (next === current.present) return current;
      return { ...current, past: [...current.past, current.present].slice(-HISTORY), present: next, future: [] };
    });
  }, []);

  /** Switching sheets: a change to the workbook that Ctrl+Z should not take back. */
  const touch = useCallback((change: (book: Workbook) => Workbook): void => {
    setDoc((current) => ({ ...current, present: change(current.present) }));
  }, []);

  const undo = useCallback(() => {
    setDoc((current) =>
      current.past.length === 0
        ? current
        : {
            ...current,
            past: current.past.slice(0, -1),
            present: current.past[current.past.length - 1],
            future: [current.present, ...current.future],
          },
    );
  }, []);

  const redo = useCallback(() => {
    setDoc((current) =>
      current.future.length === 0
        ? current
        : {
            ...current,
            past: [...current.past, current.present],
            present: current.future[0],
            future: current.future.slice(1),
          },
    );
  }, []);

  return { doc, setDoc, edit, touch, undo, redo };
}

/** The file half: the two `fs` syscalls and the dialogs the kernel owns. */
function useDocument() {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const { doc, setDoc, edit, touch, undo, redo } = useHistory();
  const [busy, setBusy] = useState(false);

  const openPath = useCallback(
    async (target: string): Promise<void> => {
      setBusy(true);
      const result = await runtime.invoke('fs.readText', { path: target });
      setBusy(false);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message, body: target });
        return;
      }
      const { content, stat } = result.value;
      // A `.fxsheet` that does not parse is a corrupt file, not an empty workbook: say
      // so rather than opening a blank grid that would overwrite it on the next save.
      const book = isSheetPath(stat.path)
        ? deserialize(content)
        : { sheets: [csvToSheet(content, stat.name)], active: 0 };
      if (book === null) {
        void runtime.toast({
          kind: 'error',
          title: tr('الملف ليس مصنّفًا', "Ce fichier n'est pas un classeur", 'That file is not a workbook'),
          body: stat.path,
        });
        return;
      }
      setDoc(opened(book, stat.path, stat.name));
    },
    [runtime, setDoc, tr],
  );

  const openDialog = useCallback(() => {
    void runtime
      .invoke('shell.fileDialog', {
        mode: 'open',
        title: tr('فتح مصنّف', 'Ouvrir un classeur', 'Open workbook'),
        startPath: DOCUMENTS,
        contentTypes: [SHEET_CONTENT_TYPE, CSV_CONTENT_TYPE],
      })
      .then((dialog) => {
        if (dialog.ok && dialog.value.path !== null) void openPath(dialog.value.path);
      });
  }, [runtime, tr, openPath]);

  /**
   * The write.
   *
   * A CSV export rebinds the document to the file it wrote — that is what the person
   * asked for — but only clears the dirty flag when nothing was left behind. A workbook
   * with formulas saved as CSV is still unsaved, and the asterisk should say so.
   */
  const write = useCallback(
    async (target: string, book: Workbook): Promise<void> => {
      const csv = !isSheetPath(target);
      const lossy = csv && losesData(book);
      if (lossy) {
        const agreed = await runtime.confirm({
          kind: 'warning',
          title: tr('الحفظ بصيغة CSV؟', 'Enregistrer au format CSV ?', 'Save as CSV?'),
          body: tr(
            'صيغة CSV تحفظ القيم فقط: تُفقد الصيغ والتنسيقات والأوراق الأخرى. احفظ بامتداد fxsheet. للاحتفاظ بها.',
            'Le CSV ne garde que les valeurs : les formules, les formats et les autres feuilles seront perdus. Enregistrez en .fxsheet pour les conserver.',
            'CSV keeps values only: formulas, formats and other sheets will be lost. Save as .fxsheet to keep them.',
          ),
          confirmLabel: { ar: 'احفظ CSV', fr: 'Enregistrer le CSV', en: 'Save CSV' },
        });
        if (!agreed) return;
      }
      setBusy(true);
      const content = csv ? toCsv(book, book.active, calculator(book)) : serialize(book);
      const result = await runtime.invoke('fs.writeText', {
        path: target,
        content,
        contentType: csv ? CSV_CONTENT_TYPE : SHEET_CONTENT_TYPE,
      });
      setBusy(false);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message, body: target });
        return;
      }
      const stat = result.value;
      setDoc((current) => ({ ...current, path: stat.path, name: stat.name, saved: lossy ? current.saved : book }));
      void runtime.toast({ kind: 'success', title: tr('حُفظ المصنّف', 'Classeur enregistré', 'Workbook saved'), body: stat.path });
    },
    [runtime, setDoc, tr],
  );

  const saveAs = useCallback(() => {
    void runtime
      .invoke('shell.fileDialog', {
        mode: 'save',
        title: tr('حفظ باسم', 'Enregistrer sous', 'Save as'),
        startPath: doc.path === null ? DOCUMENTS : dirname(doc.path),
        suggestedName: doc.path === null ? `${doc.name}.fxsheet` : basename(doc.path),
      })
      .then((dialog) => {
        if (dialog.ok && dialog.value.path !== null) void write(dialog.value.path, doc.present);
      });
  }, [doc, runtime, tr, write]);

  const save = useCallback(() => {
    if (doc.path === null) saveAs();
    else void write(doc.path, doc.present);
  }, [doc, saveAs, write]);

  /** Asked before anything that throws the current workbook away. */
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (doc.present === doc.saved) return true;
    return runtime.confirm({
      kind: 'warning',
      destructive: true,
      title: tr('المتابعة دون حفظ؟', 'Continuer sans enregistrer ?', 'Continue without saving?'),
      body: tr(
        'التغييرات غير المحفوظة ستُفقد. أَلغِ ثم احفظ إن أردت الاحتفاظ بها.',
        'Les modifications non enregistrées seront perdues. Annulez puis enregistrez pour les garder.',
        'Unsaved changes will be lost. Cancel and save if you want to keep them.',
      ),
      confirmLabel: { ar: 'تجاهل', fr: 'Ignorer', en: 'Discard' },
    });
  }, [doc, runtime, tr]);

  const create = useCallback(() => {
    const run = async (): Promise<void> => {
      if (!(await confirmDiscard())) return;
      setDoc(opened(newWorkbook(), null, tr('مصنف1', 'Classeur1', 'Book1')));
    };
    void run();
  }, [confirmDiscard, setDoc, tr]);

  // A file-association launch arrives as `path`, and opens once per process.
  const launched = useRef(false);
  useEffect(() => {
    const path = runtime.args.path;
    if (launched.current || path === undefined || path === '') return;
    launched.current = true;
    void openPath(path);
  }, [runtime, openPath]);

  /**
   * Second launch of a single-instance app.
   *
   * The kernel re-activates this process with the new arguments instead of starting
   * another Sheets. Notepad answers this with another tab; a workbook is one document
   * per window, so the file replaces what is here — after asking, if there is anything
   * to lose.
   */
  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const path = payload?.args?.path;
    if (path === undefined || path === '') return;
    void confirmDiscard().then((agreed) => {
      if (agreed) void openPath(path);
    });
  });

  return {
    doc,
    busy,
    dirty: doc.present !== doc.saved,
    canUndo: doc.past.length > 0,
    canRedo: doc.future.length > 0,
    edit,
    touch,
    undo,
    redo,
    create,
    openPath,
    openDialog,
    save,
    saveAs,
  };
}

interface Span {
  readonly cursor: CellRef;
  readonly anchor: CellRef;
}

/**
 * The selection: one moving cursor and one fixed anchor.
 *
 * Every spreadsheet selection is those two cells — the rectangle is derived, never
 * stored, which is why Shift+Click and Shift+Arrow need no special case and why
 * `normalize` can hand back a box whose corners are always in reading order.
 */
function useSelection(index: number, extent: { readonly cols: number; readonly rows: number }) {
  const [span, setSpan] = useState<Span>({ cursor: ORIGIN, anchor: ORIGIN });

  // Another sheet is another coordinate space; carrying the cursor across would leave
  // the reference box on a cell nobody chose.
  useEffect(() => setSpan({ cursor: ORIGIN, anchor: ORIGIN }), [index]);

  const select = useCallback((ref: CellRef, extend = false): void => {
    setSpan((current) => {
      const at = clampRef(ref);
      return { cursor: at, anchor: extend ? current.anchor : at };
    });
  }, []);

  const move = useCallback((dcol: number, drow: number, extend: boolean): void => {
    setSpan((current) => {
      const at = clampRef({ col: current.cursor.col + dcol, row: current.cursor.row + drow });
      return { cursor: at, anchor: extend ? current.anchor : at };
    });
  }, []);

  const setRange = useCallback((range: CellRange): void => {
    setSpan({ cursor: clampRef(range.end), anchor: clampRef(range.start) });
  }, []);

  const all = useCallback((): void => {
    setSpan({ cursor: clampRef({ col: extent.cols - 1, row: extent.rows - 1 }), anchor: ORIGIN });
  }, [extent.cols, extent.rows]);

  const column = useCallback(
    (col: number, extend: boolean): void => {
      setSpan((current) => ({
        cursor: clampRef({ col, row: extent.rows - 1 }),
        anchor: { col: extend ? current.anchor.col : col, row: 0 },
      }));
    },
    [extent.rows],
  );

  const row = useCallback(
    (line: number, extend: boolean): void => {
      setSpan((current) => ({
        cursor: clampRef({ col: extent.cols - 1, row: line }),
        anchor: { col: 0, row: extend ? current.anchor.row : line },
      }));
    },
    [extent.cols],
  );

  const range = useMemo(() => normalize({ start: span.anchor, end: span.cursor }), [span]);

  return useMemo(
    () => ({ cursor: span.cursor, anchor: span.anchor, range, select, move, setRange, all, column, row }),
    [span, range, select, move, setRange, all, column, row],
  );
}

/**
 * The command ids the manifest declares, and the table that answers them.
 *
 * Keeping this a type rather than a loose string means an accelerator the manifest
 * offers but the app forgot to implement is a compile error, not a dead key.
 */
type CommandId =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'undo'
  | 'redo'
  | 'sum'
  | 'recalc'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'fill-down'
  | 'fill-right'
  | 'select-all'
  | 'clear'
  | 'bold'
  | 'italic'
  | 'edit';

type Actions = Readonly<Record<CommandId, () => void>>;

/**
 * Everything the window needs, in one object.
 *
 * The grid, the formula bar, the tab strip and the status bar all read from here, so
 * there is exactly one selection and one document however many of them are on screen.
 */
export function useSheets() {
  const document = useDocument();
  const book = document.doc.present;
  const index = book.active;
  const sheet = sheetAt(book, index);
  const extent = useMemo(() => extentOf(sheet), [sheet]);
  const selection = useSelection(index, extent);
  const [epoch, setEpoch] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);

  const calc = useMemo(() => {
    // `epoch` is a real dependency: F9 bumps it to throw the cache away, which is the
    // only way `TODAY()` and `NOW()` can ever give a different answer than they did.
    void epoch;
    return calculator(book);
  }, [book, epoch]);

  /** The rendered rectangle, which must reach the cursor even on an empty sheet. */
  const view = useMemo(
    () => ({
      cols: Math.min(MAX_COLS, Math.max(extent.cols, selection.cursor.col + 2)),
      rows: Math.min(MAX_ROWS, Math.max(extent.rows, selection.cursor.row + 2)),
    }),
    [extent, selection.cursor],
  );

  const cursorKey = keyOf(selection.cursor);
  const cell = cellOf(sheet, cursorKey);
  const value = calc.valueAt(index, cursorKey);

  /** `null` seeds the editor with what the cell already holds; a string replaces it. */
  const begin = useCallback(
    (seed: string | null): void => setEditing(seed ?? cellOf(sheet, keyOf(selection.cursor)).input),
    [sheet, selection.cursor],
  );

  const change = useCallback((text: string): void => setEditing(text), []);
  const cancel = useCallback((): void => setEditing(null), []);

  const commit = useCallback(
    (dcol: number, drow: number): void => {
      if (editing !== null) document.edit((current) => setInput(current, index, selection.cursor, editing));
      setEditing(null);
      if (dcol !== 0 || drow !== 0) selection.move(dcol, drow, false);
    },
    [document, editing, index, selection],
  );

  const clear = useCallback((): void => {
    setEditing(null);
    document.edit((current) => clearRange(current, index, selection.range));
  }, [document, index, selection.range]);

  const style = useCallback(
    (patch: Partial<Cell>): void => document.edit((current) => restyle(current, index, selection.range, patch)),
    [document, index, selection.range],
  );

  const format = useCallback((next: NumberFormat): void => style({ format: next }), [style]);

  const width = useCallback(
    (col: number, pixels: number): void => document.edit((current) => setWidth(current, index, col, pixels)),
    [document, index],
  );

  const fill = useCallback(
    (direction: 'down' | 'right'): void =>
      document.edit((current) =>
        applyEdits(current, index, fillEdits(sheetAt(current, index), selection.range, direction)),
      ),
    [document, index, selection.range],
  );

  const { autoSum, copy, paste } = useTools(document, selection, calc, sheet, index);
  const { addTab, selectTab, renameTab, moveTab, closeTab } = useTabs(book, document);

  const recalc = useCallback((): void => setEpoch((current) => current + 1), []);

  /**
   * One name for every action, so a toolbar button, a jump-list entry, an accelerator
   * and the command palette all reach the same code. The ids are the manifest's.
   */
  const actions = useMemo<Actions>(
    () => ({
      new: document.create,
      open: document.openDialog,
      save: document.save,
      saveAs: document.saveAs,
      undo: document.undo,
      redo: document.redo,
      sum: autoSum,
      recalc,
      copy: () => copy(false),
      cut: () => copy(true),
      paste,
      'fill-down': () => fill('down'),
      'fill-right': () => fill('right'),
      'select-all': selection.all,
      clear,
      bold: () => style({ bold: !cell.bold }),
      italic: () => style({ italic: !cell.italic }),
      edit: () => begin(null),
    }),
    [autoSum, begin, cell.bold, cell.italic, clear, copy, document, fill, paste, recalc, selection.all, style],
  );

  // An id from a menu the app does not implement is ignored rather than crashing the
  // window: the kernel's palette and this table are versioned separately.
  const command = useCallback(
    (id: string): void => {
      const action = Object.hasOwn(actions, id) ? actions[id as CommandId] : undefined;
      if (action !== undefined) action();
    },
    [actions],
  );

  return {
    /** The document. */
    book,
    sheet,
    index,
    path: document.doc.path,
    name: document.doc.name,
    dirty: document.dirty,
    busy: document.busy,
    canUndo: document.canUndo,
    canRedo: document.canRedo,
    /** The calculated view, and the rectangle worth rendering. */
    calc,
    view,
    extent,
    /** The cursor's cell: its record, its value, its key. */
    cell,
    value,
    cursorKey,
    selection,
    /** `null` when the cell is not being typed into. */
    editing,
    begin,
    change,
    cancel,
    commit,
    clear,
    style,
    format,
    width,
    fill,
    autoSum,
    copy,
    paste,
    addTab,
    selectTab,
    renameTab,
    moveTab,
    closeTab,
    recalc,
    command,
    undo: document.undo,
    redo: document.redo,
    create: document.create,
    openDialog: document.openDialog,
    save: document.save,
    saveAs: document.saveAs,
  };
}

export type SheetsApi = ReturnType<typeof useSheets>;

/**
 * The three actions that read values as well as write them.
 *
 * Σ has to know which cells above the cursor hold numbers, and the clipboard carries
 * what the cells *show* rather than what they hold — so all three need the calculated
 * view, which is why they sit apart from the plain edits.
 */
function useTools(
  document: ReturnType<typeof useDocument>,
  selection: ReturnType<typeof useSelection>,
  calc: Calculated,
  sheet: Sheet,
  index: number,
) {
  const runtime = useApp();
  const { lang, tr } = runtime.locale;
  /** The cells this app last copied. Not the clipboard — the clipboard holds text. */
  const clip = useRef<Clip | null>(null);

  const autoSum = useCallback((): void => {
    const target = autoSumRange(selection.cursor, (key) => calc.valueAt(index, key).kind === 'number');
    if (target === null) {
      void runtime.toast({
        kind: 'info',
        title: tr('لا أرقام لجمعها هنا', 'Rien à additionner ici', 'Nothing to add up here'),
        body: tr(
          'ضع المؤشر تحت عمود أرقام أو على يمين صف منها.',
          "Placez le curseur sous une colonne de nombres, ou à droite d'une ligne.",
          'Put the cursor below a column of numbers, or to the right of a row of them.',
        ),
      });
      return;
    }
    document.edit((current) => setInput(current, index, selection.cursor, `=SUM(${formatRange(target)})`));
  }, [calc, document, index, runtime, selection.cursor, tr]);

  /** Copy puts displayed values on the clipboard and keeps the cells themselves here. */
  const copy = useCallback(
    (cut: boolean): void => {
      const taken = readClip(sheet, selection.range, (key) =>
        display(calc.valueAt(index, key), cellOf(sheet, key).format, lang),
      );
      clip.current = taken;
      void runtime.invoke('shell.clipboardWrite', { text: taken.text });
      if (cut) document.edit((current) => clearRange(current, index, selection.range));
    },
    [calc, document, index, lang, runtime, selection.range, sheet],
  );

  /**
   * Paste, in the order that matters.
   *
   * The stash wins only while the system clipboard still reads exactly what that copy
   * wrote; the moment anything else has written to it, the text is what the person means
   * to paste, and it is read as a grid of tab-separated values.
   */
  const paste = useCallback((): void => {
    const run = async (): Promise<void> => {
      const result = await runtime.invoke('shell.clipboardRead', {});
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message });
        return;
      }
      const text = result.value.text;
      const stash = clip.current;
      const own = stash !== null && stash.text === text;
      if (!own && text === '') return;
      const target = selection.cursor;
      const grid = fromTsv(text);
      const size =
        own && stash !== null
          ? clipSize(stash)
          : { cols: Math.max(...grid.map((line) => line.length), 1), rows: grid.length };
      if (own && stash !== null) document.edit((current) => applyEdits(current, index, pasteEdits(target, stash)));
      else document.edit((current) => applyEdits(current, index, pasteText(sheetAt(current, index), target, grid)));
      // Selecting what landed is how a person sees the extent of what they just did.
      selection.setRange({ start: target, end: { col: target.col + size.cols - 1, row: target.row + size.rows - 1 } });
    };
    void run();
  }, [document, index, runtime, selection]);

  return { autoSum, copy, paste };
}

/**
 * The tab strip.
 *
 * Adding, renaming and reordering a sheet are undoable edits — a formula addresses a
 * sheet by name, so a rename can change what a cell computes and has to be a step.
 * Merely switching sheets is not: `touch` moves the active index without a step, so
 * Ctrl+Z after a look around still takes back the last number typed.
 */
function useTabs(book: Workbook, document: ReturnType<typeof useDocument>) {
  const runtime = useApp();
  const { tr } = runtime.locale;

  const addTab = useCallback((): void => document.edit((current) => addSheet(current)), [document]);
  const selectTab = useCallback((at: number): void => document.touch((current) => activate(current, at)), [document]);

  const renameTab = useCallback(
    (at: number, name: string): void => document.edit((current) => renameSheet(current, at, name)),
    [document],
  );

  const moveTab = useCallback(
    (from: number, to: number): void => document.edit((current) => moveSheet(current, from, to)),
    [document],
  );

  const closeTab = useCallback(
    (at: number): void => {
      if (book.sheets.length <= 1) {
        void runtime.toast({
          kind: 'info',
          title: tr(
            'المصنّف يحتاج ورقة واحدة على الأقل',
            'Un classeur garde au moins une feuille',
            'A workbook keeps at least one sheet',
          ),
        });
        return;
      }
      const target = sheetAt(book, at);
      const run = async (): Promise<void> => {
        // An empty sheet is not worth a dialog; one with numbers on it is.
        if (Object.keys(target.cells).length > 0) {
          const agreed = await runtime.confirm({
            kind: 'warning',
            destructive: true,
            title: tr(`حذف «${target.name}»؟`, `Supprimer « ${target.name} » ?`, `Delete “${target.name}”?`),
            body: tr(
              'الورقة وكل ما فيها ستُحذف. Ctrl+Z يتراجع.',
              'La feuille et tout son contenu seront supprimés. Ctrl+Z annule.',
              'The sheet and everything on it will be removed. Ctrl+Z undoes it.',
            ),
            confirmLabel: { ar: 'احذف', fr: 'Supprimer', en: 'Delete' },
          });
          if (!agreed) return;
        }
        document.edit((current) => removeSheet(current, at));
      };
      void run();
    },
    [book, document, runtime, tr],
  );

  return { addTab, selectTab, renameTab, moveTab, closeTab };
}

/** Ctrl (or ⌘) and one key. Kept apart from `hotkey` so neither grows a warning. */
function chord(event: KeyboardEvent<HTMLElement>): CommandId | null {
  switch (event.key.toLowerCase()) {
    case 'c':
      return 'copy';
    case 'x':
      return 'cut';
    case 'v':
      return 'paste';
    case 'd':
      return 'fill-down';
    case 'r':
      return 'fill-right';
    case 'a':
      return 'select-all';
    case 'b':
      return 'bold';
    case 'i':
      return 'italic';
    case 'z':
      return event.shiftKey ? 'redo' : 'undo';
    case 'y':
      return 'redo';
    case 's':
      return event.shiftKey ? 'saveAs' : 'save';
    case 'o':
      return 'open';
    case 'n':
      return 'new';
    default:
      return null;
  }
}

/**
 * Keyboard to command id.
 *
 * Spelled out here rather than left to the shell because these are the chords a person
 * who has used a spreadsheet already knows, and they have to work while the grid has
 * focus. Navigation is deliberately absent: an arrow key needs the Shift flag to decide
 * between moving the cursor and extending the selection, and a command id cannot carry
 * it — the grid reads those keys itself.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): CommandId | null {
  if (event.key === 'F9') return 'recalc';
  if (event.key === 'F2') return 'edit';
  if (event.altKey && (event.key === '=' || event.key === '+')) return 'sum';
  if (event.ctrlKey || event.metaKey) return chord(event);
  return event.key === 'Delete' || event.key === 'Backspace' ? 'clear' : null;
}
