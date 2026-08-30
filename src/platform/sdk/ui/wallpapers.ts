/**
 * Wallpaper ids → photographic artwork.
 *
 * The gradient wallpapers in `shell/appearance.ts` are CSS and need no asset.
 * A photograph does, and it has to be reachable from two sides of the OS
 * boundary: the shell paints the desktop from it, and Settings shows a thumbnail
 * of it in the personalisation picker. An app may not import the shell, so the
 * bytes live here in the SDK — the same reason `logos.ts` does.
 *
 * To ship one, drop a file into `./wallpapers` named after the wallpaper id it
 * backs: `summit.jpg` claims the wallpaper whose id is `summit`. Nothing else
 * has to change; a `photo` that resolves to null is simply a gradient-only
 * wallpaper, which is what the other five are.
 */

/**
 * Vite resolves the glob at build time, so the bundle carries exactly the
 * artwork that exists and a missing wallpaper is a compile-time absence rather
 * than a 404 behind the desktop.
 */
const PHOTOS = import.meta.glob<string>('./wallpapers/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** `./wallpapers/summit.jpg` → `summit`. */
const nameOf = (file: string): string =>
  file.slice(file.lastIndexOf('/') + 1).replace(/\.(?:jpe?g|png|webp|avif)$/, '');

/** Every wallpaper id this image ships a photograph for. */
export const WALLPAPER_PHOTOS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PHOTOS).map(([file, url]) => [nameOf(file), url] as const),
);

/** The photograph for a wallpaper id, or null when the wallpaper is pure CSS. */
export function wallpaperPhoto(id: string): string | null {
  return WALLPAPER_PHOTOS[id] ?? null;
}
