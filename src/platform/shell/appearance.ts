/**
 * Appearance — accent maths, wallpapers and the registry-backed settings model.
 *
 * Pure module: no React, no kernel. `fluent.css` declares the default palette
 * as custom properties on `.fos`; this file computes the overrides the shell
 * paints inline when the user picks a different accent, and describes the
 * wallpapers Settings offers.
 */
import { REG, type Localized } from '../kernel/abi';
import type { RegistrySubsystem } from '../kernel/contracts';
import { wallpaperPhoto } from '../sdk/ui/wallpapers';

export type ThemeName = 'dark' | 'light';
export type IconSize = 'small' | 'medium' | 'large';
export type TaskbarAlignment = 'center' | 'start';

/** Language the shell chrome renders in. */
export type ShellLang = 'ar' | 'fr' | 'en';

export interface Appearance {
  readonly theme: ThemeName;
  readonly accent: string;
  readonly transparency: boolean;
  readonly animations: boolean;
  readonly language: ShellLang;
  readonly wallpaper: string;
  readonly iconSize: IconSize;
  readonly showDesktopIcons: boolean;
  readonly taskbarAlignment: TaskbarAlignment;
  readonly taskbarAutoHide: boolean;
  readonly showSearch: boolean;
  readonly showTaskView: boolean;
  readonly showWidgets: boolean;
}

/* ------------------------------------------------------------------ *
 * Accent swatches
 * ------------------------------------------------------------------ */

export interface AccentSwatch {
  readonly id: string;
  readonly name: Localized;
  readonly hex: string;
}

/** The Windows 11 personalisation swatches, trimmed to a useful set. */
export const ACCENTS: readonly AccentSwatch[] = [
  { id: 'blue', name: { ar: 'أزرق', fr: 'Bleu', en: 'Blue' }, hex: '#0067c0' },
  { id: 'teal', name: { ar: 'أزرق مخضر', fr: 'Sarcelle', en: 'Teal' }, hex: '#038387' },
  { id: 'green', name: { ar: 'أخضر', fr: 'Vert', en: 'Green' }, hex: '#107c10' },
  { id: 'purple', name: { ar: 'بنفسجي', fr: 'Violet', en: 'Purple' }, hex: '#744da9' },
  { id: 'magenta', name: { ar: 'أرجواني', fr: 'Magenta', en: 'Magenta' }, hex: '#b146c2' },
  { id: 'orange', name: { ar: 'برتقالي', fr: 'Orange', en: 'Orange' }, hex: '#ca5010' },
  { id: 'red', name: { ar: 'أحمر', fr: 'Rouge', en: 'Red' }, hex: '#c42b1c' },
  { id: 'slate', name: { ar: 'رمادي', fr: 'Ardoise', en: 'Slate' }, hex: '#4c5a67' },
];

/* ------------------------------------------------------------------ *
 * Wallpapers
 * ------------------------------------------------------------------ */

export interface Wallpaper {
  readonly id: string;
  readonly name: Localized;
  /** Base colour painted under the layers. */
  readonly base: string;
  /** CSS `background-image` layers, painted front to back. */
  readonly layers: readonly string[];
  /** Wallpapers designed for the light theme keep dark desktop labels legible. */
  readonly light: boolean;
  /**
   * A photograph painted behind `layers`, cropped to cover. Null for the CSS
   * wallpapers, which need no asset and cost nothing to paint.
   */
  readonly photo: string | null;
}

export const WALLPAPERS: readonly Wallpaper[] = [
  /*
   * The default. A photograph the way Windows ships one — the gradients below it
   * remain, but a desktop's first impression is a picture, not a mesh. The two
   * scrims are the only thing added to the frame: a dim at the top so taskbar
   * and window chrome keep their contrast against the sky, and a deepening at
   * the foot so desktop labels stay readable over the cloud bank.
   */
  {
    id: 'summit',
    name: { ar: 'القمّة', fr: 'Sommet', en: 'Summit' },
    base: '#060f13',
    light: false,
    photo: wallpaperPhoto('summit'),
    layers: [
      'linear-gradient(180deg, rgba(4, 12, 16, 0.34), transparent 26%)',
      'linear-gradient(0deg, rgba(3, 8, 11, 0.42), transparent 30%)',
    ],
  },
  {
    id: 'fluent-bloom',
    name: { ar: 'تفتّح', fr: 'Éclosion', en: 'Bloom' },
    base: '#04121f',
    light: false,
    photo: null,
    layers: [
      'radial-gradient(60% 55% at 50% 46%, rgba(0, 150, 255, 0.42), transparent 70%)',
      'radial-gradient(38% 34% at 34% 36%, rgba(120, 60, 255, 0.42), transparent 72%)',
      'radial-gradient(40% 38% at 66% 58%, rgba(0, 210, 190, 0.34), transparent 74%)',
      'conic-gradient(from 210deg at 50% 48%, rgba(255, 255, 255, 0.09), transparent 28%, rgba(255, 255, 255, 0.06) 64%, transparent)',
    ],
  },
  {
    id: 'fluent-flow',
    name: { ar: 'انسياب', fr: 'Flux', en: 'Flow' },
    base: '#0a0b14',
    light: false,
    photo: null,
    layers: [
      'linear-gradient(120deg, rgba(64, 92, 255, 0.34), transparent 46%)',
      'linear-gradient(300deg, rgba(0, 190, 255, 0.28), transparent 52%)',
      'radial-gradient(70% 60% at 78% 18%, rgba(255, 90, 170, 0.22), transparent 70%)',
    ],
  },
  {
    id: 'ledger-grid',
    name: { ar: 'شبكة الأستاذ', fr: 'Grille comptable', en: 'Ledger Grid' },
    base: '#071a17',
    light: false,
    photo: null,
    layers: [
      'radial-gradient(80% 70% at 50% 0%, rgba(16, 185, 129, 0.26), transparent 70%)',
      'linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
      'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
    ],
  },
  {
    id: 'sahara',
    name: { ar: 'الصحراء', fr: 'Sahara', en: 'Sahara' },
    base: '#1a1008',
    light: false,
    photo: null,
    layers: [
      'radial-gradient(70% 60% at 30% 20%, rgba(251, 191, 36, 0.32), transparent 68%)',
      'radial-gradient(60% 60% at 78% 76%, rgba(217, 119, 6, 0.32), transparent 70%)',
      'linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, 0.45))',
    ],
  },
  {
    id: 'paper',
    name: { ar: 'ورق', fr: 'Papier', en: 'Paper' },
    base: '#eef1f6',
    light: true,
    photo: null,
    layers: [
      'radial-gradient(60% 50% at 50% 30%, rgba(0, 103, 192, 0.16), transparent 72%)',
      'radial-gradient(50% 45% at 22% 78%, rgba(124, 58, 237, 0.12), transparent 74%)',
    ],
  },
  {
    id: 'void',
    name: { ar: 'سادة', fr: 'Uni', en: 'Solid' },
    base: '#0b0b0f',
    light: false,
    photo: null,
    layers: [],
  },
];

