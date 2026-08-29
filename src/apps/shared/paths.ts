/**
 * Path arithmetic, app side.
 *
 * The kernel has its own copy of this (`kernel/core/paths.ts`) and apps cannot
 * import it — that is the boundary working as intended. What crosses the ABI is a
 * *string*, and any app that shows a breadcrumb or names a new file has to be
 * able to take one apart. The rules are the ones the kernel enforces, so a name
 * this module accepts is a name `fs.writeText` will accept.
 */

/** `C:\Users\finance\Reports\q1.csv` → `q1.csv`; a volume root → `C:`. */
export function basename(path: string): string {
  const trimmed = path.replace(/\\+$/, '');
  const cut = trimmed.lastIndexOf('\\');
  if (cut === -1) return trimmed;
  const name = trimmed.slice(cut + 1);
  return name === '' ? trimmed : name;
}

/** Parent directory; a volume root is its own parent, as in Windows. */
export function dirname(path: string): string {
  const trimmed = path.replace(/\\+$/, '');
  const cut = trimmed.lastIndexOf('\\');
  if (cut <= 1) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.slice(0, cut);
}

export function join(base: string, ...parts: readonly string[]): string {
  let out = base.replace(/\\+$/, '');
  for (const part of parts) {
    const clean = part.replace(/^\\+|\\+$/g, '');
    if (clean !== '') out = `${out}\\${clean}`;
  }
  return out === '' ? base : out;
}

/** Lower-cased extension including the dot, or `''` for a name with none. */
export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** Breadcrumb trail: `C:\`, `C:\Users`, `C:\Users\finance`. */
export function ancestry(path: string): readonly string[] {
  const match = /^([A-Za-z]):\\?(.*)$/.exec(path.replace(/\//g, '\\'));
  if (match === null) return [];
  const volume = match[1].toUpperCase();
  const out = [`${volume}:\\`];
  const acc: string[] = [];
  for (const segment of (match[2] ?? '').split('\\')) {
    if (segment === '') continue;
    acc.push(segment);
    out.push(`${volume}:\\${acc.join('\\')}`);
  }
  return out;
}

/** True when `child` is `parent` or lives under it. Case-insensitive, like NTFS. */
export function contains(parent: string, child: string): boolean {
  const p = parent.replace(/\\+$/, '').toLowerCase();
  const c = child.replace(/\\+$/, '').toLowerCase();
  return c === p || c.startsWith(`${p}\\`);
}

/** The same rejection list the kernel applies, so validation agrees with it. */
export function isValidName(name: string): boolean {
  if (name.trim() === '' || name === '.' || name === '..') return false;
  if (/[<>:"/\\|?*]/.test(name)) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name);
}

/** `q1.csv` + `['q1.csv']` → `q1 (2).csv`, the way Windows resolves a collision. */
export function uniqueName(desired: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((entry) => entry.toLowerCase()));
  if (!lower.has(desired.toLowerCase())) return desired;
  const dot = desired.lastIndexOf('.');
  const base = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  let n = 2;
  while (lower.has(`${base} (${n})${ext}`.toLowerCase())) n += 1;
  return `${base} (${n})${ext}`;
}

/** The user profile the kernel seeds at first boot. */
export const HOME = 'C:\\Users\\finance';
export const DESKTOP = `${HOME}\\Desktop`;
export const DOCUMENTS = `${HOME}\\Documents`;
export const REPORTS = `${HOME}\\Reports`;
export const STATEMENTS = `${HOME}\\Statements`;
