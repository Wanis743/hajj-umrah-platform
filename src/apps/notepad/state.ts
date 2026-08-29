/**
 * Notepad — editor behaviour.
 *
 * Everything the window does that is not a document: the caret, zoom, word wrap,
 * the Find & Replace session, and the one command router that the menu strip, the
 * toolbar, the keyboard and the shell's palette all arrive through. Documents and
 * the volume live in `documents.ts`; this file never touches `fs.*`.
 *
 * Word wrap and font size are persisted with `useSetting`, which writes under
 * `HKCU` — a per-user preference the kernel exempts from the elevation gate, so
 * remembering them costs no consent dialog. What is deliberately *not* persisted
 * is the open tab list: a saved session would have this app read files at boot
 * that the person may no longer expect it to hold open.
 */
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useSetting } from '@/platform/sdk';
import { type Doc, isDirty, useDocuments } from './documents';
import {
  type Caret,
  type FindOptions,
  type Match,
  type TextStats,
  caretAt,
  matchesOf,
  nextMatch,
  prevMatch,
  replaceAll,
  statsOf,
} from './text';

/**
 * Zoom is a ladder of sizes rather than ±1px, so every step is a visible change
 * and the ends are reachable. `Ctrl+0` returns to 14px, which is 100%.
 */
const FONT_LADDER: readonly number[] = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 30];
const FONT_BASE = 14;
const ALL_OFF: FindOptions = { matchCase: false, wholeWord: false, wrap: true };

