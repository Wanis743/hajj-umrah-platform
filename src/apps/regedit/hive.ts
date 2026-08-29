/**
 * Registry Editor — reading the hive.
 *
 * There is no "enumerate everything" syscall, and there should not be: the ABI
 * gives you `enumKeys` and `enumValues` on one key at a time, which is exactly
 * what `RegOpenKeyEx`/`RegEnumKeyEx` give you on Windows. So this walks.
 *
 * The walk is breadth-first and batched — every key at one depth is enumerated in
 * a single `Promise.all` — and the result is then re-ordered depth-first so that
 * iteration order matches the order the tree draws, which is what makes Find Next
 * land where the eye expects. Values come back in one more batch, because holding
 * the whole hive lets the tree badge a key with its value count and lets Find
 * search data without a syscall per keystroke.
 *
 * Nothing here polls. Windows' regedit refreshes on F5 and so does this: a tree
 * that reshuffles itself under a half-typed value name is not an improvement.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { type AppRuntime, type RegistryEntry, useApp } from '@/platform/sdk';
import { ROOTS } from './catalog';

/** `HKLM\SYSTEM\CurrentControlSet\Services\<name>` is the deepest thing we seed. */
const MAX_DEPTH = 12;
/** A hive this size is already pathological; stopping beats hanging the window. */
const MAX_KEYS = 2000;

export interface Hive {
  /** Key → its values, in depth-first display order. Every walked key is present. */
  readonly values: ReadonlyMap<string, readonly RegistryEntry[]>;
  /** Key → its direct children. `''` holds the roots, so the tree starts there. */
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

const EMPTY_VALUES: ReadonlyMap<string, readonly RegistryEntry[]> = new Map();
/** Before the first walk lands the tree still has its two roots, closed. */
const ROOTS_ONLY: ReadonlyMap<string, readonly string[]> = new Map([['', ROOTS]]);

interface Walked {
  readonly values: Map<string, readonly RegistryEntry[]>;
  readonly children: Map<string, readonly string[]>;
  readonly error: string | null;
}

async function walk(runtime: AppRuntime): Promise<Walked> {
  const children = new Map<string, readonly string[]>([['', ROOTS]]);
  const order: string[] = [...ROOTS];
  let frontier: readonly string[] = ROOTS;
  let error: string | null = null;

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0 && order.length < MAX_KEYS; depth += 1) {
    const pages = await Promise.all(frontier.map((key) => runtime.invoke('registry.enumKeys', { key })));
    const next: string[] = [];
    pages.forEach((page, index) => {
      const parent = frontier[index];
      if (!page.ok) {
        error ??= page.error.message;
        children.set(parent, []);
        return;
      }
      const found = page.value.map((name) => `${parent}\\${name}`);
      children.set(parent, found);
      for (const key of found) {
        if (order.length >= MAX_KEYS) break;
        order.push(key);
        next.push(key);
      }
    });
    frontier = next;
  }

  const entries = await Promise.all(order.map((key) => runtime.invoke('registry.enumValues', { key })));
  const flat = new Map<string, readonly RegistryEntry[]>();
  entries.forEach((result, index) => {
    const key = order[index];
    if (result.ok) flat.set(key, result.value);
    else {
      error ??= result.error.message;
      flat.set(key, []);
    }
  });

  // Re-order depth-first, so iteration order is the order the tree paints.
  const values = new Map<string, readonly RegistryEntry[]>();
  const visit = (key: string): void => {
    values.set(key, flat.get(key) ?? []);
    for (const child of children.get(key) ?? []) visit(child);
  };
  for (const root of ROOTS) visit(root);

  return { values, children, error };
}

/** One walk on mount, and one per `refresh()`. Stale walks are dropped. */
export function useHive(): Hive {
  const runtime = useApp();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Walked | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    void walk(runtime).then((result) => {
      if (generation.current === mine) setState(result);
    });
  }, [runtime, nonce]);

  const refresh = useCallback(() => setNonce((current) => current + 1), []);

  return {
    values: state?.values ?? EMPTY_VALUES,
    children: state?.children ?? ROOTS_ONLY,
    loading: state === null,
    error: state?.error ?? null,
    refresh,
  };
}
