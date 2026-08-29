/**
 * Sheets — the chrome around the grid.
 *
 * The menu strip, the toolbar, the formula bar, the sheet tabs and the status bar.
 * Everything here is a function of props: the formula bar does not know what a
 * workbook is, only what text the cell holds and who to tell when it changes.
 *
 * The formula bar is a raw `<input>` rather than the kit's `Input`, for the same
 * reason Notepad's editor is a raw `<textarea>`: the completion list needs
 * ArrowUp/ArrowDown/Tab, and `Input` owns `onKeyDown` to implement its own
 * `onEnter`/`onEscape`. It still wears `fx-input fx-input-mono`, so it looks and
 * focuses like every other field in the OS.
 */
import { type CSSProperties, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  Bold,
  ClipboardPaste,
  Copy,
  Eraser,
  FileDown,
  FilePlus2,
  FolderOpen,
  Italic,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Sigma,
  Undo2,
  X,
} from 'lucide-react';
import {
  Button,
  IconButton,
  Input,
  MenuBar,
  Select,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
  fmt,
  useApp,
} from '@/platform/sdk';
import { FUNCTIONS, FUNCTION_NAMES } from './engine';
import { type CellAlign, FORMAT_LABEL, NUMBER_FORMATS, type NumberFormat, literalText } from './formats';
import { type Calculated, type Cell, type Sheet, isFormula } from './model';
import { type CellRange, type CellRef, cellsOf, formatRange, keyOf, parseRef, rangeSize } from './refs';
import { type CellValue } from './values';

/**
 * A selection is a rectangle, and a rectangle can be a whole column — 4096 cells,
 * every one of them a formula. The cap is what keeps dragging across one from
 * recalculating a workbook on every pointer move; past it the status bar reports
 * what it counted rather than pretending to have read the rest.
 */
const CAP = 20_000;

interface Stats {
  readonly count: number;
  readonly numbers: number;
  readonly sum: number;
  /** `null` when the selection holds no numbers — not zero, which averages to a lie. */
  readonly average: number | null;
  readonly capped: boolean;
}

/**
 * What the status bar reports about the selection.
 *
 * Excel's own four: how many cells hold something, how many of those are numbers,
 * and the sum and average of those. Text and blanks are not zero, so averaging a
 * column with a header in it does not divide by the header.
 */
function summarize(calc: Calculated, index: number, range: CellRange): Stats {
  let count = 0;
  let numbers = 0;
  let sum = 0;
  let seen = 0;
  for (const ref of cellsOf(range)) {
    if (seen >= CAP) break;
    seen += 1;
    const value: CellValue = calc.valueAt(index, keyOf(ref));
    if (value.kind === 'blank') continue;
    count += 1;
    if (value.kind !== 'number') continue;
    numbers += 1;
    sum += value.value;
  }
  return { count, numbers, sum, average: numbers === 0 ? null : sum / numbers, capped: seen >= CAP };
}

/** An identifier being typed at the end of the line — `=SU`, `=1+AVER`. */
const TAIL = /[A-Za-z][A-Za-z0-9.]*$/;

/**
 * The function names that could finish what is being typed.
 *
 * An exact match is left out on purpose: once the whole name is there the hint
 * below the bar shows its signature, and a one-item list repeating the word just
 * typed is a list nobody reads.
 */
function completions(text: string): readonly string[] {
  if (!text.startsWith('=')) return [];
  const match = TAIL.exec(text);
  if (match === null) return [];
  const word = match[0].toUpperCase();
  return FUNCTION_NAMES.filter((name) => name !== word && name.startsWith(word)).slice(0, 8);
}

const accept = (text: string, name: string): string => text.replace(TAIL, `${name}(`);

/**
 * The function whose arguments the caret is inside.
 *
 * Walked backwards over balanced pairs, so in `=IF(SUM(A1:A9)>0,` the hint is `IF`
 * and not `SUM` — the call that is still open is the one whose arguments are being
 * written.
 */
