import React, { useCallback, useEffect, useState } from 'react';
import { OSProvider, useOS } from './os/OSContext';
import { accent, wallpaper } from './os/theme';
import { Desktop } from './os/Desktop';
import { WindowFrame } from './os/Window';
import { MenuBar } from './os/MenuBar';
import { Dock } from './os/Dock';
import { CalendarPanel } from './os/CalendarPanel';
import { Launchpad } from './os/Launchpad';
import { CommandPalette } from './os/CommandPalette';
import { NotificationCenter } from './os/NotificationCenter';
import { BootScreen } from './os/BootScreen';

export interface FinanceOSProps {
  onBack: () => void;
}

const BOOT_FLAG = 'financeos.v2.booted';

/**
 * Finance OS — a true desktop environment for the finance team.
 *
 * Boot screen → wallpaper + desktop icons → real windows (drag, resize,
 * minimize, maximize) → floating taskbar with Start menu, ⌘K palette,
 * notification center, calendar and power menu. Session layout, wallpaper
 * and accent persist across visits.
 */
export default function FinanceOS({ onBack }: FinanceOSProps) {
  const [booted, setBooted] = useState(() => {
    try { return sessionStorage.getItem(BOOT_FLAG) === '1'; } catch { return false; }
  });

  const finishBoot = useCallback(() => {
    try { sessionStorage.setItem(BOOT_FLAG, '1'); } catch { /* ignore */ }
    setBooted(true);
  }, []);

  return (
    <OSProvider>
      <Shell onBack={onBack} booted={booted} onBooted={finishBoot} />
    </OSProvider>
  );
}

function Shell({ onBack, booted, onBooted }: {
  onBack: () => void;
  booted: boolean;
  onBooted: () => void;
}) {
  const { windows, overlay, setOverlay, toggleOverlay, prefs, isAr } = useOS();
  const wp = wallpaper(prefs.wallpaper);
  const brandHex = accent(prefs.accent).brand;

  // Global shell shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleOverlay('palette');
      }
      if (e.key === 'Escape' && overlay) {
        setOverlay(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, setOverlay, toggleOverlay]);

  return (
    <div
      className="finance-os-root finance-font relative h-screen w-full select-none overflow-hidden"
      dir={isAr ? 'rtl' : 'ltr'}
      style={{ ['--brand-500' as string]: brandHex }}
    >
      {/* Wallpaper */}
      <div className="absolute inset-0 transition-colors duration-700" style={{ background: wp.base }}>
        {wp.blobs.map(([color, pos, drift], i) => (
          <div key={i} className={`fos-blob ${drift} ${pos}`} style={{ background: color }} />
        ))}
        {/* fine grid texture */}
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
        {/* vignette for depth */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 10%, transparent 40%, rgba(0,0,0,0.55) 100%)' }} />
      </div>

      {/* Desktop: icons + widgets + context menu */}
      <Desktop />

      {/* Window layer */}
      {windows.map((w) => (
        <WindowFrame key={w.id} win={w} />
      ))}

      {/* Menu bar (top) */}
      <MenuBar onExit={onBack} />

      {/* Overlays */}
      {overlay === 'start' && <Launchpad />}
      {overlay === 'palette' && <CommandPalette onExit={onBack} />}
      {overlay === 'notifications' && <NotificationCenter />}
      {overlay === 'calendar' && <CalendarPanel />}

      {/* Dock (bottom) */}
      <Dock onExit={onBack} />

      {/* Boot splash — once per session */}
      {!booted && <BootScreen onDone={onBooted} />}
    </div>
  );
}
