/**
 * Terminal chrome — the toolbar, the status bar and the console surface itself.
 *
 * None of it holds shell state. The scrollback arrives as an array, the prompt is
 * a controlled input, and every key that means something is handed back out as a
 * verb — so `App.tsx` is left holding the buffer, the history and the cwd, which
 * is all a console really is.
 *
 * The two refs that do live here are the ones nothing outside can use: the
 * scroller, because sticking to the bottom is a property of the view, and the
 * field, because clicking anywhere in a console focuses its prompt.
 */
import { useEffect, useRef } from 'react';
import { Copy, Eraser, FolderOpen, HelpCircle } from 'lucide-react';
import {
  type AppLocale,
  Button,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
} from '@/platform/sdk';
import type { LineKind, TerminalLine } from './shell';

/** One colour per line kind, so the console reads like a console. */
const TONE: Readonly<Record<LineKind, string>> = {
  input: 'var(--fx-text-primary)',
  output: 'var(--fx-text-secondary)',
  error: 'var(--fx-danger)',
  note: 'var(--fx-text-tertiary)',
  ok: 'var(--fx-success)',
};

/** The four one-word commands worth a button. Anything else you type. */
const QUICK: readonly string[] = ['ps', 'sc list', 'stat'];

export interface TerminalToolbarProps {
  readonly tr: AppLocale['tr'];
  readonly onRun: (line: string) => void;
  readonly onClear: () => void;
  readonly onCopy: () => void;
}

export function TerminalToolbar({ tr, onRun, onClear, onCopy }: TerminalToolbarProps) {
  return (
    <>
      <Button icon={Eraser} variant="subtle" size="sm" onClick={onClear} title={tr('مسح الشاشة', 'Effacer', 'Clear')} />
      <Button
        icon={HelpCircle}
        variant="subtle"
        size="sm"
        onClick={() => onRun('help')}
        title={tr('مساعدة', 'Aide', 'Help')}
      />
      <ToolbarSeparator />
      <Button icon={FolderOpen} variant="subtle" size="sm" onClick={() => onRun('dir')}>
        dir
      </Button>
      {QUICK.map((line) => (
        <Button key={line} variant="subtle" size="sm" onClick={() => onRun(line)}>
          {line}
        </Button>
      ))}
      <ToolbarSpacer />
      <Button
        icon={Copy}
        variant="subtle"
        size="sm"
        onClick={onCopy}
        title={tr('نسخ المخرجات', 'Copier la sortie', 'Copy output')}
      />
    </>
  );
}

export interface TerminalStatusProps {
  readonly tr: AppLocale['tr'];
  readonly cwd: string;
  readonly busy: boolean;
  readonly count: number;
}

/** Where you are, whether a command is running, and how deep the buffer is. */
export function TerminalStatus({ tr, cwd, busy, count }: TerminalStatusProps) {
  return (
    <>
      <StatusItem>{cwd}</StatusItem>
      <ToolbarSpacer />
      <StatusItem tone={busy ? 'accent' : 'neutral'}>
        {busy ? tr('يعمل…', 'Exécution…', 'Running…') : tr('جاهز', 'Prêt', 'Ready')}
      </StatusItem>
      <StatusItem>{tr(`${count} سطرًا`, `${count} ligne(s)`, `${count} lines`)}</StatusItem>
    </>
  );
}

export interface TerminalViewProps {
  readonly tr: AppLocale['tr'];
  readonly cwd: string;
  readonly lines: readonly TerminalLine[];
  readonly draft: string;
  readonly onDraft: (next: string) => void;
  readonly onSubmit: (line: string) => void;
  /** Tab. The caller owns the command table, so it owns completion. */
  readonly onComplete: () => void;
  /** −1 for the previous command, +1 for the next. */
  readonly onRecall: (delta: number) => void;
  readonly onClear: () => void;
}

/**
 * The console: scrollback above, prompt below.
 *
 * It sticks to the bottom the way a real console does — a new line scrolls the
 * view, and only the view, because the buffer it is showing belongs to the app.
 */
export function TerminalView({
  tr,
  cwd,
  lines,
  draft,
  onDraft,
  onSubmit,
  onComplete,
  onRecall,
  onClear,
}: TerminalViewProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const element = scroller.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <div
      onClick={() => field.current?.focus()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--fx-solid-alt)',
        fontFamily: 'var(--fx-font-mono)',
        fontSize: 'var(--fx-caption)',
      }}
    >
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 12px' }}>
        {lines.map((line) => (
          <div
            key={line.id}
            style={{ color: TONE[line.kind], whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}
          >
            {line.text === '' ? ' ' : line.text}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderTop: '1px solid var(--fx-divider)',
          background: 'var(--fx-layer)',
        }}
      >
        <span style={{ color: 'var(--fx-accent-text)', whiteSpace: 'nowrap' }}>{`${cwd}>`}</span>
        <input
          ref={field}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit(draft);
            else if (event.key === 'Tab') {
              event.preventDefault();
              onComplete();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              onRecall(-1);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              onRecall(1);
            } else if (event.key === 'l' && event.ctrlKey) {
              event.preventDefault();
              onClear();
            }
          }}
          spellCheck={false}
          autoFocus
          aria-label={tr('سطر الأوامر', 'Ligne de commande', 'Command line')}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--fx-text-primary)',
            font: 'inherit',
          }}
        />
      </div>
    </div>
  );
}
