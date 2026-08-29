/**
 * Registry Editor — the value domain, and how it is spelled.
 *
 * Windows' registry has ten value types; this kernel's has five, because
 * `RegistryValue` is `string | number | boolean | string[] | null` and nothing
 * else can be stored. Rather than dress a boolean up as a `REG_DWORD` — which
 * would be a lie the moment you read it back — the type names here match what the
 * hive can actually hold, and the two that have no Windows equivalent say so.
 *
 * Everything in this file is pure. The walk lives in `hive.ts`, the syscalls in
 * `App.tsx`; this is the part that has to agree with `kernel/core/registry.ts`
 * about what a key path is and what a value looks like when written down.
 */
import type { Localized, RegistryEntry, RegistryValue } from '@/platform/kernel/abi';

/** The five shapes a `RegistryValue` can take, named the way regedit names them. */
export type RegKind = 'REG_SZ' | 'REG_DWORD' | 'REG_NUMBER' | 'REG_BOOL' | 'REG_MULTI_SZ' | 'REG_NONE';

/** Windows shows an unset default value rather than hiding the key. So do we. */
export const DEFAULT_VALUE_NAME = '(Default)';

/** The hives this kernel has. Regedit lists roots alphabetically; these already are. */
export const ROOTS: readonly string[] = ['HKCU', 'HKLM'];

/** Display names. The tree and the address bar use these; the syscalls never do. */
export const LONG_ROOT: Readonly<Record<string, string>> = {
  HKCU: 'HKEY_CURRENT_USER',
  HKLM: 'HKEY_LOCAL_MACHINE',
};

export const KIND_LABEL: Readonly<Record<RegKind, string>> = {
  REG_SZ: 'REG_SZ',
  REG_DWORD: 'REG_DWORD',
  REG_NUMBER: 'REG_NUMBER',
  REG_BOOL: 'REG_BOOL',
  REG_MULTI_SZ: 'REG_MULTI_SZ',
  REG_NONE: 'REG_NONE',
};

/** What each type is for, shown when you pick one in the New Value dialog. */
export const KIND_HINT: Readonly<Record<RegKind, Localized>> = {
  REG_SZ: { ar: 'نص', fr: 'Chaîne de caractères', en: 'Text string' },
  REG_DWORD: { ar: 'عدد صحيح ٣٢-بت', fr: 'Entier 32 bits', en: '32-bit integer' },
  REG_NUMBER: { ar: 'عدد عشري', fr: 'Nombre décimal', en: 'Fractional number' },
  REG_BOOL: { ar: 'قيمة منطقية', fr: 'Valeur booléenne', en: 'Boolean flag' },
  REG_MULTI_SZ: { ar: 'قائمة نصوص', fr: 'Liste de chaînes', en: 'List of strings' },
  REG_NONE: { ar: 'بلا قيمة', fr: 'Aucune valeur', en: 'No value set' },
};

/** Types offered when creating a value — `REG_NONE` is a state, not a choice. */
export const NEW_KINDS: readonly RegKind[] = ['REG_SZ', 'REG_DWORD', 'REG_NUMBER', 'REG_BOOL', 'REG_MULTI_SZ'];

const DWORD_MAX = 0xffffffff;

export function kindOf(value: RegistryValue): RegKind {
  if (value === null) return 'REG_NONE';
  if (typeof value === 'string') return 'REG_SZ';
  if (typeof value === 'boolean') return 'REG_BOOL';
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= DWORD_MAX ? 'REG_DWORD' : 'REG_NUMBER';
  }
  return 'REG_MULTI_SZ';
}

/**
 * The Data column. `null` means "not set", which the caller localises — every
 * other shape is rendered exactly as regedit renders it, including the
 * `0x0000000a (10)` double form for a DWORD.
 */
export function displayData(value: RegistryValue): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > DWORD_MAX) return String(value);
    return `0x${value.toString(16).padStart(8, '0')} (${value})`;
  }
  return value.join(' · ');
}

/** The editable form: what the edit box starts with, per type. */
export function editText(value: RegistryValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return value.join('\n');
}

export type ParseResult = { readonly ok: true; readonly value: RegistryValue } | { readonly ok: false };

/**
 * Turns what was typed back into a `RegistryValue`. A DWORD accepts decimal or
 * `0x`-prefixed hex, the way regedit's radio buttons do — the base is inferred
 * from the text instead of being a second control to get wrong.
 */
export function parseData(kind: RegKind, text: string): ParseResult {
  if (kind === 'REG_SZ') return { ok: true, value: text };
  if (kind === 'REG_NONE') return { ok: true, value: null };
  if (kind === 'REG_MULTI_SZ') {
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    return { ok: true, value: lines };
  }
  if (kind === 'REG_BOOL') {
    const lower = text.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return { ok: true, value: true };
    if (lower === 'false' || lower === '0') return { ok: true, value: false };
    return { ok: false };
  }
  const raw = text.trim();
  if (raw === '') return { ok: false };
  const parsed = /^0x[0-9a-f]+$/i.test(raw) ? Number.parseInt(raw.slice(2), 16) : Number(raw);
  if (!Number.isFinite(parsed)) return { ok: false };
  if (kind === 'REG_DWORD' && (!Number.isInteger(parsed) || parsed < 0 || parsed > DWORD_MAX)) return { ok: false };
  return { ok: true, value: parsed };
}

