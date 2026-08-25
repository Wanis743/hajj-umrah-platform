import React, { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { agencyConfig } from '@/config/agency';

const BOOT_MS = 1400;

/**
 * Workspace splash shown once per browser session while the shell mounts.
 * Displays the real agency identity — no simulated boot logs.
 */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const tick = window.setInterval(() => {
      setProgress(Math.min(1, (performance.now() - started) / BOOT_MS));
    }, 50);
    const doneTimer = window.setTimeout(onDone, BOOT_MS + 250);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className="absolute inset-0 z-[600] flex cursor-pointer flex-col items-center justify-center bg-[#0a0e14] text-white"
      onClick={onDone}
      role="presentation"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06]">
        <BookOpen className="h-7 w-7 text-white/85" strokeWidth={1.6} />
      </span>
      <h1 className="mt-5 text-lg font-semibold tracking-wide text-white/90">{agencyConfig.name}</h1>
      <p className="mt-1 text-xs text-white/40">Finance</p>

      <div className="mt-8 h-0.5 w-44 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-white/70 transition-[width] duration-100"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
