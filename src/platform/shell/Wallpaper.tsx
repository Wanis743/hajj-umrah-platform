/**
 * The wallpaper layer.
 *
 * Two screens paint it — the desktop and the lock screen — and both have to make
 * the same two decisions: stack the scrims over the photograph in the right
 * order, and tell the stylesheet whether there is a photograph at all, because
 * `background-size: cover` is meaningful for a picture and noise for a gradient.
 * Keeping that in one component is what stops the lock screen from drifting out
 * of step with the desktop it is covering.
 *
 * The colour goes in as `background-color`, not the `background` shorthand: the
 * shorthand resets `background-size` to `auto` *inline*, where no stylesheet can
 * outbid it, and the cover rule would silently do nothing.
 */
import { wallpaperImage, type Wallpaper } from './appearance';

export function WallpaperLayer({ paper, hidden = false }: { paper: Wallpaper; hidden?: boolean }) {
  return (
    <div
      className="fx-wallpaper"
      data-photo={paper.photo === null ? 'false' : 'true'}
      style={{ backgroundColor: paper.base, backgroundImage: wallpaperImage(paper) }}
      aria-hidden={hidden ? 'true' : undefined}
    />
  );
}
