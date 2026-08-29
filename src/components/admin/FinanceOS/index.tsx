/**
 * Finance OS — the mount point.
 *
 * The admin dashboard's one and only door into the operating system, and the whole of what
 * this file does. Everything a desktop *is* lives in two places: `src/platform` holds the
 * kernel and the shell, and `src/apps` holds the twenty-one applications that ship with
 * this build. Neither knows anything about the dashboard, and the dashboard knows nothing
 * about either beyond the two props below.
 *
 * There are exactly two reasons for the wrapper. `.fos` fills its parent — a desktop is
 * measured against the screen it is on, never against its own contents — so it needs a
 * parent with a height, and `overflow-hidden` keeps a dragged window from growing the
 * page it is drawn on.
 *
 * No state, no storage, no boot flag. The shell owns the session, the profile and the
 * wallpaper, each app's code arrives the first time it is launched, and everything that
 * used to be assembled here — the wallpaper, the dock, the palette, the boot splash — is
 * the shell's own business now.
 */
import { APP_PACKAGES } from '@/apps';
import { FinanceOS as Desktop } from '@/platform/shell';

export interface FinanceOSProps {
  /** Leaves the desktop for the dashboard. Sign out and Start's Back both call it. */
  onBack: () => void;
}

export default function FinanceOS({ onBack }: FinanceOSProps) {
  return (
    <div className="h-screen w-full overflow-hidden">
      <Desktop packages={APP_PACKAGES} onBack={onBack} />
    </div>
  );
}
