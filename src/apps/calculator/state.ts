/**
 * Calculator — keypad behaviour.
 *
 * The engine in `math.ts` is a pure function of (state, key); this is the part
 * that holds the state, keeps the history tape, owns the single memory register
 * and turns physical key presses into presses of the keypad.
 *
 * History is deliberately not persisted. A calculator tape is a working note
 * about the last few minutes, and a tape restored at next boot would present
 * yesterday's numbers as if they were part of what is on screen now. The chosen
 * mode *is* persisted, under `HKCU`, because reopening on the panel you work in
 * is what every calculator with modes does.
 */
import { type KeyboardEvent, useCallback, useState } from 'react';
import { useApp, useSetting } from '@/platform/sdk';
import { type CalcError, type CalcKey, type CalcState, START, current, display, keyFor, press } from './math';

/** Standard keypad, the five-key TVM solver, discounted cash flow. */
export type Mode = 'standard' | 'tvm' | 'cashflow';

const MODES: readonly string[] = ['standard', 'tvm', 'cashflow'];

/** A stored preference is a string from the registry until it is proven a mode. */
export const asMode = (value: string): Mode => (MODES.includes(value) ? (value as Mode) : 'standard');

export type MemoryKey = 'clear' | 'recall' | 'store' | 'add' | 'subtract';

export interface HistoryEntry {
  readonly id: string;
  readonly expression: string;
  readonly value: number;
}

/** A tape longer than this is scrollback nobody reads; the oldest fall off. */
const TAPE_LIMIT = 64;

let tapeSequence = 0;

export interface Standard {
  readonly state: CalcState;
  /** The display line, grouped for the active locale. */
  readonly text: string;
  /** The faint expression above it — `12 + `, `sqr(9)`, or empty. */
  readonly trail: string;
  readonly error: CalcError | null;
  readonly value: number;
  readonly memory: number | null;
  readonly history: readonly HistoryEntry[];
  readonly push: (key: CalcKey) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  readonly memoryKey: (key: MemoryKey) => void;
  readonly recall: (value: number) => void;
  readonly clearHistory: () => void;
}

export function useStandard(): Standard {
  const { intlLocale } = useApp().locale;
  const [state, setState] = useState<CalcState>(START);
  const [memory, setMemory] = useState<number | null>(null);
  const [history, setHistory] = useState<readonly HistoryEntry[]>([]);

  /**
   * The committed entry is appended outside the state updater on purpose: a
   * `setHistory` inside one would run twice under StrictMode and record every
   * calculation twice.
   */
  const push = useCallback(
    (key: CalcKey) => {
      const result = press(state, key);
      setState(result.state);
      if (result.committed === null) return;
      tapeSequence += 1;
      const entry: HistoryEntry = { id: `tape-${tapeSequence}`, ...result.committed };
      setHistory((tape) => [entry, ...tape].slice(0, TAPE_LIMIT));
    },
    [state],
  );

  /** Puts a number on the display as a finished result, ready for an operator. */
  const recall = useCallback((value: number) => {
    setState((previous) => ({ ...previous, entry: null, value, error: null }));
  }, []);

  const memoryKey = useCallback(
    (key: MemoryKey) => {
      const shown = current(state);
      if (key === 'clear') setMemory(null);
      else if (key === 'store') setMemory(shown);
      else if (key === 'add') setMemory((held) => (held ?? 0) + shown);
      else if (key === 'subtract') setMemory((held) => (held ?? 0) - shown);
      else if (memory !== null) recall(memory);
    },
    [state, memory, recall],
  );

  /**
   * Returns whether the press was ours. The window keeps modifier combinations
   * for the shell — `Ctrl+C` is Copy, not the letter C.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const key = keyFor(event.key);
      if (key === null) return false;
      push(key);
      return true;
    },
    [push],
  );

  return {
    state,
    text: display(state, intlLocale),
    trail: state.trail,
    error: state.error,
    value: current(state),
    memory,
    history,
    push,
    onKeyDown,
    memoryKey,
    recall,
    clearHistory: () => setHistory([]),
  };
}

/** The mode the window opens on, remembered per user. */
export function useMode(): readonly [Mode, (next: Mode) => void] {
  const [stored, setStored] = useSetting<string>('mode', 'standard');
  return [asMode(stored), (next: Mode) => setStored(next)];
}

/**
 * Copy to the clipboard with the toast the act deserves. `clipboard` is not a
 * privileged capability, so nothing else reports that it happened.
 */
export function useCopy(): (text: string) => void {
  const runtime = useApp();
  const { tr } = runtime.locale;
  return useCallback(
    (text: string) => {
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) =>
        runtime.toast({
          kind: result.ok ? 'success' : 'error',
          title: result.ok ? tr('نُسخ إلى الحافظة', 'Copié dans le presse-papiers', 'Copied to clipboard') : result.error.message,
          body: result.ok ? text : undefined,
        }),
      );
    },
    [runtime, tr],
  );
}
