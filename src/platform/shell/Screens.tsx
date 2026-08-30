/**
 * Full-screen shell surfaces: boot, lock, and the power transitions.
 *
 * These are the moments the desktop is not there. Windows shows a logo and a
 * spinner while the session is built, a wallpapered clock when it is locked, and
 * a flat "Shutting down" screen on the way out. The same three, with one rule
 * kept throughout: nothing here pretends. The boot screen reports the kernel's
 * *actual* latest System-channel event, the lock screen does not ask for a
 * password it could not verify (the real credential belongs to the host
 * application, not to this shell), and the shutdown screen only claims the
 * system is off once the kernel has really halted.
 */
import { LockKeyhole, Power } from 'lucide-react';
import { useKernelView, useKernel, useWallClock } from './bindings';
import { wallpaperById, type Appearance } from './appearance';
import { WallpaperLayer } from './Wallpaper';
import type { AppLocale } from '../sdk';
import { fmt } from '../sdk';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

export interface BootScreenProps {
  readonly locale: AppLocale;
}

export function BootScreen({ locale }: BootScreenProps) {
  const kernel = useKernel();
  // The newest System event is whatever the kernel is doing right now: mounting
  // volumes, starting services, hydrating the registry.
  const latest = useKernelView(kernel.eventLog, () => kernel.eventLog.query({ channel: 'System', limit: 1 })[0]);

  return (
    <div className="fx-screen fx-screen-boot" role="status" aria-live="polite">
      <div className="fx-boot-mark">
        <span className="fx-boot-logo">₣</span>
        <span className="fx-boot-name">Finance OS</span>
      </div>
      <div className="fx-spinner" aria-hidden="true" />
      <p className="fx-boot-step fx-caption-text">
        {latest === undefined
          ? locale.tr('جارٍ التشغيل…', 'Démarrage…', 'Starting up…')
          : latest.message}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Lock
 * ------------------------------------------------------------------ */

export interface LockScreenProps {
  readonly locale: AppLocale;
  readonly appearance: Appearance;
  readonly onUnlock: () => void;
}

export function LockScreen({ locale, appearance, onUnlock }: LockScreenProps) {
  const kernel = useKernel();
  const now = useWallClock(15_000);
  const principal = kernel.security.principal();
  const paper = wallpaperById(appearance.wallpaper);

  return (
    <div
      className="fx-screen fx-screen-lock"
      role="dialog"
      aria-label={locale.tr('شاشة القفل', 'Écran de verrouillage', 'Lock screen')}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onUnlock();
      }}
    >
      <WallpaperLayer paper={paper} hidden />
      <div className="fx-lock-clock">
        <span className="fx-lock-time">{fmt.time(now, locale.lang)}</span>
        <span className="fx-lock-date">{fmt.date(now, locale.lang)}</span>
      </div>
      <div className="fx-lock-card">
        <span className="fx-lock-avatar">{initials(principal.displayName)}</span>
        <span className="fx-lock-name">{principal.displayName}</span>
        <p className="fx-caption-text">
          {locale.tr(
            'الجلسة مقفلة على هذا الجهاز.',
            'La session est verrouillée sur cet appareil.',
            'This session is locked on this device.',
          )}
        </p>
        <button type="button" className="fx-btn" data-variant="accent" data-size="lg" autoFocus onClick={onUnlock}>
          <LockKeyhole size={16} />
          {locale.tr('إلغاء القفل', 'Déverrouiller', 'Unlock')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Power transitions
 * ------------------------------------------------------------------ */

export type PowerScreenAction = 'shutdown' | 'restart' | 'signout';

export interface PowerScreenProps {
  readonly locale: AppLocale;
  readonly action: PowerScreenAction;
  /** True once the kernel has actually halted; only then is the claim true. */
  readonly halted: boolean;
  /** Offered after a shutdown, exactly like a power button. */
  readonly onPowerOn: () => void;
}

export function PowerScreen({ locale, action, halted, onPowerOn }: PowerScreenProps) {
  const working =
    action === 'restart'
      ? locale.tr('جارٍ إعادة التشغيل…', 'Redémarrage…', 'Restarting…')
      : action === 'signout'
        ? locale.tr('جارٍ تسجيل الخروج…', 'Déconnexion…', 'Signing out…')
        : locale.tr('جارٍ إيقاف التشغيل…', 'Arrêt en cours…', 'Shutting down…');

  const finished = locale.tr(
    'تم إيقاف النظام. يمكنك إعادة التشغيل.',
    'Le système est arrêté. Vous pouvez le rallumer.',
    'The system is off. You can turn it back on.',
  );

  return (
    <div className="fx-screen fx-screen-power" role="status" aria-live="polite">
      {halted && action === 'shutdown' ? (
        <>
          <p className="fx-power-text">{finished}</p>
          <button type="button" className="fx-btn" data-variant="accent" data-size="lg" onClick={onPowerOn}>
            <Power size={16} />
            {locale.tr('تشغيل', 'Allumer', 'Turn on')}
          </button>
        </>
      ) : (
        <>
          <div className="fx-spinner" aria-hidden="true" />
          <p className="fx-power-text">{working}</p>
        </>
      )}
    </div>
  );
}
