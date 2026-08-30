/**
 * Settings — the preference layer.
 *
 * Every switch in this app is a registry value, so the app needs exactly one
 * primitive: a two-way binding to `HKCU`. `useRegistryValue` is that primitive.
 * It writes optimistically and lets the shell notice on its own — the shell reads
 * appearance straight out of the registry subsystem it subscribes to, so a theme
 * flip repaints the desktop without this app telling anybody.
 *
 * The choice lists below name *ids the shell resolves*, not paint. The thumbnail
 * values are a hint for the picker; the desktop owns the real wallpaper, and an
 * id the shell does not know falls back to the first one rather than breaking.
 * Duplicating a handful of colours is the price of the app/shell boundary, and it
 * is cheaper than letting an app import shell internals. The one thing not
 * duplicated is the photograph: that lives in the SDK, which both sides may
 * import, so the picker shows the actual picture rather than a guess at it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { REG, type Localized, type RegistryEntry, type RegistryValue, useApp, wallpaperPhoto } from '@/platform/sdk';

/** The keys the shell reads. Grouped the way the Windows control panel groups them. */
export const KEYS = {
  appearance: REG.userAppearance,
  desktop: REG.userDesktop,
  taskbar: REG.userTaskbar,
  start: REG.userStart,
  session: REG.userSession,
  policy: REG.machinePolicy,
} as const;

export type ThemeName = 'dark' | 'light';
export type IconSize = 'small' | 'medium' | 'large';
export type LangCode = 'ar' | 'dz' | 'fr' | 'en';

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: Localized;
}

export const THEME_CHOICES: readonly Choice<ThemeName>[] = [
  { value: 'dark', label: { ar: 'داكن', fr: 'Sombre', en: 'Dark' } },
  { value: 'light', label: { ar: 'فاتح', fr: 'Clair', en: 'Light' } },
];

export const ICON_SIZE_CHOICES: readonly Choice<IconSize>[] = [
  { value: 'small', label: { ar: 'صغيرة', fr: 'Petites', en: 'Small' } },
  { value: 'medium', label: { ar: 'متوسطة', fr: 'Moyennes', en: 'Medium' } },
  { value: 'large', label: { ar: 'كبيرة', fr: 'Grandes', en: 'Large' } },
];

export const LANG_CHOICES: readonly Choice<LangCode>[] = [
  { value: 'ar', label: { ar: 'العربية', fr: 'Arabe', en: 'Arabic' } },
  { value: 'dz', label: { ar: 'الدارجة', fr: 'Derja', en: 'Derja' } },
  { value: 'fr', label: { ar: 'الفرنسية', fr: 'Français', en: 'French' } },
  { value: 'en', label: { ar: 'الإنجليزية', fr: 'Anglais', en: 'English' } },
];

/** Windows ships a fixed accent palette; these are the eight this OS offers. */
export const ACCENTS: readonly { readonly hex: string; readonly label: Localized }[] = [
  { hex: '#0067c0', label: { ar: 'أزرق', fr: 'Bleu', en: 'Blue' } },
  { hex: '#0e7490', label: { ar: 'سماوي', fr: 'Cyan', en: 'Teal' } },
  { hex: '#0f766e', label: { ar: 'أخضر مزرق', fr: 'Sarcelle', en: 'Sea' } },
  { hex: '#15803d', label: { ar: 'أخضر', fr: 'Vert', en: 'Green' } },
  { hex: '#a16207', label: { ar: 'عنبري', fr: 'Ambre', en: 'Amber' } },
  { hex: '#b91c1c', label: { ar: 'أحمر', fr: 'Rouge', en: 'Red' } },
  { hex: '#9333ea', label: { ar: 'بنفسجي', fr: 'Violet', en: 'Violet' } },
  { hex: '#475569', label: { ar: 'رمادي', fr: 'Ardoise', en: 'Slate' } },
];