function hintOf(text: string): string | null {
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === ')') {
      depth += 1;
      continue;
    }
    if (character !== '(') continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    const match = TAIL.exec(text.slice(0, index));
    return match === null ? null : match[0].toUpperCase();
  }
  return null;
}

/** The signature of the open call, or `null` when there is no open call. */
function signatureOf(text: string): string | null {
  if (!text.startsWith('=')) return null;
  const name = hintOf(text);
  if (name === null || !Object.hasOwn(FUNCTIONS, name)) return null;
  return FUNCTIONS[name].signature;
}

const ALIGNS: readonly CellAlign[] = ['auto', 'start', 'center', 'end'];

export interface MenusProps {
  /** The cursor's cell, so Bold, the number format and the alignment show as checked. */
  readonly cell: Cell;
  readonly onCommand: (id: string) => void;
  readonly onFormat: (format: NumberFormat) => void;
  readonly onAlign: (align: CellAlign) => void;
}

/**
 * The menu strip.
 *
 * Format's entries carry a value rather than an action — a number format is one of
 * eight, not eight commands — so they are named `fmt-money` and sorted out here.
 * Everything else is a command id the app's own table answers, which is what lets
 * the same id come from a menu, an accelerator or the shell's command palette.
 */
export function SheetsMenus({ cell, onCommand, onFormat, onAlign }: MenusProps) {
  const { t, tr } = useApp().locale;

  const dispatch = (entryId: string): void => {
    const format = NUMBER_FORMATS.find((candidate) => `fmt-${candidate}` === entryId);
    if (format !== undefined) {
      onFormat(format);
      return;
    }
    const align = ALIGNS.find((candidate) => `align-${candidate}` === entryId);
    if (align !== undefined) {
      onAlign(align);
      return;
    }
    onCommand(entryId);
  };

  return (
    <MenuBar
      onSelect={(_menu, entryId) => dispatch(entryId)}
      menus={[
        {
          id: 'file',
          label: tr('ملف', 'Fichier', 'File'),
          entries: [
            { id: 'new', label: tr('مصنّف جديد', 'Nouveau classeur', 'New workbook'), icon: FilePlus2, accelerator: 'Ctrl+N' },
            { id: 'open', label: tr('فتح…', 'Ouvrir…', 'Open…'), icon: FolderOpen, accelerator: 'Ctrl+O' },
            { id: 'sep0', kind: 'separator' },
            { id: 'save', label: tr('حفظ', 'Enregistrer', 'Save'), icon: Save, accelerator: 'Ctrl+S' },
            { id: 'saveAs', label: tr('حفظ باسم…', 'Enregistrer sous…', 'Save as…'), icon: FileDown },
          ],
        },
        {
          id: 'edit',
          label: tr('تحرير', 'Édition', 'Edit'),
          entries: [
            { id: 'undo', label: tr('تراجع', 'Annuler', 'Undo'), icon: Undo2, accelerator: 'Ctrl+Z' },
            { id: 'redo', label: tr('إعادة', 'Rétablir', 'Redo'), icon: Redo2, accelerator: 'Ctrl+Y' },
            { id: 'sep0', kind: 'separator' },
            { id: 'cut', label: tr('قص', 'Couper', 'Cut'), icon: Scissors, accelerator: 'Ctrl+X' },
            { id: 'copy', label: tr('نسخ', 'Copier', 'Copy'), icon: Copy, accelerator: 'Ctrl+C' },
            { id: 'paste', label: tr('لصق', 'Coller', 'Paste'), icon: ClipboardPaste, accelerator: 'Ctrl+V' },
            { id: 'sep1', kind: 'separator' },
            { id: 'fill-down', label: tr('تعبئة لأسفل', 'Remplir vers le bas', 'Fill down'), icon: ArrowDown, accelerator: 'Ctrl+D' },
            { id: 'fill-right', label: tr('تعبئة لليمين', 'Remplir à droite', 'Fill right'), icon: ArrowRight, accelerator: 'Ctrl+R' },
            { id: 'sep2', kind: 'separator' },
            { id: 'select-all', label: tr('تحديد الكل', 'Tout sélectionner', 'Select all'), accelerator: 'Ctrl+A' },
            { id: 'clear', label: tr('مسح المحتوى', 'Effacer le contenu', 'Clear contents'), icon: Eraser, accelerator: 'Del' },
          ],
        },
        {
          id: 'format',
          label: tr('تنسيق', 'Format', 'Format'),
          entries: [
            { id: 'bold', label: tr('عريض', 'Gras', 'Bold'), icon: Bold, accelerator: 'Ctrl+B', checked: cell.bold },
            { id: 'italic', label: tr('مائل', 'Italique', 'Italic'), icon: Italic, accelerator: 'Ctrl+I', checked: cell.italic },
            { id: 'head-number', kind: 'header', label: tr('تنسيق الأرقام', 'Format numérique', 'Number format') },
            ...NUMBER_FORMATS.map((format) => ({
              id: `fmt-${format}`,
              label: t(FORMAT_LABEL[format]),
              checked: cell.format === format,
            })),
            { id: 'head-align', kind: 'header', label: tr('محاذاة', 'Alignement', 'Alignment') },
            { id: 'align-auto', label: tr('تلقائي', 'Automatique', 'Automatic'), checked: cell.align === 'auto' },
            { id: 'align-start', label: tr('بداية', 'Début', 'Start'), icon: AlignLeft, checked: cell.align === 'start' },
            { id: 'align-center', label: tr('وسط', 'Centre', 'Center'), icon: AlignCenter, checked: cell.align === 'center' },
            { id: 'align-end', label: tr('نهاية', 'Fin', 'End'), icon: AlignRight, checked: cell.align === 'end' },
          ],
        },
        {
          id: 'data',
          label: tr('بيانات', 'Données', 'Data'),
          entries: [
            { id: 'sum', label: tr('جمع تلقائي', 'Somme automatique', 'AutoSum'), icon: Sigma, accelerator: 'Alt+=' },
            { id: 'recalc', label: tr('إعادة حساب', 'Recalculer', 'Recalculate'), icon: RefreshCw, accelerator: 'F9' },
          ],
        },
      ]}
    />
  );
}

