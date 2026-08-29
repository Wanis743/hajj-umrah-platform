/**
 * Fluent UI kit — shared tokens and pure helpers.
 *
 * Kept free of components so it can be imported by every UI module (and by
 * the shell) without creating cycles, and so React Fast Refresh stays valid
 * for the component files.
 */

/** Semantic colour role used across badges, meters, rows and charts. */
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export type ButtonVariant = 'default' | 'accent' | 'subtle' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

/** CSS custom property carrying a tone's foreground colour. */
export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'var(--fx-success)';
    case 'warning':
      return 'var(--fx-warning)';
    case 'danger':
      return 'var(--fx-danger)';
    case 'info':
      return 'var(--fx-info)';
    case 'accent':
      return 'var(--fx-accent)';
    default:
      return 'var(--fx-text-secondary)';
  }
}

/** Translucent background for a tone (info bars, tile glyph plates). */
export function toneSurface(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'var(--fx-success-bg)';
    case 'warning':
      return 'var(--fx-warning-bg)';
    case 'danger':
      return 'var(--fx-danger-bg)';
    case 'info':
      return 'var(--fx-info-bg)';
    case 'accent':
      return 'var(--fx-info-bg)';
    default:
      return 'var(--fx-control)';
  }
}

/** Deterministic categorical palette — index-stable across renders. */
export const SERIES_COLORS: readonly string[] = [
  '#4cc2ff',
  '#6ccb5f',
  '#ffb900',
  '#ff8c69',
  '#c39bff',
  '#5ed3c0',
  '#f2a2c0',
  '#8db4ff',
];

export function colorAt(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? '#4cc2ff';
}

/** Rounds an axis maximum up to a readable 1/2/5 × 10ⁿ boundary. */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Clamps a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
