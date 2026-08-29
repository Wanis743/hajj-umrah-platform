/**
 * Windows-style path arithmetic for the VFS.
 *
 * Paths are absolute and volume-qualified: `C:\Users\finance\Desktop\a.txt`.
 * Comparison is case-insensitive (like NTFS) but the original casing is what
 * gets stored and displayed.
 */

export interface ParsedPath {
  /** Volume letter without the colon, upper-cased: `C`. */
  readonly volume: string;
  /** Path segments below the volume root, original casing preserved. */
  readonly segments: readonly string[];
}

/**
 * Characters Windows forbids in a file name. The C0 control range is included
 * deliberately: a NUL or an escape smuggled into a name would be invisible in
 * Explorer while still addressing a different file.
 */
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const ILLEGAL = /[<>:"/|?*\u0000-\u001f]/;

export function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:\\/.test(path);
}

/** Collapses separators, resolves `.` / `..`, and upper-cases the volume. */
export function normalize(path: string): string {
  const parsed = parse(path);
  if (!parsed) return path;
  return format(parsed);
}

export function parse(path: string): ParsedPath | null {
  const trimmed = path.trim().replace(/\//g, '\\');
  const match = /^([A-Za-z]):\\?(.*)$/.exec(trimmed);
  if (!match) return null;
  const volume = match[1].toUpperCase();
  const rest = match[2] ?? '';
  const out: string[] = [];
  for (const raw of rest.split('\\')) {
    const segment = raw.trim();
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return { volume, segments: out };
}

export function format(parsed: ParsedPath): string {
  return parsed.segments.length === 0
    ? `${parsed.volume}:\\`
    : `${parsed.volume}:\\${parsed.segments.join('\\')}`;
}

export function join(...parts: readonly string[]): string {
  if (parts.length === 0) return '';
  const [head, ...rest] = parts;
  const joined = [head, ...rest.map((p) => p.replace(/^[\\/]+/, ''))].join('\\');
  return normalize(joined);
}

/** Parent directory, or the volume root when already at the root. */
export function dirname(path: string): string {
  const parsed = parse(path);
  if (!parsed) return path;
  if (parsed.segments.length === 0) return format(parsed);
  return format({ volume: parsed.volume, segments: parsed.segments.slice(0, -1) });
}

export function basename(path: string): string {
  const parsed = parse(path);
  if (!parsed) return path;
  return parsed.segments.length === 0 ? `${parsed.volume}:` : parsed.segments[parsed.segments.length - 1];
}

/** Lower-cased extension including the dot, or `''`. */
export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** Filename without its extension. */
export function stem(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/** Path relative to a volume root, `\`-joined, without the leading slash. */
export function relative(path: string): string {
  const parsed = parse(path);
  return parsed ? parsed.segments.join('\\') : '';
}

export function volumeOf(path: string): string | null {
  const parsed = parse(path);
  return parsed ? parsed.volume : null;
}

/** Case-insensitive equality, tolerant of trailing separators. */
export function equals(a: string, b: string): boolean {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

/** Is `child` inside `parent` (or equal to it)? */
export function contains(parent: string, child: string): boolean {
  const p = normalize(parent).toLowerCase();
  const c = normalize(child).toLowerCase();
  if (p === c) return true;
  return c.startsWith(p.endsWith('\\') ? p : `${p}\\`);
}

/** Breadcrumb trail: `C:\`, `C:\Users`, `C:\Users\finance`. */
export function ancestry(path: string): readonly string[] {
  const parsed = parse(path);
  if (!parsed) return [];
  const out = [`${parsed.volume}:\\`];
  const acc: string[] = [];
  for (const segment of parsed.segments) {
    acc.push(segment);
    out.push(format({ volume: parsed.volume, segments: [...acc] }));
  }
  return out;
}

/** Rejects names containing reserved characters or reserved device names. */
export function isValidName(name: string): boolean {
  if (name.trim() === '' || name === '.' || name === '..') return false;
  if (ILLEGAL.test(name)) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name);
}

/** `report.csv` + existing names → `report (2).csv`. */
export function uniqueName(desired: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(desired.toLowerCase())) return desired;
  const dot = desired.lastIndexOf('.');
  const base = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  let n = 2;
  while (lower.has(`${base} (${n})${ext}`.toLowerCase())) n += 1;
  return `${base} (${n})${ext}`;
}
