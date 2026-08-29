/**
 * Notepad — documents, tabs and the volume.
 *
 * The tab model and the two syscalls that back it (`fs.readText`, `fs.writeText`),
 * with the dialogs the kernel provides in place of an app-drawn file browser.
 *
 * Three decisions worth stating, because each is a fidelity choice rather than an
 * implementation detail:
 *
 *   • Opening a path that is already in a tab selects that tab. Two tabs on one
 *     file would let a person save one over the other and see no warning.
 *   • Closing the last tab closes the window, the way Notepad does. The window is
 *     the last document; there is nothing left to look at.
 *   • Unsaved work is confirmed here, in the app, because `fs.write` is not a
 *     privileged capability — the kernel raises no consent dialog for it, so if
 *     this app does not ask, nothing does. The ABI has a two-button box, not the
 *     three-button Save/Don't-save/Cancel of Win32, so the question asked is the
 *     destructive one: discard. Saving stays a button on the toolbar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_ACTIVATED, type VfsContentType, useApp, useIpc } from '@/platform/sdk';
import { contentTypeForName } from '../shared/fileIcons';
import { DOCUMENTS, basename, dirname } from '../shared/paths';
import { type Eol, detectEol, fromLf, toLf } from './text';

/** What the Open dialog offers to filter by; everything here is text. */
const TEXTUAL: readonly VfsContentType[] = ['text/plain', 'text/markdown', 'application/json', 'text/csv'];

export interface Doc {
  /** Stable across renames, so the tab strip keeps its identity on Save As. */
  readonly id: string;
  /** `null` until the document has been saved somewhere. */
  readonly path: string | null;
  readonly name: string;
  /** The buffer, always LF; `eol` remembers what the file on disk used. */
  readonly text: string;
  /** Last text written to (or read from) the volume — the dirty comparison. */
  readonly saved: string;
  readonly eol: Eol;
  /** The ending the saved copy carries, so switching CRLF↔LF counts as an edit. */
  readonly savedEol: Eol;
  readonly readOnly: boolean;
  readonly contentType: VfsContentType;
}

export const isDirty = (doc: Doc): boolean => doc.text !== doc.saved || doc.eol !== doc.savedEol;

let sequence = 0;
const nextId = (): string => {
  sequence += 1;
  return `doc-${sequence}`;
};

function blank(name: string): Doc {
  return {
    id: nextId(),
    path: null,
    name,
    text: '',
    saved: '',
    eol: 'CRLF',
    savedEol: 'CRLF',
    readOnly: false,
    contentType: 'text/plain',
  };
}

/** Unreachable — the tab list is never empty — but it keeps `active` a `Doc`. */
const VOID_DOC: Doc = {
  id: 'doc-0',
  path: null,
  name: '',
  text: '',
  saved: '',
  eol: 'CRLF',
  savedEol: 'CRLF',
  readOnly: false,
  contentType: 'text/plain',
};

/**
 * A lone untouched blank tab gives way to the file being opened instead of
 * sitting beside it. This is the launch case: an app started by double-clicking
 * a file should show that file, not it and an empty page.
 */
function admit(current: readonly Doc[], doc: Doc): readonly Doc[] {
  const first = current[0];
  const pristine = current.length === 1 && first !== undefined && first.path === null && first.text === '';
  return pristine ? [doc] : [...current, doc];
}

export interface Documents {
  readonly docs: readonly Doc[];
  readonly active: Doc;
  readonly busy: boolean;
  readonly select: (id: string) => void;
  readonly edit: (text: string) => void;
  readonly setEol: (eol: Eol) => void;
  readonly openBlank: () => void;
  readonly openDialog: () => void;
  readonly save: () => void;
  readonly saveAs: () => void;
  readonly close: (id: string) => void;
}

