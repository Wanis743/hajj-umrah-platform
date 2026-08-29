/**
 * Kernel clock. Wall time comes from `Date`, monotonic time from
 * `performance.now()` so scheduler accounting is immune to clock adjustments.
 */
import { isoTimestamp, type IsoTimestamp } from '../types';
import type { KernelClock } from '../contracts';

const perfNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export function createClock(): KernelClock {
  const bootMonotonic = perfNow();
  return {
    now: () => Date.now(),
    monotonic: () => perfNow(),
    iso: (): IsoTimestamp => isoTimestamp(new Date().toISOString()),
    uptimeMs: () => perfNow() - bootMonotonic,
  };
}