export interface ToolbarProps {
  readonly cell: Cell;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onCommand: (id: string) => void;
  readonly onFormat: (format: NumberFormat) => void;
  readonly onAlign: (align: CellAlign) => void;
}

/**
 * The toolbar.
 *
 * The order is the one every spreadsheet has trained people in: the file, then
 * history, then Σ and the number format, then the character, then alignment. The
 * alignment buttons are `start`/`end` rather than left/right and their icons follow
 * the writing direction, so in an Arabic session "start" is the right-hand edge and
 * the glyph agrees.
 */
export function SheetsToolbar({ cell, dirty, busy, canUndo, canRedo, onCommand, onFormat, onAlign }: ToolbarProps) {
  const { t, tr, rtl } = useApp().locale;
  const StartIcon = rtl ? AlignRight : AlignLeft;
  const EndIcon = rtl ? AlignLeft : AlignRight;

  return (
    <>
      <Button size="sm" icon={Save} onClick={() => onCommand('save')} busy={busy} disabled={!dirty}>
        {tr('حفظ', 'Enregistrer', 'Save')}
      </Button>
      <Button size="sm" variant="subtle" icon={FolderOpen} onClick={() => onCommand('open')}>
        {tr('فتح', 'Ouvrir', 'Open')}
      </Button>
      <ToolbarSeparator />
      <IconButton
        icon={Undo2}
        label={tr('تراجع', 'Annuler', 'Undo')}
        onClick={() => onCommand('undo')}
        disabled={!canUndo}
      />
      <IconButton
        icon={Redo2}
        label={tr('إعادة', 'Rétablir', 'Redo')}
        onClick={() => onCommand('redo')}
        disabled={!canRedo}
      />
      <ToolbarSeparator />
      <IconButton icon={Sigma} label={tr('جمع تلقائي', 'Somme automatique', 'AutoSum')} onClick={() => onCommand('sum')} />
      <Select
        value={cell.format}
        width={148}
        onChange={(next) => {
          const found = NUMBER_FORMATS.find((candidate) => candidate === next);
          if (found !== undefined) onFormat(found);
        }}
        options={NUMBER_FORMATS.map((format) => ({ value: format, label: t(FORMAT_LABEL[format]) }))}
      />
      <ToolbarSeparator />
      <IconButton icon={Bold} label={tr('عريض', 'Gras', 'Bold')} onClick={() => onCommand('bold')} active={cell.bold} />
      <IconButton
        icon={Italic}
        label={tr('مائل', 'Italique', 'Italic')}
        onClick={() => onCommand('italic')}
        active={cell.italic}
      />
      <ToolbarSeparator />
      <IconButton
        icon={StartIcon}
        label={tr('محاذاة للبداية', 'Aligner au début', 'Align start')}
        onClick={() => onAlign(cell.align === 'start' ? 'auto' : 'start')}
        active={cell.align === 'start'}
      />
      <IconButton
        icon={AlignCenter}
        label={tr('توسيط', 'Centrer', 'Align center')}
        onClick={() => onAlign(cell.align === 'center' ? 'auto' : 'center')}
        active={cell.align === 'center'}
      />
      <IconButton
        icon={EndIcon}
        label={tr('محاذاة للنهاية', 'Aligner à la fin', 'Align end')}
        onClick={() => onAlign(cell.align === 'end' ? 'auto' : 'end')}
        active={cell.align === 'end'}
      />
      <ToolbarSeparator />
      <IconButton
        icon={ArrowDown}
        label={tr('تعبئة لأسفل', 'Remplir vers le bas', 'Fill down')}
        onClick={() => onCommand('fill-down')}
      />
      <IconButton
        icon={ArrowRight}
        label={tr('تعبئة لليمين', 'Remplir à droite', 'Fill right')}
        onClick={() => onCommand('fill-right')}
      />
      <ToolbarSpacer />
    </>
  );
}