export function useDocuments(): Documents {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const untitled = tr('مستند جديد', 'Sans titre', 'Untitled');
  const [docs, setDocs] = useState<readonly Doc[]>(() => [blank(untitled)]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = docs.find((doc) => doc.id === activeId) ?? docs[0] ?? VOID_DOC;

  const patch = useCallback((id: string, change: (doc: Doc) => Doc) => {
    setDocs((current) => current.map((doc) => (doc.id === id ? change(doc) : doc)));
  }, []);

  /** `Untitled`, then `Untitled 2` — numbered only once the name is taken. */
  const freeName = useCallback(
    (current: readonly Doc[]): string => {
      const taken = new Set(current.map((doc) => doc.name.toLowerCase()));
      let name = untitled;
      for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${untitled} ${n}`;
      return name;
    },
    [untitled],
  );

  const openBlank = useCallback(() => {
    const doc = blank(freeName(docs));
    setDocs((current) => [...current, doc]);
    setActiveId(doc.id);
  }, [docs, freeName]);

  const openPath = useCallback(
    async (path: string): Promise<void> => {
      const already = docs.find((doc) => doc.path !== null && doc.path.toLowerCase() === path.toLowerCase());
      if (already !== undefined) {
        setActiveId(already.id);
        return;
      }
      setBusy(true);
      const result = await runtime.invoke('fs.readText', { path });
      setBusy(false);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message, body: path });
        return;
      }
      const { content, stat } = result.value;
      const body = toLf(content);
      const doc: Doc = {
        id: nextId(),
        path: stat.path,
        name: stat.name,
        text: body,
        saved: body,
        eol: detectEol(content),
        savedEol: detectEol(content),
        readOnly: stat.readOnly,
        contentType: stat.contentType,
      };
      setDocs((current) => admit(current, doc));
      setActiveId(doc.id);
    },
    [docs, runtime],
  );

  const openDialog = useCallback(() => {
    void runtime
      .invoke('shell.fileDialog', {
        mode: 'open',
        title: tr('فتح ملف', 'Ouvrir un fichier', 'Open file'),
        startPath: DOCUMENTS,
        contentTypes: TEXTUAL,
      })
      .then((dialog) => {
        if (dialog.ok && dialog.value.path !== null) void openPath(dialog.value.path);
      });
  }, [runtime, tr, openPath]);

  /**
   * `saved` records the text that was written, not the text as it is now: an edit
   * made while the write was in flight leaves the tab correctly dirty.
   */
  const persist = useCallback(
    async (doc: Doc, path: string, contentType: VfsContentType): Promise<void> => {
      setBusy(true);
      const result = await runtime.invoke('fs.writeText', { path, content: fromLf(doc.text, doc.eol), contentType });
      setBusy(false);
      if (!result.ok) {
        void runtime.toast({ kind: 'error', title: result.error.message, body: path });
        return;
      }
      const stat = result.value;
      patch(doc.id, (current) => ({
        ...current,
        path: stat.path,
        name: stat.name,
        contentType: stat.contentType,
        readOnly: stat.readOnly,
        saved: doc.text,
        savedEol: doc.eol,
      }));
      void runtime.toast({ kind: 'success', title: tr('حُفظ الملف', 'Fichier enregistré', 'File saved'), body: stat.path });
    },
    [runtime, patch, tr],
  );

  const saveAs = useCallback(() => {
    void runtime
      .invoke('shell.fileDialog', {
        mode: 'save',
        title: tr('حفظ باسم', 'Enregistrer sous', 'Save as'),
        startPath: active.path === null ? DOCUMENTS : dirname(active.path),
        suggestedName: active.path === null ? `${active.name}.txt` : basename(active.path),
      })
      .then((dialog) => {
        if (dialog.ok && dialog.value.path !== null) {
          void persist(active, dialog.value.path, contentTypeForName(dialog.value.path));
        }
      });
  }, [active, runtime, tr, persist]);

  const save = useCallback(() => {
    if (active.path === null) saveAs();
    else void persist(active, active.path, active.contentType);
  }, [active, persist, saveAs]);

  const close = useCallback(
    (id: string) => {
      const run = async () => {
        const doc = docs.find((entry) => entry.id === id);
        if (doc === undefined) return;
        if (isDirty(doc)) {
          const agreed = await runtime.confirm({
            kind: 'warning',
            destructive: true,
            title: tr('إغلاق دون حفظ؟', 'Fermer sans enregistrer ?', 'Close without saving?'),
            body: tr(
              `تغييراتك في ${doc.name} ستُفقد. أَلغِ ثم احفظ إن أردت الاحتفاظ بها.`,
              `Vos modifications de ${doc.name} seront perdues. Annulez puis enregistrez pour les garder.`,
              `Your changes to ${doc.name} will be lost. Cancel and save if you want to keep them.`,
            ),
            confirmLabel: { ar: 'تجاهل', fr: 'Ignorer', en: 'Discard' },
          });
          if (!agreed) return;
        }
        // The window is the last document; closing it is what Notepad does here.
        if (docs.length <= 1) {
          void runtime.close();
          return;
        }
        const index = docs.findIndex((entry) => entry.id === id);
        const rest = docs.filter((entry) => entry.id !== id);
        setDocs(rest);
        if (id === active.id) setActiveId((rest[Math.max(index - 1, 0)] ?? rest[0] ?? VOID_DOC).id);
      };
      void run();
    },
    [docs, active, runtime, tr],
  );

  // A file association launch arrives as `path`; it opens once per process.
  const launched = useRef(false);
  useEffect(() => {
    const path = runtime.args.path;
    if (launched.current || path === undefined || path === '') return;
    launched.current = true;
    void openPath(path);
  }, [runtime, openPath]);

  /**
   * Second launch of a single-instance app: the kernel re-activates this process
   * and posts the new args instead of spawning another Notepad. That is what turns
   * "open another file from the desktop" into another tab in this window.
   */
  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const path = payload?.args?.path;
    if (path !== undefined && path !== '') void openPath(path);
  });

  return {
    docs,
    active,
    busy,
    select: setActiveId,
    edit: (text: string) => patch(active.id, (doc) => ({ ...doc, text })),
    setEol: (eol: Eol) => patch(active.id, (doc) => ({ ...doc, eol })),
    openBlank,
    openDialog,
    save,
    saveAs,
    close,
  };
}
