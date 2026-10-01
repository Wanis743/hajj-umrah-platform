/**
 * The Fluent theme the shell hands to `FluentProvider`.
 *
 * Fluent v9 is themed by a flat table of about three hundred design tokens,
 * emitted as CSS custom properties on the provider's root element. This OS
 * already has such a table — the `--fx-*` ladder declared on `.fos` in
 * `fluent.css` — and the two must not disagree, or a Fluent `Input` sitting on
 * a Mica pane would be a different grey from the pane's own controls.
 *
 * They are reconciled in two moves.
 *
 * First, `createLightTheme` / `createDarkTheme` are seeded with `brandRamp`,
 * built from the user's own accent rather than from one of Microsoft's stock
 * palettes. That gives coherent values to the forty-odd `colorBrand*` tokens
 * nothing here would otherwise have an opinion about.
 *
 * Second, the handful of tokens that must match the surrounding chrome exactly
 * are pointed at the `--fx-*` properties themselves, as live `var()` references
 * rather than copied values. Because the provider's root element *is* `.fos`,
 * those references resolve against the very element that declares them — so
 * switching `data-theme`, or turning transparency off, retunes Fluent's
 * controls in the same repaint as everything else, with no theme rebuild. It is
 * also why one override table serves both themes.
 *
 * Pure module: no React, no kernel.
 */
import { createDarkTheme, createLightTheme, type Theme } from '@fluentui/react-components';
import { brandRamp, type ThemeName } from './appearance';

/**
 * Where Fluent and the OS name the same thing, the OS wins.
 *
 * Grouped by what each group governs, because the failure of any one of them is
 * visible in a different place: foregrounds in text, fills in control bodies,
 * strokes in their outlines, brand in anything selected or primary, and status
 * in the message bars.
 */
const FROM_FX: Partial<Theme> = {
  /* Type. The OS ships Segoe UI Variable and a mono face for figures. */
  fontFamilyBase: 'var(--fx-font)',
  fontFamilyNumeric: 'var(--fx-font)',
  fontFamilyMonospace: 'var(--fx-font-mono)',

  /* Geometry. One control radius, so a Fluent button and an `fx-btn` agree. */
  borderRadiusMedium: 'var(--fx-radius-control)',

  /* Text. The four-step ladder Windows uses, plus the disabled rung. */
  colorNeutralForeground1: 'var(--fx-text-primary)',
  colorNeutralForeground2: 'var(--fx-text-secondary)',
  colorNeutralForeground3: 'var(--fx-text-tertiary)',
  colorNeutralForeground4: 'var(--fx-text-tertiary)',
  colorNeutralForegroundDisabled: 'var(--fx-text-disabled)',
  colorNeutralForegroundOnBrand: 'var(--fx-on-accent)',

  /* Control bodies, and the subtle fills used by anything borderless. */
  colorNeutralBackground1: 'var(--fx-control)',
  colorNeutralBackground1Hover: 'var(--fx-control-hover)',
  colorNeutralBackground1Pressed: 'var(--fx-control-pressed)',
  colorNeutralBackground1Selected: 'var(--fx-subtle-pressed)',
  colorNeutralBackgroundDisabled: 'var(--fx-control-disabled)',
  colorSubtleBackgroundHover: 'var(--fx-subtle-hover)',
  colorSubtleBackgroundPressed: 'var(--fx-subtle-pressed)',
  colorSubtleBackgroundSelected: 'var(--fx-subtle-pressed)',

  /* Outlines. `colorNeutralStroke2` is the one dividers are drawn with. */
  colorNeutralStroke1: 'var(--fx-control-stroke)',
  colorNeutralStroke1Hover: 'var(--fx-control-stroke)',
  colorNeutralStroke1Pressed: 'var(--fx-control-stroke)',
  colorNeutralStroke2: 'var(--fx-divider)',
  colorNeutralStrokeAccessible: 'var(--fx-stroke-strong)',
  colorNeutralStrokeDisabled: 'var(--fx-stroke)',
  /* The focus ring, matching `.fos :focus-visible` rather than competing with it. */
  colorStrokeFocus2: 'var(--fx-text-primary)',

  /*
   * Brand. The ramp above already derives these, but only these five are load
   * bearing against the chrome: a primary button, a checked checkbox and the
   * taskbar's accent pill have to be the same colour or the desktop looks
   * assembled from two kits.
   */
  colorBrandBackground: 'var(--fx-accent)',
  colorBrandBackgroundHover: 'var(--fx-accent-dark1)',
  colorBrandBackgroundPressed: 'var(--fx-accent-dark2)',
  colorBrandForeground1: 'var(--fx-accent-text)',
  colorBrandForegroundLink: 'var(--fx-accent-text)',
  colorCompoundBrandBackground: 'var(--fx-accent)',
  colorCompoundBrandBackgroundHover: 'var(--fx-accent-dark1)',
  colorCompoundBrandBackgroundPressed: 'var(--fx-accent-dark2)',
  colorCompoundBrandStroke: 'var(--fx-accent)',
  colorCompoundBrandStrokeHover: 'var(--fx-accent-light1)',
  colorCompoundBrandStrokePressed: 'var(--fx-accent-dark1)',
  colorCompoundBrandForeground1: 'var(--fx-accent-text)',

  /* Status, shared with every `InfoBar`, toast and validation message. */
  colorStatusSuccessForeground1: 'var(--fx-success)',
  colorStatusSuccessBackground1: 'var(--fx-success-bg)',
  colorStatusWarningForeground1: 'var(--fx-warning)',
  colorStatusWarningBackground1: 'var(--fx-warning-bg)',
  colorStatusDangerForeground1: 'var(--fx-danger)',
  colorStatusDangerBackground1: 'var(--fx-danger-bg)',
  colorPaletteRedForeground1: 'var(--fx-danger)',
  colorPaletteGreenForeground1: 'var(--fx-success)',
  /*
   * Not decoration: Fluent's own invalid recipe paints all four borders of a
   * field with `colorPaletteRedBorder2` when `aria-invalid` is set, and that is
   * how `Input`'s `invalid` prop and `Field`'s error state are implemented now.
   * Left unpinned, a rejected amount would outline itself in Microsoft's red
   * next to an error message in ours.
   */
  colorPaletteRedBorder2: 'var(--fx-danger)',
  colorPaletteDarkOrangeForeground1: 'var(--fx-warning)',
};

/**
 * Themes are cached by `theme|accent` because `FluentProvider` treats the theme
 * object by identity: a fresh one on every render would inject a fresh block of
 * three hundred custom properties on every render. Two entries per accent the
 * user has tried is the whole of the cache's growth.
 */
const cache = new Map<string, Theme>();

/** The Fluent theme for a shell appearance, built once per theme-and-accent pair. */
export function fluentTheme(theme: ThemeName, accent: string): Theme {
  const key = `${theme}|${accent}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const ramp = brandRamp(accent);
  const base = theme === 'light' ? createLightTheme(ramp) : createDarkTheme(ramp);
  const built: Theme = { ...base, ...FROM_FX };
  cache.set(key, built);
  return built;
}