/**
 * The picker's own list, because an app may not import the shell where the
 * wallpapers are defined. `swatch` is a CSS `background` shorthand: a thumbnail
 * of the photograph for the picture wallpaper, and a reduction of the gradient
 * stack for the others — the thumbnail is 96px wide, so the full mesh would only
 * read as mud.
 */
export const WALLPAPER_CHOICES: readonly { readonly id: string; readonly label: Localized; readonly swatch: string }[] = [
  {
    id: 'summit',
    label: { ar: 'القمّة', fr: 'Sommet', en: 'Summit' },
    swatch: `#060f13 url(${wallpaperPhoto('summit') ?? ''}) center / cover no-repeat`,
  },
  { id: 'fluent-bloom', label: { ar: 'تفتّح', fr: 'Éclosion', en: 'Bloom' }, swatch: 'radial-gradient(circle at 50% 45%, #1178c9, #04121f 70%)' },
  { id: 'fluent-flow', label: { ar: 'انسياب', fr: 'Flux', en: 'Flow' }, swatch: 'linear-gradient(120deg, #3a51c8, #0a0b14 60%)' },
  { id: 'ledger-grid', label: { ar: 'شبكة الأستاذ', fr: 'Grille', en: 'Ledger Grid' }, swatch: 'linear-gradient(180deg, #12735c, #071a17 70%)' },
  { id: 'sahara', label: { ar: 'الصحراء', fr: 'Sahara', en: 'Sahara' }, swatch: 'linear-gradient(150deg, #c08a1c, #1a1008 72%)' },
  { id: 'paper', label: { ar: 'ورق', fr: 'Papier', en: 'Paper' }, swatch: 'linear-gradient(160deg, #ffffff, #dbe3ef)' },
  { id: 'void', label: { ar: 'سادة', fr: 'Uni', en: 'Solid' }, swatch: '#0b0b0f' },
];

/**
 * Two-way binding to one registry value.
 *
 * The write is fire-and-forget on purpose: `registry.set` under `HKCU` cannot
 * raise a consent prompt, and a failure there is a kernel fault rather than
 * something the user can act on — the next read corrects the display.
 */
export function useRegistryValue<T extends RegistryValue>(key: string, name: string, fallback: T): [T, (next: T) => void] {
  const runtime = useApp();
  const [value, setValue] = useState<T>(fallback);
  // The default doubles as a type probe for the stored value, so it is pinned to
  // first render: a caller passing a fresh literal each render must not restart
  // the read, and re-reading on it would loop.
  const probe = useRef(fallback);

  useEffect(() => {
    let cancelled = false;
    void runtime.invoke('registry.get', { key, name }).then((result) => {
      if (cancelled || !result.ok) return;
      const stored = result.value.value;
      if (stored !== null && typeof stored === typeof probe.current) setValue(stored as T);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, key, name]);

  const write = useCallback(
    (next: T) => {
      setValue(next);
      void runtime.invoke('registry.set', { key, name, value: next });
    },
    [runtime, key, name],
  );

  return [value, write];
}

/** Narrows a stored string to one of a known set, the way the shell does. */
export function oneOf<T extends string>(value: string, allowed: readonly Choice<T>[], fallback: T): T {
  return allowed.some((choice) => choice.value === value) ? (value as T) : fallback;
}

/**
 * Readers over an `enumValues` page.
 *
 * A details pane asks a key for everything at once and then picks values out of
 * the answer, which costs one syscall instead of one per row. The typed readers
 * exist because a registry value is a union: a value written as a number must
 * not silently render as `"true"` because a caller guessed wrong.
 */
export function entryText(entries: readonly RegistryEntry[] | null, name: string, fallback: string): string {
  const entry = entries?.find((candidate) => candidate.name === name);
  return typeof entry?.value === 'string' ? entry.value : fallback;
}

export function entryFlag(entries: readonly RegistryEntry[] | null, name: string): boolean {
  return entries?.find((candidate) => candidate.name === name)?.value === true;
}
