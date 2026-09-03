/**
 * Notepad — chrome.
 *
 * Tabs, the menu strip, the editor surface, the status bar, Find & Replace and
 * the Markdown preview. Nothing here talks to the kernel; every one of these is a
 * function of props, which is why the editor can be looked at without a running OS.
 *
 * The editor is a raw `<textarea>` rather than the kit's `TextArea`. That is not
 * a slight against the kit — it is that a text editor needs the three things the
 * kit deliberately does not expose: a ref (to move the caret after a replace),
 * `onSelect` (to report Ln/Col), and control of wrapping. It still wears
 * `fx-input fx-input-mono`, so it inherits the same typography and focus
 * behaviour as every other field in the OS.
 */
import { type ReactNode, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FileDown,
  FilePlus2,
  FolderOpen,
  Plus,
  Save,
  Search,
  WrapText,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
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
import type { Doc } from './documents';
import { type Caret, type Eol, type FindOptions, type TextStats, inlines, markdownBlocks } from './text';

export interface TabStripProps {
  readonly docs: readonly Doc[];
  readonly activeId: string;
  readonly dirtyOf: (doc: Doc) => boolean;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onNew: () => void;
}

/** The tab row. A modified tab shows the shell's own dirty dot, not an asterisk. */
export function TabStrip({ docs, activeId, dirtyOf, onSelect, onClose, onNew }: TabStripProps) {
  const { tr } = useApp().locale;
  return (
    <div
      className="fx-scroll"
      role="tablist"
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
        padding: '4px 6px 0',
        overflowX: 'auto',
        borderBottom: '1px solid var(--fx-divider)',
        flex: 'none',
      }}
    >
      {docs.map((doc) => {
        const active = doc.id === activeId;
        return (
          <div
            key={doc.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: 30,
              paddingInline: '10px 6px',
              borderRadius: '6px 6px 0 0',
              background: active ? 'var(--fx-card)' : 'transparent',
              borderTop: `2px solid ${active ? 'var(--fx-accent)' : 'transparent'}`,
              maxWidth: 220,
              flex: 'none',
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(doc.id)}
              title={doc.path ?? doc.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                fontSize: 'var(--fx-caption)',
                color: active ? 'var(--fx-text-primary)' : 'var(--fx-text-secondary)',
              }}
            >
              {dirtyOf(doc) ? <span className="fx-dirty-dot" /> : null}
              <span className="fx-title-ellipsis">{doc.name}</span>
            </button>
            <button
              type="button"
              onClick={() => onClose(doc.id)}
              aria-label={tr('إغلاق علامة التبويب', 'Fermer l’onglet', 'Close tab')}
              style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 18, height: 18, borderRadius: 4, color: 'var(--fx-text-tertiary)' }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <IconButton icon={Plus} label={tr('علامة تبويب جديدة', 'Nouvel onglet', 'New tab')} onClick={onNew} size={15} />
    </div>
  );
}

export interface MenusProps {
  readonly wrap: boolean;
  readonly preview: boolean;
  /** Preview is offered for Markdown only; elsewhere the entry is disabled. */
  readonly canPreview: boolean;
  readonly onCommand: (id: string) => void;
}

/**
 * The menu strip. Notepad's menus are the reason a generation knows where Word
 * Wrap lives, so the names and the order are kept: File, Edit, View — with
 * Insert Time/Date still on F5, where it has been since 1985.
 */
export function NotepadMenus({ wrap, preview, canPreview, onCommand }: MenusProps) {
  const { tr } = useApp().locale;
  return (
    <MenuBar
      onSelect={(_menu, entryId) => onCommand(entryId)}
      menus={[
        {
          id: 'file',
          label: tr('ملف', 'Fichier', 'File'),
          entries: [
            { id: 'new', label: tr('جديد', 'Nouveau', 'New'), icon: FilePlus2, accelerator: 'Ctrl+N' },
            { id: 'open', label: tr('فتح…', 'Ouvrir…', 'Open…'), icon: FolderOpen, accelerator: 'Ctrl+O' },
            { id: 'sep0', kind: 'separator' },
            { id: 'save', label: tr('حفظ', 'Enregistrer', 'Save'), icon: Save, accelerator: 'Ctrl+S' },
            { id: 'saveAs', label: tr('حفظ باسم…', 'Enregistrer sous…', 'Save as…'), icon: FileDown },
            { id: 'sep1', kind: 'separator' },
            { id: 'closeTab', label: tr('إغلاق علامة التبويب', 'Fermer l’onglet', 'Close tab'), icon: X, accelerator: 'Ctrl+W' },
          ],
        },
        {
          id: 'edit',
          label: tr('تحرير', 'Édition', 'Edit'),
          entries: [
            { id: 'find', label: tr('بحث واستبدال…', 'Rechercher et remplacer…', 'Find and replace…'), icon: Search, accelerator: 'Ctrl+F' },
            { id: 'sep0', kind: 'separator' },
            { id: 'selectAll', label: tr('تحديد الكل', 'Tout sélectionner', 'Select all'), accelerator: 'Ctrl+A' },
            { id: 'copyAll', label: tr('نسخ المستند', 'Copier le document', 'Copy document') },
            { id: 'sep1', kind: 'separator' },
            { id: 'insertDate', label: tr('إدراج التاريخ والوقت', 'Insérer date et heure', 'Time/Date'), accelerator: 'F5' },
          ],
        },
        {
          id: 'view',
          label: tr('عرض', 'Affichage', 'View'),
          entries: [
            { id: 'wrap', label: tr('التفاف النص', 'Retour à la ligne', 'Word wrap'), checked: wrap },
            { id: 'preview', label: tr('معاينة Markdown', 'Aperçu Markdown', 'Markdown preview'), checked: preview, disabled: !canPreview },
            { id: 'sep0', kind: 'separator' },
            { id: 'zoomIn', label: tr('تكبير', 'Agrandir', 'Zoom in'), accelerator: 'Ctrl++' },
            { id: 'zoomOut', label: tr('تصغير', 'Réduire', 'Zoom out'), accelerator: 'Ctrl+-' },
            { id: 'zoomReset', label: tr('حجم افتراضي', 'Taille par défaut', 'Restore default zoom') },
          ],
        },
      ]}
    />
  );
}

export interface ToolbarProps {
  readonly wrap: boolean;
  readonly saving: boolean;
  readonly readOnly: boolean;
  readonly dirty: boolean;
  readonly onCommand: (id: string) => void;
}

export function NotepadToolbar({ wrap, saving, readOnly, dirty, onCommand }: ToolbarProps) {
  const { tr } = useApp().locale;
  return (
    <>
      <Button size="sm" icon={Save} onClick={() => onCommand('save')} busy={saving} disabled={readOnly || !dirty}>
        {tr('حفظ', 'Enregistrer', 'Save')}
      </Button>
      <Button size="sm" variant="subtle" icon={FolderOpen} onClick={() => onCommand('open')}>
        {tr('فتح', 'Ouvrir', 'Open')}
      </Button>
      <Button size="sm" variant="subtle" icon={Search} onClick={() => onCommand('find')}>
        {tr('بحث', 'Rechercher', 'Find')}
      </Button>
      <ToolbarSeparator />
      <IconButton
        icon={WrapText}
        label={tr('التفاف النص', 'Retour à la ligne', 'Word wrap')}
        onClick={() => onCommand('wrap')}
        active={wrap}
      />
      <ToolbarSpacer />
      {readOnly ? (
        <Badge tone="warning" title={tr('الملف للقراءة فقط', 'Fichier en lecture seule', 'The file is read-only')}>
          {tr('للقراءة فقط', 'Lecture seule', 'Read-only')}
        </Badge>
      ) : null}
    </>
  );
}

export interface EditorProps {
  /**
   * Owned by the app so a replace can put the caret back on the match. Typed
   * `RefObject<HTMLTextAreaElement>` — the shape `useRef<HTMLTextAreaElement>(null)`
   * produces — because React 18's `RefObject` is covariant in its parameter, so a
   * `…<HTMLTextAreaElement | null>` ref is not what the `ref` prop accepts.
   */
  readonly area: RefObject<HTMLTextAreaElement>;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onCaret: (start: number, end: number) => void;
  readonly wrap: boolean;
  readonly fontSize: number;
  readonly readOnly: boolean;
}

/**
 * The writing surface.
 *
 * `whiteSpace: pre` with horizontal overflow is what Word Wrap Off actually means
 * — a long line runs off the edge and the view scrolls to follow it — and `pre-wrap`
 * is what it means on. Both are one property, which is why the setting has
 * survived every redesign of this app.
 */
export function Editor({ area, value, onChange, onCaret, wrap, fontSize, readOnly }: EditorProps) {
  const report = (element: HTMLTextAreaElement) => onCaret(element.selectionStart, element.selectionEnd);
  return (
    <textarea
      ref={area}
      className="fx-input fx-input-mono"
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      dir="auto"
      onChange={(event) => {
        onChange(event.currentTarget.value);
        report(event.currentTarget);
      }}
      onSelect={(event) => report(event.currentTarget)}
      onKeyUp={(event) => report(event.currentTarget)}
      onClick={(event) => report(event.currentTarget)}
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        resize: 'none',
        border: 'none',
        borderRadius: 0,
        background: 'transparent',
        padding: '10px 14px',
        fontSize,
        lineHeight: 1.55,
        tabSize: 4,
        whiteSpace: wrap ? 'pre-wrap' : 'pre',
        overflowWrap: wrap ? 'break-word' : 'normal',
        overflowX: wrap ? 'hidden' : 'auto',
        overflowY: 'auto',
      }}
    />
  );
}

