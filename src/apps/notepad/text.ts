/**
 * Notepad — the pure text layer.
 *
 * No React and no syscalls: given a string and a caret, work out what the status
 * bar says, what Find should highlight, and what Markdown means. It sits apart
 * because these are the parts worth being exactly right, and being exactly right
 * is easier to see when nothing around them can move.
 *
 * Line endings are the one piece of real-world grubbiness kept faithfully. A file
 * read from the volume may be CRLF or LF; the editor works in LF because a
 * `<textarea>` reports LF caret offsets regardless, and the original ending is
 * restored on save. Silently rewriting every line of a colleague's CRLF file is
 * how a text editor produces a diff nobody asked for.
 */

/** The two endings that exist in practice. Old-Mac CR-only is not honoured. */
export type Eol = 'CRLF' | 'LF';

/** A lone CR is left alone; only a real CRLF counts, as it does on Windows. */
export function detectEol(text: string): Eol {
  return text.includes('\r\n') ? 'CRLF' : 'LF';
}

/** Everything is edited in LF, so the caret offsets the DOM reports line up. */
export function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/** Restores the file's own ending on the way back out to the volume. */
export function fromLf(text: string, eol: Eol): string {
  return eol === 'CRLF' ? text.replace(/\n/g, '\r\n') : text;
}

export interface Caret {
  /** One-based, the way every editor's status bar counts. */
  readonly line: number;
  readonly column: number;
  /** Characters covered by the selection; `0` when it is just a caret. */
  readonly selected: number;
}

export function caretAt(text: string, start: number, end: number): Caret {
  const before = text.slice(0, Math.max(start, 0));
  const breaks = before.split('\n');
  return {
    line: breaks.length,
    column: (breaks[breaks.length - 1] ?? '').length + 1,
    selected: Math.max(end - start, 0),
  };
}

export interface TextStats {
  readonly lines: number;
  readonly words: number;
  readonly chars: number;
}

/** Words are runs of non-whitespace, which is what a word count means to a user. */
export function statsOf(text: string): TextStats {
  const words = text.split(/\s+/).filter((part) => part !== '');
  return { lines: text.split('\n').length, words: words.length, chars: text.length };
}

/* ------------------------------------------------------------------ *
 * Find and replace
 * ------------------------------------------------------------------ */

export interface FindOptions {
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly wrap: boolean;
}

export interface Match {
  readonly start: number;
  readonly end: number;
}

/**
 * A word character, Unicode-aware. `\b` would have been shorter and wrong: it is
 * defined over ASCII, so "whole word" would silently stop working the moment the
 * needle is Arabic or carries a French accent, in an OS that ships in both.
 */
const WORD = /[\p{L}\p{N}_]/u;

function bounded(text: string, start: number, end: number): boolean {
  return !WORD.test(text[start - 1] ?? '') && !WORD.test(text[end] ?? '');
}

/**
 * Every hit, in order. Holding the whole list rather than walking to the next hit
 * is what keeps "3 of 12" and Replace All from drifting: both become the same walk
 * Find Next already does, so none of the three can disagree about what matched.
 */
export function matchesOf(text: string, needle: string, options: FindOptions): readonly Match[] {
  if (needle === '') return [];
  const haystack = options.matchCase ? text : text.toLowerCase();
  const probe = options.matchCase ? needle : needle.toLowerCase();
  const out: Match[] = [];
  let at = haystack.indexOf(probe);
  while (at !== -1) {
    const end = at + probe.length;
    if (!options.wholeWord || bounded(text, at, end)) out.push({ start: at, end });
    at = haystack.indexOf(probe, at + 1);
  }
  return out;
}

/** The first hit at or after `from`; wraps to the top when asked to. */
export function nextMatch(matches: readonly Match[], from: number, wrap: boolean): Match | null {
  const ahead = matches.find((match) => match.start >= from);
  if (ahead !== undefined) return ahead;
  return wrap ? (matches[0] ?? null) : null;
}

/** The last hit ending at or before `from`; wraps to the bottom when asked to. */
export function prevMatch(matches: readonly Match[], from: number, wrap: boolean): Match | null {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    if (match !== undefined && match.end <= from) return match;
  }
  return wrap ? (matches[matches.length - 1] ?? null) : null;
}