/* ------------------------------------------------------------------ *
 * Key paths
 * ------------------------------------------------------------------ */

/** `HKCU\Control Panel\Desktop` → `Desktop`. A root is its own name. */
export function keyName(key: string): string {
  const cut = key.lastIndexOf('\\');
  return cut === -1 ? key : key.slice(cut + 1);
}

/** Parent key, or `''` above a root — which is where the tree stops. */
export function parentKey(key: string): string {
  const cut = key.lastIndexOf('\\');
  return cut === -1 ? '' : key.slice(0, cut);
}

/** `HKCU\Software` → `HKEY_CURRENT_USER\Software`, for display only. */
export function toLongPath(key: string): string {
  const root = key.split('\\')[0] ?? '';
  const long = LONG_ROOT[root.toUpperCase()];
  return long === undefined ? key : `${long}${key.slice(root.length)}`;
}

/** The inverse, tolerant of what a person types: long roots, `/`, `Computer\`. */
export function fromLongPath(typed: string): string {
  let text = typed.trim().replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/\\$/, '');
  text = text.replace(/^computer\\/i, '');
  for (const [short, long] of Object.entries(LONG_ROOT)) {
    if (text.toUpperCase() === long) return short;
    if (text.toUpperCase().startsWith(`${long}\\`)) return `${short}${text.slice(long.length)}`;
  }
  return text;
}

/** True when the key lives in `HKLM`, where a write raises the consent dialog. */
export function isMachineKey(key: string): boolean {
  return key.toUpperCase().startsWith('HKLM');
}

/**
 * The service hive is rebuilt from the service table at every boot, so a write
 * here is real until the session ends and then gone. The kernel says as much in
 * `registry.ts`; the editor should not pretend otherwise.
 */
export function isVolatileKey(key: string): boolean {
  const lower = key.toLowerCase();
  const root = 'hklm\\system\\currentcontrolset\\services';
  return lower === root || lower.startsWith(`${root}\\`);
}

/** Search scope, mirroring the three checkboxes in regedit's Find dialog. */
export interface FindScope {
  readonly keys: boolean;
  readonly names: boolean;
  readonly data: boolean;
}

/** A hit is a key, and optionally the value inside it that matched. */
export interface FindHit {
  readonly key: string;
  readonly name: string | null;
}

export function findAll(
  hive: ReadonlyMap<string, readonly RegistryEntry[]>,
  needle: string,
  scope: FindScope,
  limit: number,
): readonly FindHit[] {
  const query = needle.trim().toLowerCase();
  if (query === '') return [];
  const hits: FindHit[] = [];
  for (const [key, entries] of hive) {
    if (scope.keys && keyName(key).toLowerCase().includes(query)) hits.push({ key, name: null });
    for (const entry of entries) {
      if (hits.length >= limit) return hits;
      const inName = scope.names && entry.name.toLowerCase().includes(query);
      const rendered = displayData(entry.value);
      const inData = scope.data && rendered !== null && rendered.toLowerCase().includes(query);
      if (inName || inData) hits.push({ key, name: entry.name });
    }
    if (hits.length >= limit) return hits;
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * .reg export
 * ------------------------------------------------------------------ */

function regLiteral(value: RegistryValue): string {
  if (value === null) return 'none:';
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (typeof value === 'boolean') return `bool:${value ? 'true' : 'false'}`;
  if (typeof value === 'number') {
    return kindOf(value) === 'REG_DWORD' ? `dword:${value.toString(16).padStart(8, '0')}` : `num:${value}`;
  }
  return `multi:${value.map((item) => `"${item.replace(/"/g, '\\"')}"`).join(',')}`;
}

/**
 * File ▸ Export, in the format regedit writes.
 *
 * `REG_SZ` and `REG_DWORD` use the real syntax verbatim, so an exported subtree
 * of strings and numbers is a genuine `.reg` file. The three value shapes Windows
 * has no literal for — boolean, fractional number, unset — get an explicit
 * prefix instead of a lossy cast into `dword:`.
 */
export function toReg(subtree: readonly (readonly [string, readonly RegistryEntry[]])[]): string {
  const lines: string[] = ['Windows Registry Editor Version 5.00', ''];
  for (const [key, entries] of subtree) {
    lines.push(`[${toLongPath(key)}]`);
    for (const entry of entries) {
      const name = entry.name === DEFAULT_VALUE_NAME ? '@' : `"${entry.name}"`;
      lines.push(`${name}=${regLiteral(entry.value)}`);
    }
    lines.push('');
  }
  return lines.join('\r\n');
}

/** `HKCU\Control Panel\Appearance` → `Appearance.reg`; a root keeps its short name. */
export function regFileName(key: string): string {
  const base = keyName(key).replace(/[<>:"/\\|?*]/g, '-');
  return `${base === '' ? 'registry' : base}.reg`;
}
