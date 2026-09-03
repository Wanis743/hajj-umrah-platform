/**
 * Manifest icon names → logo artwork.
 *
 * An app names its icon as a string (`'book-open'`), and {@link glyphFor}
 * resolves that name to a Lucide glyph the shell strokes on a category-tinted
 * plate. That plate is a *placeholder*: it gives 16 apps a coherent Start menu
 * without anyone drawing anything. Real artwork replaces it, which is what
 * Windows does for an installed app — the logo is the identity, not the tile
 * behind it.
 *
 * To ship a logo, drop a file into `./logos` named after the manifest's `icon`
 * value: `book-open.png` claims the Journal, `wallet.png` the Treasury. Nothing
 * else has to change. The build discovers whatever is in the folder, so an app
 * with no artwork keeps the glyph and an app with artwork loses the plate,
 * without a table anywhere that could fall out of step with the files.
 *
 * SVG wins over PNG of the same name, because the shell paints app icons at eight
 * sizes between 16px and 56px and one vector covers all of them. The shipped set
 * is raster — it is the artwork as drawn, and matching the delivered file beats
 * re-cutting someone's mark as paths. Replacing a raster icon therefore means
 * deleting any `.svg` of the same name, or the vector keeps winning.
 *
 * This table lives in the SDK next to `glyphs.ts` for the same reason that one
 * does — the shell paints Start tiles and taskbar buttons from it, and an app
 * that lists other apps has to reach the same artwork without importing the
 * shell, which the boundary forbids it.
 */

/**
 * Vite resolves both globs at build time, so the bundle contains exactly the
 * artwork that exists and a missing logo is a compile-time absence rather than
 * a 404 at paint time.
 */
const RASTER = import.meta.glob<string>('./logos/*.png', { eager: true, query: '?url', import: 'default' });
const VECTOR = import.meta.glob<string>('./logos/*.svg', { eager: true, query: '?url', import: 'default' });

/** `./logos/book-open.svg` → `book-open`. */
const nameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1).replace(/\.(?:svg|png)$/, '');

const collect = (files: Readonly<Record<string, string>>): readonly (readonly [string, string])[] =>
  Object.entries(files).map(([file, url]) => [nameOf(file), url] as const);

/** Every icon name this image ships artwork for. Vector overrides raster. */
export const APP_LOGOS: Readonly<Record<string, string>> = Object.fromEntries([
  ...collect(RASTER),
  ...collect(VECTOR),
]);

/** The logo for a manifest icon name, or null when the glyph should be used. */
export function logoFor(name: string): string | null {
  return APP_LOGOS[name] ?? null;
}
