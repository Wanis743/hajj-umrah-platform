/**
 * Terminal — the surface.
 *
 * Keeps three things: the scrollback, the command history and the working
 * directory. The command table and every verb live in `shell.ts`; the toolbar,
 * the status bar and the console itself live in `chrome.tsx`. What is left here
 * is the buffer and the four keys that act on it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppFrame, type AppEntryProps, useAppCommands, useWindowTitle } from '@/platform/sdk';
import { HOME } from '../shared/paths';
import { TerminalStatus, TerminalToolbar, TerminalView } from './chrome';
import { COMMANDS, type LineKind, type ShellHost, type TerminalLine, completions, runCommandLine } from './shell';

/** Scrollback cap. Old lines are dropped, as in a real console buffer. */
const SCROLLBACK = 1000;

/** Recall depth. Long enough to be useful, short enough to stay a window. */
const HISTORY_LIMIT = 200;

export default function TerminalApp({ runtime }: AppEntryProps) {
  const { tr, t, lang } = runtime.locale;
  const [cwd, setCwd] = useState(runtime.args.path ?? HOME);
  const [lines, setLines] = useState<readonly TerminalLine[]>([]);
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<readonly string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);

  useWindowTitle(`${cwd} — ${tr('الطرفية', 'Terminal', 'Terminal')}`);

  const print = useCallback((text: string, kind: LineKind = 'output') => {
    setLines((current) => {
      const appended = [...current, { id: (nextId.current += 1), kind, text }];
      return appended.length > SCROLLBACK ? appended.slice(appended.length - SCROLLBACK) : appended;
    });
  }, []);

  const clear = useCallback(() => setLines([]), []);

  // The banner is the first thing a console prints, so it goes in an effect that
  // runs once rather than in initial state — `print` is the only writer.
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    print(tr('صدفة Finance OS — الإصدار 1.0', 'Shell Finance OS — version 1.0', 'Finance OS shell — version 1.0'), 'note');
    print(
      tr(
        `اكتب help لعرض ${COMMANDS.length} أمرًا متاحًا.`,
        `Tapez help pour voir les ${COMMANDS.length} commandes.`,
        `Type help to see the ${COMMANDS.length} available commands.`,
      ),
      'note',
    );
  }, [print, tr]);

  const host = useMemo<ShellHost>(
    () => ({
      cwd,
      lang,
      history,
      invoke: runtime.invoke,
      print,
      clear,
      chdir: (path) => setCwd(path),
      exit: () => void runtime.close(),
      tr,
      t,
    }),
    [clear, cwd, history, lang, print, runtime, t, tr],
  );

  const submit = useCallback(
    async (line: string) => {
      print(`${cwd}> ${line}`, 'input');
      setDraft('');
      setCursor(null);
      const trimmed = line.trim();
      if (trimmed !== '') {
        setHistory((current) => [...current.filter((entry) => entry !== trimmed), trimmed].slice(-HISTORY_LIMIT));
      }
      setBusy(true);
      try {
        await runCommandLine(line, host);
      } finally {
        setBusy(false);
      }
    },
    [cwd, host, print],
  );

  useAppCommands((command) => {
    if (command === 'clear') clear();
    else if (command === 'cwd:home') setCwd(HOME);
    else if (command === 'cwd:system') setCwd('C:\\Windows\\System32');
  });

  /** Tab completes the first word from the command table; nothing else guesses. */
  const complete = useCallback(() => {
    const words = draft.split(' ');
    if (words.length !== 1) return;
    const matches = completions(words[0]);
    if (matches.length === 1) setDraft(`${matches[0]} `);
    else if (matches.length > 1) print(matches.join('   '), 'note');
  }, [draft, print]);

  // Past the end of the list is the empty prompt, not the last command: that is
  // what makes Down a way out of the history rather than a wall.
  const recall = useCallback(
    (delta: number) => {
      if (history.length === 0) return;
      const at = cursor === null ? history.length : cursor;
      const next = Math.min(history.length, Math.max(0, at + delta));
      setCursor(next >= history.length ? null : next);
      setDraft(next >= history.length ? '' : history[next]);
    },
    [cursor, history],
  );

  return (
    <AppFrame
      scroll={false}
      commands={
        <TerminalToolbar
          tr={tr}
          onRun={(line) => void submit(line)}
          onClear={clear}
          onCopy={() =>
            void runtime.invoke('shell.clipboardWrite', { text: lines.map((line) => line.text).join('\n') })
          }
        />
      }
      status={<TerminalStatus tr={tr} cwd={cwd} busy={busy} count={lines.length} />}
    >
      <TerminalView
        tr={tr}
        cwd={cwd}
        lines={lines}
        draft={draft}
        onDraft={setDraft}
        onSubmit={(line) => void submit(line)}
        onComplete={complete}
        onRecall={recall}
        onClear={clear}
      />
    </AppFrame>
  );
}