/**
 * The CSS `background-image` for a wallpaper: scrims first, photograph last, so
 * the layers paint over the picture rather than under it.
 */
export const wallpaperImage = (paper: Wallpaper): string =>
  (paper.photo === null ? paper.layers : [...paper.layers, `url(${paper.photo})`]).join(', ');

export const wallpaperById = (id: string): Wallpaper => WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];

/* ------------------------------------------------------------------ *
 * Accent shading
 * ------------------------------------------------------------------ */

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const parseHex = (hex: string): Rgb => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) return { r: 0, g: 103, b: 192 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;

const mix = (colour: Rgb, target: Rgb, amount: number): Rgb => ({
  r: colour.r + (target.r - colour.r) * amount,
  g: colour.g + (target.g - colour.g) * amount,
  b: colour.b + (target.b - colour.b) * amount,
});

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Relative luminance, used to pick readable text over the accent. */
const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/**
 * The accent ramp Fluent expects. Windows derives light1/light2 and dark1/dark2
 * from the chosen accent; the same tint ladder is reproduced here so any hex the
 * user picks produces a coherent palette. `--fx-on-accent` is the foreground
 * that stays legible on it, chosen by relative luminance rather than by taste.
 */
export function accentVariables(hex: string): Readonly<Record<string, string>> {
  const base = parseHex(hex);
  return {
    '--fx-accent': toHex(base),
    '--fx-accent-light1': toHex(mix(base, WHITE, 0.22)),
    '--fx-accent-light2': toHex(mix(base, WHITE, 0.42)),
    '--fx-accent-dark1': toHex(mix(base, BLACK, 0.2)),
    '--fx-accent-dark2': toHex(mix(base, BLACK, 0.38)),
    '--fx-accent-text': toHex(mix(base, WHITE, 0.55)),
    '--fx-on-accent': luminance(base) > 0.45 ? '#000000' : '#ffffff',
  };
}

/* ------------------------------------------------------------------ *
 * Registry projection
 * ------------------------------------------------------------------ */

const THEMES: readonly ThemeName[] = ['dark', 'light'];
const LANGS: readonly ShellLang[] = ['ar', 'fr', 'en'];
const ICON_SIZES: readonly IconSize[] = ['small', 'medium', 'large'];

const oneOf = <T extends string>(value: string, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Reads the whole appearance model out of the registry in one pass. */
export function readAppearance(registry: RegistrySubsystem): Appearance {
  return {
    theme: oneOf(registry.getString(REG.userAppearance, 'Theme', 'dark'), THEMES, 'dark'),
    accent: registry.getString(REG.userAppearance, 'Accent', '#0067c0'),
    transparency: registry.getBoolean(REG.userAppearance, 'Transparency', true),
    animations: registry.getBoolean(REG.userAppearance, 'Animations', true),
    language: oneOf(registry.getString(REG.userAppearance, 'Language', 'en'), LANGS, 'en'),
    wallpaper: registry.getString(REG.userDesktop, 'Wallpaper', 'summit'),
    iconSize: oneOf(registry.getString(REG.userDesktop, 'IconSize', 'medium'), ICON_SIZES, 'medium'),
    showDesktopIcons: registry.getBoolean(REG.userDesktop, 'ShowIcons', true),
    taskbarAlignment: registry.getString(REG.userTaskbar, 'Alignment', 'center') === 'start' ? 'start' : 'center',
    taskbarAutoHide: registry.getBoolean(REG.userTaskbar, 'AutoHide', false),
    showSearch: registry.getBoolean(REG.userTaskbar, 'ShowSearch', true),
    showTaskView: registry.getBoolean(REG.userTaskbar, 'ShowTaskView', true),
    showWidgets: registry.getBoolean(REG.userTaskbar, 'ShowWidgets', true),
  };
}

/** Icon pixel size for each desktop icon-size preference. */
export const ICON_PIXELS: Readonly<Record<IconSize, number>> = { small: 32, medium: 44, large: 56 };