/**
 * The name box.
 *
 * It shows where the selection is until someone types in it, at which point it
 * shows what they typed — the draft is separate state precisely so that a
 * half-written `B1` does not fight the selection for the field.
 */
function NameBox({ label, onGo }: { readonly label: string; readonly onGo: (ref: CellRef) => void }) {
  const { tr } = useApp().locale;
  const [draft, setDraft] = useState<string | null>(null);
  const wrong = draft !== null && draft.trim() !== '' && parseRef(draft) === null;

  const go = (): void => {
    const ref = draft === null ? null : parseRef(draft);
    if (ref !== null) onGo(ref);
    setDraft(null);
  };

  return (
    <Input
      value={draft ?? label}
      onChange={setDraft}
      onEnter={go}
      onEscape={() => setDraft(null)}
      onBlur={() => setDraft(null)}
      invalid={wrong}
      mono
      dir="ltr"
      style={{ width: 108, flex: 'none', textAlign: 'center' }}
      title={tr('مربع الاسم', 'Zone Nom', 'Name box')}
      aria-label={tr('الانتقال إلى خلية', 'Aller à la cellule', 'Go to cell')}
    />
  );
}

/** The shared shell of the two things that can hang under the formula bar. */
const FLYOUT: CSSProperties = {
  position: 'absolute',
  insetInlineStart: 0,
  top: 'calc(100% + 4px)',
  zIndex: 20,
  padding: 4,
  background: 'var(--fx-layer)',
  border: '1px solid var(--fx-stroke)',
  borderRadius: 'var(--fx-radius-control)',
  boxShadow: 'var(--fx-shadow-flyout)',
};