export interface StatusProps {
  readonly caret: Caret;
  readonly stats: TextStats;
  readonly eol: Eol;
  readonly onEol: (eol: Eol) => void;
  readonly zoom: number;
  readonly path: string | null;
}

/** Ln/Col first, the way every editor's status bar is read left to right. */
export function NotepadStatus({ caret, stats, eol, onEol, zoom, path }: StatusProps) {
  const { tr, lang } = useApp().locale;
  return (
    <>
      <StatusItem title={tr('السطر والعمود', 'Ligne et colonne', 'Line and column')}>
        {tr(
          `سطر ${fmt.integer(caret.line, lang)}، عمود ${fmt.integer(caret.column, lang)}`,
          `Ligne ${fmt.integer(caret.line, lang)}, col. ${fmt.integer(caret.column, lang)}`,
          `Ln ${fmt.integer(caret.line, lang)}, Col ${fmt.integer(caret.column, lang)}`,
        )}
      </StatusItem>
      {caret.selected > 0 ? (
        <StatusItem tone="accent">
          {tr(
            `${fmt.integer(caret.selected, lang)} محدّد`,
            `${fmt.integer(caret.selected, lang)} sélectionnés`,
            `${fmt.integer(caret.selected, lang)} selected`,
          )}
        </StatusItem>
      ) : null}
      <StatusItem title={tr('كلمات وأحرف', 'Mots et caractères', 'Words and characters')}>
        {tr(
          `${fmt.integer(stats.words, lang)} كلمة · ${fmt.integer(stats.chars, lang)} حرف`,
          `${fmt.integer(stats.words, lang)} mots · ${fmt.integer(stats.chars, lang)} caractères`,
          `${fmt.integer(stats.words, lang)} words · ${fmt.integer(stats.chars, lang)} chars`,
        )}
      </StatusItem>
      <ToolbarSpacer />
      {path === null ? null : (
        <StatusItem title={path}>
          <span style={{ display: 'inline-block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {path}
          </span>
        </StatusItem>
      )}
      <StatusItem title={tr('نهاية السطر', 'Fin de ligne', 'Line ending')}>
        <Select
          value={eol}
          onChange={(next) => onEol(next === 'LF' ? 'LF' : 'CRLF')}
          width={104}
          options={[
            { value: 'CRLF', label: 'CRLF' },
            { value: 'LF', label: 'LF' },
          ]}
        />
      </StatusItem>
      <StatusItem title={tr('الترميز', 'Encodage', 'Encoding')}>UTF-8</StatusItem>
      <StatusItem>{`${fmt.integer(zoom, lang)}%`}</StatusItem>
    </>
  );
}

export interface FindReplaceProps {
  readonly needle: string;
  readonly onNeedle: (next: string) => void;
  readonly replacement: string;
  readonly onReplacement: (next: string) => void;
  readonly options: FindOptions;
  readonly onOptions: (next: FindOptions) => void;
  readonly total: number;
  /** One-based position of the hit the caret is on, or `0` when it is on none. */
  readonly current: number;
  readonly readOnly: boolean;
  readonly onFind: (direction: -1 | 1) => void;
  readonly onReplace: () => void;
  readonly onReplaceAll: () => void;
  readonly onClose: () => void;
}

/**
 * Find & Replace.
 *
 * The hits are positions in a buffer that is being edited, which is why this is a
 * cursor over the text rather than a list of results: an edit above a hit moves
 * every offset below it. So Notepad keeps Find Next / Find Previous and adds the
 * one thing Win32 never showed you — how many there are, and which one you are on.
 */
export function FindReplace({
  needle,
  onNeedle,
  replacement,
  onReplacement,
  options,
  onOptions,
  total,
  current,
  readOnly,
  onFind,
  onReplace,
  onReplaceAll,
  onClose,
}: FindReplaceProps) {
  const { tr, lang } = useApp().locale;
  const none = needle !== '' && total === 0;
  return (
    <Dialog
      open
      onClose={onClose}
      width={560}
      title={tr('بحث واستبدال', 'Rechercher et remplacer', 'Find and replace')}
      secondaryLabel={tr('إغلاق', 'Fermer', 'Close')}
      primary={{ label: tr('التالي', 'Suivant', 'Find next'), onClick: () => onFind(1), disabled: total === 0 }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <Field
          label={tr('البحث عن', 'Rechercher', 'Find what')}
          error={none ? tr('لا نتائج', 'Aucun résultat', 'No matches') : undefined}
        >
          <Input value={needle} onChange={onNeedle} onEnter={() => onFind(1)} onEscape={onClose} autoFocus mono />
        </Field>
        <Field label={tr('الاستبدال بـ', 'Remplacer par', 'Replace with')}>
          <Input value={replacement} onChange={onReplacement} onEscape={onClose} mono disabled={readOnly} />
        </Field>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Checkbox
            checked={options.matchCase}
            onChange={(next) => onOptions({ ...options, matchCase: next })}
            label={tr('مطابقة حالة الأحرف', 'Respecter la casse', 'Match case')}
          />
          <Checkbox
            checked={options.wholeWord}
            onChange={(next) => onOptions({ ...options, wholeWord: next })}
            label={tr('كلمة كاملة', 'Mot entier', 'Whole word')}
          />
          <Checkbox
            checked={options.wrap}
            onChange={(next) => onOptions({ ...options, wrap: next })}
            label={tr('الالتفاف حول المستند', 'Boucler', 'Wrap around')}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <StatusItem tone={total === 0 ? 'neutral' : 'accent'}>
            {total === 0
              ? tr('لا نتائج', 'Aucun résultat', 'No matches')
              : tr(
                  `${fmt.integer(current, lang)} من ${fmt.integer(total, lang)}`,
                  `${fmt.integer(current, lang)} sur ${fmt.integer(total, lang)}`,
                  `${fmt.integer(current, lang)} of ${fmt.integer(total, lang)}`,
                )}
          </StatusItem>
          <ToolbarSpacer />
          <IconButton
            icon={ArrowLeft}
            label={tr('السابق', 'Précédent', 'Find previous')}
            onClick={() => onFind(-1)}
            disabled={total === 0}
          />
          <IconButton
            icon={ArrowRight}
            label={tr('التالي', 'Suivant', 'Find next')}
            onClick={() => onFind(1)}
            disabled={total === 0}
          />
          <Button size="sm" variant="subtle" onClick={onReplace} disabled={readOnly || total === 0}>
            {tr('استبدال', 'Remplacer', 'Replace')}
          </Button>
          <Button size="sm" variant="subtle" onClick={onReplaceAll} disabled={readOnly || total === 0}>
            {tr('استبدال الكل', 'Tout remplacer', 'Replace all')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Inline spans of one block. Text is React children — never raw HTML. */
function spans(source: string): ReactNode {
  return inlines(source).map((run, index) => {
    const key = `${run.kind}-${index}`;
    if (run.kind === 'strong') return <strong key={key}>{run.text}</strong>;
    if (run.kind === 'em') return <em key={key}>{run.text}</em>;
    if (run.kind === 'code') {
      return (
        <code key={key} className="fx-mono" style={{ background: 'var(--fx-card-secondary)', padding: '1px 4px', borderRadius: 3 }}>
          {run.text}
        </code>
      );
    }
    return <span key={key}>{run.text}</span>;
  });
}

const HEADING_SIZE: readonly number[] = [1.7, 1.45, 1.25, 1.1, 1, 0.95];

export interface PreviewProps {
  readonly source: string;
  readonly fontSize: number;
}

/**
 * The Markdown pane.
 *
 * Rendered to React elements, never to `innerHTML`. A close note can be written
 * by anyone with write access to the volume, and a preview that evaluated its
 * input would make reading one an execution of it.
 */
export function MarkdownPreview({ source, fontSize }: PreviewProps) {
  return (
    <div
      className="fx-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: '12px 16px',
        display: 'grid',
        gap: 10,
        alignContent: 'start',
        fontSize,
        lineHeight: 1.6,
        color: 'var(--fx-text-primary)',
        borderInlineStart: '1px solid var(--fx-divider)',
      }}
    >
      {markdownBlocks(source).map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === 'heading') {
          return (
            <div
              key={key}
              style={{ fontSize: fontSize * (HEADING_SIZE[block.level - 1] ?? 1), fontWeight: 600, lineHeight: 1.25 }}
            >
              {spans(block.text)}
            </div>
          );
        }
        if (block.kind === 'rule') return <div key={key} style={{ height: 1, background: 'var(--fx-divider)' }} />;
        if (block.kind === 'code') {
          return (
            <pre
              key={key}
              className="fx-mono fx-scroll"
              style={{
                margin: 0,
                padding: 10,
                overflowX: 'auto',
                background: 'var(--fx-card-secondary)',
                border: '1px solid var(--fx-stroke)',
                borderRadius: 'var(--fx-radius-control)',
                fontSize: fontSize - 1,
              }}
            >
              {block.text}
            </pre>
          );
        }
        if (block.kind === 'quote') {
          return (
            <div
              key={key}
              style={{
                borderInlineStart: '3px solid var(--fx-accent)',
                paddingInlineStart: 10,
                color: 'var(--fx-text-secondary)',
              }}
            >
              {spans(block.text)}
            </div>
          );
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, at) => <li key={`item-${at}`}>{spans(item)}</li>);
          return block.ordered ? (
            <ol key={key} style={{ margin: 0, paddingInlineStart: 22 }}>
              {items}
            </ol>
          ) : (
            <ul key={key} style={{ margin: 0, paddingInlineStart: 22 }}>
              {items}
            </ul>
          );
        }
        return <div key={key}>{spans(block.text)}</div>;
      })}
    </div>
  );
}
