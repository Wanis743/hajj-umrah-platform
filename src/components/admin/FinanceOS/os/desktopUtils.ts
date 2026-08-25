import { nextWallpaperId } from './theme';
import type { OSPrefs } from './osTypes';

/** Advance the desktop wallpaper to the next entry in the wallpaper carousel. */
export function wardrobeWallpaperLabel(prefs: OSPrefs, setPrefs: (p: Partial<OSPrefs>) => void): void {
  setPrefs({ wallpaper: nextWallpaperId(prefs.wallpaper) });
}