/**
 * Keyboard to command id. Notepad's accelerators are muscle memory, so they are
 * spelled out rather than left to the shell: F3 repeats a find, F5 stamps the
 * time, and Ctrl+0 undoes an afternoon of zooming.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F3') return 'findNext';
  if (event.key === 'F5') return 'insertDate';
  if (!event.ctrlKey && !event.metaKey) return null;
  switch (event.key.toLowerCase()) {
    case 's':
      return 'save';
    case 'n':
      return 'new';
    case 'o':
      return 'open';
    case 'f':
      return 'find';
    case 'w':
      return 'closeTab';
    case '+':
    case '=':
      return 'zoomIn';
    case '-':
      return 'zoomOut';
    case '0':
      return 'zoomReset';
    default:
      return null;
  }
}

export function useNotepad() {
  const runtime = useApp();
  const { tr, intlLocale } = runtime.locale;
  const documents = useDocuments();
  const doc: Doc = documents.active;

  const area = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState<Match>({ start: 0, end: 0 });
  const [wrap, setWrap] = useSetting<boolean>('wordWrap', true);
  const [fontSize, setFontSize] = useSetting<number>('fontSize', FONT_BASE);
  const [preview, setPreview] = useState(false);
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<FindOptions>(ALL_OFF);

  const caret: Caret = useMemo(() => caretAt(doc.text, range.start, range.end), [doc.text, range.start, range.end]);
  const stats: TextStats = useMemo(() => statsOf(doc.text), [doc.text]);
  const matches = useMemo(() => matchesOf(doc.text, needle, options), [doc.text, needle, options]);
  /** Which hit Find Next will land on — and, after it lands, which one you are on. */
  const ahead = matches.findIndex((match) => match.start >= range.start);
  const current = matches.length === 0 ? 0 : ahead === -1 ? matches.length : ahead + 1;

  /**
   * A caret move requested by code rather than by the pointer. It is applied in an
   * effect, after React has committed the text, and it does *not* steal focus while
   * the Find dialog is open — Enter belongs to the search box there, and taking
   * focus would put a newline in the document instead of finding the next match.
   */
  const pending = useRef<Match | null>(null);
  const [nudge, setNudge] = useState(0);
  const point = useCallback((start: number, end: number) => {
    pending.current = { start, end };
    setRange({ start, end });
    setNudge((count) => count + 1);
  }, []);

  useEffect(() => {
    const element = area.current;
    const target = pending.current;
    if (element === null || target === null) return;
    pending.current = null;
    element.setSelectionRange(target.start, target.end);
    if (finding) {
      // Nudge the view instead: the dialog keeps focus, so nothing scrolls on its own.
      const line = caretAt(element.value, target.start, target.start).line;
      element.scrollTop = Math.max(0, (line - 4) * fontSize * 1.55);
    } else element.focus();
  }, [nudge, finding, fontSize]);

  const find = useCallback(
    (direction: -1 | 1) => {
      const from = direction === 1 ? range.end : range.start;
      const hit = direction === 1 ? nextMatch(matches, from, options.wrap) : prevMatch(matches, from, options.wrap);
      if (hit !== null) point(hit.start, hit.end);
    },
    [matches, options.wrap, range.end, range.start, point],
  );

  const replaceOne = useCallback(() => {
    const hit = matches[Math.max(current - 1, 0)];
    if (hit === undefined || doc.readOnly) return;
    documents.edit(doc.text.slice(0, hit.start) + replacement + doc.text.slice(hit.end));
    point(hit.start + replacement.length, hit.start + replacement.length);
  }, [matches, current, doc, documents, replacement, point]);

  const replaceEvery = useCallback(() => {
    if (doc.readOnly) return;
    const result = replaceAll(doc.text, needle, replacement, options);
    if (result.count === 0) return;
    documents.edit(result.text);
    void runtime.toast({
      kind: 'success',
      title: tr(
        `تم استبدال ${result.count} موضعًا`,
        `${result.count} occurrences remplacées`,
        `Replaced ${result.count} occurrences`,
      ),
    });
  }, [doc, documents, needle, replacement, options, runtime, tr]);

  /** Insert at the caret, replacing whatever is selected — Time/Date and paste. */
  const insert = useCallback(
    (text: string) => {
      if (doc.readOnly) return;
      documents.edit(doc.text.slice(0, range.start) + text + doc.text.slice(range.end));
      point(range.start + text.length, range.start + text.length);
    },
    [doc, documents, range, point],
  );

  const zoom = useCallback(
    (step: number) => {
      if (step === 0) {
        setFontSize(FONT_BASE);
        return;
      }
      const known = FONT_LADDER.indexOf(fontSize);
      const from = known === -1 ? FONT_LADDER.indexOf(FONT_BASE) : known;
      const next = Math.min(Math.max(from + step, 0), FONT_LADDER.length - 1);
      setFontSize(FONT_LADDER[next] ?? FONT_BASE);
    },
    [fontSize, setFontSize],
  );

  const copyAll = useCallback(() => {
    void runtime.invoke('shell.clipboardWrite', { text: doc.text }).then((result) =>
      runtime.toast({
        kind: result.ok ? 'success' : 'error',
        title: result.ok ? tr('نُسخ المستند', 'Document copié', 'Document copied') : result.error.message,
      }),
    );
  }, [runtime, doc.text, tr]);

  const selectAll = useCallback(() => point(0, doc.text.length), [point, doc.text.length]);

  const canPreview = doc.contentType === 'text/markdown';

  /** One router for the menu strip, the toolbar, the keyboard and the palette. */
  const command = useCallback(
    (id: string) => {
      if (id === 'new') documents.openBlank();
      else if (id === 'open') documents.openDialog();
      else if (id === 'save') documents.save();
      else if (id === 'saveAs') documents.saveAs();
      else if (id === 'closeTab') documents.close(doc.id);
      else if (id === 'find') setFinding(true);
      else if (id === 'findNext') find(1);
      else if (id === 'selectAll') selectAll();
      else if (id === 'copyAll') copyAll();
      else if (id === 'insertDate') insert(new Date().toLocaleString(intlLocale));
      else if (id === 'wrap') setWrap(!wrap);
      else if (id === 'preview') setPreview(canPreview && !preview);
      else if (id === 'zoomIn') zoom(1);
      else if (id === 'zoomOut') zoom(-1);
      else if (id === 'zoomReset') zoom(0);
    },
    [documents, doc.id, find, selectAll, copyAll, insert, intlLocale, wrap, setWrap, canPreview, preview, zoom],
  );

  return {
    documents,
    doc,
    area,
    caret,
    stats,
    dirty: isDirty(doc),
    anyDirty: documents.docs.some(isDirty),
    wrap,
    fontSize,
    zoomPercent: Math.round((fontSize / FONT_BASE) * 100),
    preview: preview && canPreview,
    canPreview,
    finding,
    needle,
    replacement,
    options,
    matches: matches.length,
    current,
    command,
    find,
    replaceOne,
    replaceEvery,
    setNeedle,
    setReplacement,
    setOptions,
    setRange,
    /** Closing the search hands focus back to the text, on the last match found. */
    closeFind: () => {
      setFinding(false);
      point(range.start, range.end);
    },
  };
}
