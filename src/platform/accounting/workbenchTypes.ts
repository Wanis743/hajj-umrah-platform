/** Shared types for the accounting workspaces (slice 3). */

import type { KernelError, MinorUnits } from '../kernel/types.ts';

export interface AccountOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Editor row: raw strings for inputs + parsed minor units kept in sync by the owner. */
export interface DraftLine {
  readonly accountId: string;
  readonly debitRaw: string;
  readonly creditRaw: string;
  readonly currencyCode: 'DZD' | 'SAR';
  readonly memo: string;
  readonly debitMinor: MinorUnits;
  readonly creditMinor: MinorUnits;
}

export type Loadable<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'failed'; readonly error: KernelError };

export type Validation = { readonly ok: true } | { readonly ok: false; readonly error: KernelError };