interface CompletionsProps {
  readonly list: readonly string[];
  readonly at: number;
  readonly onPick: (name: string) => void;
  readonly onHover: (index: number) => void;
}

/** The function list, with each name's signature beside it. */
function Completions({ list, at, onPick, onHover }: CompletionsProps) {
  const { tr } = useApp().locale;
  return (
    <div
      className="fx-scroll"
      role="listbox"
      aria-label={tr('الدوال', 'Fonctions', 'Functions')}
      style={{ ...FLYOUT, minWidth: 280, maxHeight: 232, overflowY: 'auto' }}
    >
      {list.map((name, index) => (
        <button
          key={name}
          type="button"
          role="option"
          aria-selected={index === at}
          // `onMouseDown`, not `onClick`: a click blurs the field first, and a blurred
          // formula bar has already decided what the cell holds.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(name);
          }}
          onPointerEnter={() => onHover(index)}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'baseline',
            width: '100%',
            padding: '4px 8px',
            borderRadius: 4,
            textAlign: 'start',
            background: index === at ? 'var(--fx-subtle-hover)' : 'transparent',
          }}
        >
          <span className="fx-mono" style={{ fontWeight: 600, flex: 'none' }}>
            {name}
          </span>
          <span
            style={{
              fontSize: 'var(--fx-caption)',
              color: 'var(--fx-text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {FUNCTIONS[name].signature}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The signature of the call being written, once its name is complete. */
function Signature({ text }: { readonly text: string }) {
  return (
    <div
      style={{
        ...FLYOUT,
        maxWidth: '100%',
        padding: '3px 8px',
        fontFamily: 'var(--fx-font-mono)',
        fontSize: 'var(--fx-caption)',
        color: 'var(--fx-text-secondary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </div>
  );
}

export interface FormulaBarProps {
  readonly range: CellRange;
  readonly cell: Cell;
  readonly value: CellValue;
  /** The live draft while a cell is being edited, or `null` when it is not. */
  readonly editing: string | null;
  readonly onGo: (ref: CellRef) => void;
  readonly onBegin: () => void;
  readonly onChange: (next: string) => void;
  readonly onCommit: (dcol: number, drow: number) => void;
  readonly onCancel: () => void;
}

/**
 * The formula bar.
 *
 * Two keys are worth being explicit about, because every spreadsheet gets asked:
 * **Tab** takes the highlighted completion when the list is open and otherwise
 * commits and moves along the row, and **Enter** always commits. A key that
 * sometimes ends the edit and sometimes does not is how a total gets typed into the
 * wrong cell.
 *
 * The field is `dir="ltr"` whatever the session language is. `=SUM(B2:B9)/12` is an
 * expression, not prose, and bidi reordering of it around an Arabic UI produces
 * something nobody can proofread.
 */
export function FormulaBar({ range, cell, value, editing, onGo, onBegin, onChange, onCommit, onCancel }: FormulaBarProps) {
  const { lang, tr } = useApp().locale;
  const [pick, setPick] = useState(0);

  const shown = isFormula(cell.input) ? cell.input : literalText(value, cell.format, lang);
  const text = editing ?? shown;
  const list = editing === null ? [] : completions(editing);
  const signature = editing === null ? null : signatureOf(editing);
  const at = list.length === 0 ? -1 : Math.min(Math.max(pick, 0), list.length - 1);

  const take = (name: string): void => {
    onChange(accept(text, name));
    setPick(0);
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (at >= 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setPick((current) => (current + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
      return;
    }
    if (event.key === 'Tab' && at >= 0) {
      event.preventDefault();
      take(list[at]);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      onCommit(event.shiftKey ? -1 : 1, 0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flex: 'none',
        padding: '5px 8px',
        background: 'var(--fx-solid-alt)',
        borderBottom: '1px solid var(--fx-divider)',
      }}
    >
      <NameBox label={formatRange(range)} onGo={onGo} />
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          width: 22,
          textAlign: 'center',
          fontFamily: 'var(--fx-font-mono)',
          fontStyle: 'italic',
          color: 'var(--fx-text-secondary)',
        }}
      >
        fx
      </span>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <input
          className="fx-input fx-input-mono"
          style={{ width: '100%' }}
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
          value={text}
          aria-label={tr('شريط الصيغة', 'Barre de formule', 'Formula bar')}
          onFocus={() => {
            if (editing === null) onBegin();
          }}
          onChange={(event) => {
            if (editing === null) onBegin();
            setPick(0);
            onChange(event.currentTarget.value);
          }}
          onKeyDown={keys}
        />
        {at >= 0 ? <Completions list={list} at={at} onPick={take} onHover={setPick} /> : null}
        {at < 0 && signature !== null ? <Signature text={signature} /> : null}
      </div>
    </div>
  );
}

export interface TabsProps {
  readonly sheets: readonly Sheet[];
  readonly index: number;
  readonly onSelect: (at: number) => void;
  readonly onAdd: () => void;
  readonly onRename: (at: number, name: string) => void;
  readonly onClose: (at: number) => void;
  readonly onMove: (from: number, to: number) => void;
}

/**
 * The sheet tabs, along the bottom where a spreadsheet keeps them.
 *
 * Double-click renames in place rather than opening a dialog, and dragging a tab
 * moves it — both because the name is part of the model (a formula says `Sheet2!A1`)
 * and because a rename is one undo step, which is only tolerable if making one is
 * this cheap.
 */
export function SheetTabs({ sheets, index, onSelect, onAdd, onRename, onClose, onMove }: TabsProps) {
  const { tr } = useApp().locale;
  const [renaming, setRenaming] = useState<{ readonly at: number; readonly draft: string } | null>(null);
  const from = useRef<number | null>(null);

  const commit = (): void => {
    if (renaming !== null) onRename(renaming.at, renaming.draft);
    setRenaming(null);
  };

  return (
    <div
      className="fx-scroll"
      role="tablist"
      aria-label={tr('الأوراق', 'Feuilles', 'Sheets')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flex: 'none',
        padding: '3px 6px',
        overflowX: 'auto',
        background: 'var(--fx-solid-alt)',
        borderTop: '1px solid var(--fx-divider)',
      }}
    >
      {sheets.map((sheet, at) => {
        if (renaming !== null && renaming.at === at) {
          return (
            <Input
              key={sheet.name}
              value={renaming.draft}
              onChange={(next) => setRenaming({ at, draft: next })}
              onEnter={commit}
              onEscape={() => setRenaming(null)}
              onBlur={commit}
              autoFocus
              style={{ width: 150, height: 26, flex: 'none' }}
              aria-label={tr('اسم الورقة', 'Nom de la feuille', 'Sheet name')}
            />
          );
        }
        const active = at === index;
        return (
          <div
            key={sheet.name}
            draggable
            onDragStart={() => {
              from.current = at;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              const source = from.current;
              from.current = null;
              if (source !== null && source !== at) onMove(source, at);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flex: 'none',
              height: 26,
              paddingInline: '10px 4px',
              maxWidth: 200,
              borderRadius: 'var(--fx-radius-control)',
              background: active ? 'var(--fx-card)' : 'transparent',
              boxShadow: active ? 'inset 0 -2px 0 0 var(--fx-accent)' : undefined,
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(at)}
              onDoubleClick={() => setRenaming({ at, draft: sheet.name })}
              title={tr('نقر مزدوج لإعادة التسمية', 'Double-cliquer pour renommer', 'Double-click to rename')}
              style={{
                minWidth: 0,
                fontSize: 'var(--fx-caption)',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--fx-text-primary)' : 'var(--fx-text-secondary)',
              }}
            >
              <span className="fx-title-ellipsis">{sheet.name}</span>
            </button>
            {sheets.length > 1 ? (
              <button
                type="button"
                onClick={() => onClose(at)}
                aria-label={tr('حذف الورقة', 'Supprimer la feuille', 'Delete sheet')}
                style={{
                  flex: 'none',
                  display: 'grid',
                  placeItems: 'center',
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  color: 'var(--fx-text-tertiary)',
                }}
              >
                <X size={11} />
              </button>
            ) : null}
          </div>
        );
      })}
      <IconButton icon={Plus} label={tr('ورقة جديدة', 'Nouvelle feuille', 'New sheet')} onClick={onAdd} size={15} />
    </div>
  );
}

export interface StatusProps {
  readonly calc: Calculated;
  readonly index: number;
  readonly range: CellRange;
  readonly cell: Cell;
  readonly path: string | null;
  readonly busy: boolean;
}

/**
 * The status bar.
 *
 * The address first, then what the selection adds up to — which is the one number a
 * person selects a column to see, and the reason this bar exists at all rather than
 * a menu item called Statistics.
 */
export function SheetsStatus({ calc, index, range, cell, path, busy }: StatusProps) {
  const { t, tr, lang } = useApp().locale;
  const stats = useMemo(() => summarize(calc, index, range), [calc, index, range]);
  const cells = rangeSize(range);

  return (
    <>
      <StatusItem title={tr('التحديد', 'Sélection', 'Selection')}>
        <span className="fx-mono">{formatRange(range)}</span>
      </StatusItem>
      {cells > 1 ? (
        <StatusItem title={tr('عدد الخلايا المحددة', 'Cellules sélectionnées', 'Cells selected')}>
          {tr(
            `${fmt.integer(cells, lang)} خلية`,
            `${fmt.integer(cells, lang)} cellules`,
            `${fmt.integer(cells, lang)} cells`,
          )}
        </StatusItem>
      ) : null}
      {stats.numbers > 0 ? (
        <StatusItem tone="accent" title={tr('المجموع', 'Somme', 'Sum')}>
          {`Σ ${fmt.amount(stats.sum, lang)}`}
        </StatusItem>
      ) : null}
      {stats.average !== null ? (
        <StatusItem title={tr('المتوسط', 'Moyenne', 'Average')}>
          {tr(
            `المتوسط ${fmt.amount(stats.average, lang)}`,
            `Moyenne ${fmt.amount(stats.average, lang)}`,
            `Avg ${fmt.amount(stats.average, lang)}`,
          )}
        </StatusItem>
      ) : null}
      {stats.count > 0 ? (
        <StatusItem title={tr('خلايا غير فارغة', 'Cellules non vides', 'Non-empty cells')}>
          {tr(
            `${fmt.integer(stats.count, lang)} معمورة · ${fmt.integer(stats.numbers, lang)} رقمية`,
            `${fmt.integer(stats.count, lang)} remplies · ${fmt.integer(stats.numbers, lang)} nombres`,
            `${fmt.integer(stats.count, lang)} filled · ${fmt.integer(stats.numbers, lang)} numeric`,
          )}
        </StatusItem>
      ) : null}
      {stats.capped ? (
        <StatusItem
          tone="warning"
          title={tr(
            'التحديد أكبر من أن يُحسب بالكامل',
            'Sélection trop grande pour être totalisée entièrement',
            'The selection is too large to total in full',
          )}
        >
          {tr('إحصاء جزئي', 'Total partiel', 'Partial total')}
        </StatusItem>
      ) : null}
      <ToolbarSpacer />
      {busy ? <StatusItem tone="accent">{tr('جارٍ الحفظ…', 'Enregistrement…', 'Saving…')}</StatusItem> : null}
      <StatusItem title={tr('تنسيق الأرقام', 'Format numérique', 'Number format')}>{t(FORMAT_LABEL[cell.format])}</StatusItem>
      {path === null ? null : (
        <StatusItem title={path}>
          <span
            style={{
              display: 'inline-block',
              maxWidth: 300,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {path}
          </span>
        </StatusItem>
      )}
    </>
  );
}
