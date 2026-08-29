/**
 * Deterministic identifier generation.
 *
 * `Math.random` is banned repository-wide (see `scripts/verify-source.mjs`):
 * ids come from monotonic sequences or `crypto.randomUUID`.
 */

const sequences = new Map<string, number>();

/** Monotonic per-namespace counter, e.g. `next('pid')` → 1, 2, 3 … */
export function next(namespace: string): number {
  const current = (sequences.get(namespace) ?? 0) + 1;
  sequences.set(namespace, current);
  return current;
}

/** A RFC-4122 identifier when the platform offers one, else a sequenced id. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${next('uuid').toString(36)}`;
}

/** Short, human-readable, collision-free id: `w-7`, `note-12`. */
export function shortId(prefix: string): string {
  return `${prefix}-${next(prefix)}`;
}

/** Resets sequences. Only used by the boot self-check. */
export function resetSequences(): void {
  sequences.clear();
}