/** Replacement text is literal: `$1` in the box means the characters `$1`. */
export function replaceAll(
  text: string,
  needle: string,
  replacement: string,
  options: FindOptions,
): { readonly text: string; readonly count: number } {
  const matches = matchesOf(text, needle, options);
  if (matches.length === 0) return { text, count: 0 };
  let out = '';
  let cursor = 0;
  for (const match of matches) {
    out += text.slice(cursor, match.start) + replacement;
    cursor = match.end;
  }
  return { text: out + text.slice(cursor), count: matches.length };
}

/* ------------------------------------------------------------------ *
 * Markdown
 * ------------------------------------------------------------------ */

export type MdBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'rule' };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/;

/** Consecutive items of the same flavour grow the list above instead of starting one. */
function appendItem(out: MdBlock[], ordered: boolean, item: string): void {
  const last = out[out.length - 1];
  if (last !== undefined && last.kind === 'list' && last.ordered === ordered) {
    out[out.length - 1] = { kind: 'list', ordered, items: [...last.items, item] };
    return;
  }
  out.push({ kind: 'list', ordered, items: [item] });
}

/** Pushes the block a structural line means, or reports the line as prose. */
function structured(out: MdBlock[], line: string): boolean {
  const heading = HEADING.exec(line);
  if (heading !== null) {
    out.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' });
    return true;
  }
  // Before the bullet test: `- - -` is a rule, and it also looks like a bullet.
  if (RULE.test(line)) {
    out.push({ kind: 'rule' });
    return true;
  }
  const bullet = BULLET.exec(line);
  if (bullet !== null) {
    appendItem(out, false, bullet[1] ?? '');
    return true;
  }
  const ordered = ORDERED.exec(line);
  if (ordered !== null) {
    appendItem(out, true, ordered[1] ?? '');
    return true;
  }
  if (line.trimStart().startsWith('>')) {
    out.push({ kind: 'quote', text: line.replace(/^\s*>\s?/, '') });
    return true;
  }
  return false;
}

/**
 * Block structure for the preview pane — headings, lists, quotes, fences, rules
 * and the paragraphs between them. Deliberately a subset: tables, footnotes and
 * reference links are not here, because the preview exists to make a close note
 * readable, not to be a second CommonMark implementation.
 */
export function markdownBlocks(source: string): readonly MdBlock[] {
  const out: MdBlock[] = [];
  let fence: string[] | null = null;
  let prose = false;
  for (const line of toLf(source).split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (fence === null) fence = [];
      else {
        out.push({ kind: 'code', text: fence.join('\n') });
        fence = null;
      }
      prose = false;
    } else if (fence !== null) fence.push(line);
    else if (line.trim() === '') prose = false;
    else if (structured(out, line)) prose = false;
    else {
      const last = out[out.length - 1];
      if (prose && last !== undefined && last.kind === 'paragraph') {
        out[out.length - 1] = { kind: 'paragraph', text: `${last.text} ${line.trim()}` };
      } else out.push({ kind: 'paragraph', text: line.trim() });
      prose = true;
    }
  }
  // An unterminated fence still shows what it holds, rather than swallowing it.
  if (fence !== null) out.push({ kind: 'code', text: fence.join('\n') });
  return out;
}

export interface Inline {
  readonly kind: 'text' | 'strong' | 'em' | 'code';
  readonly text: string;
}

/** `**` is tried before `*`, so bold is not read as two italics. */
const MARKS: readonly (readonly [string, Inline['kind']])[] = [
  ['`', 'code'],
  ['**', 'strong'],
  ['*', 'em'],
  ['_', 'em'],
];

/** Inline spans within one block. An unclosed marker is just text, as it renders. */
export function inlines(source: string): readonly Inline[] {
  const out: Inline[] = [];
  let plain = '';
  let at = 0;
  while (at < source.length) {
    const mark = MARKS.find(([token]) => source.startsWith(token, at));
    const close = mark === undefined ? -1 : source.indexOf(mark[0], at + mark[0].length);
    if (mark === undefined || close === -1) {
      plain += source[at] ?? '';
      at += 1;
      continue;
    }
    if (plain !== '') {
      out.push({ kind: 'text', text: plain });
      plain = '';
    }
    out.push({ kind: mark[1], text: source.slice(at + mark[0].length, close) });
    at = close + mark[0].length;
  }
  if (plain !== '') out.push({ kind: 'text', text: plain });
  return out;
}
