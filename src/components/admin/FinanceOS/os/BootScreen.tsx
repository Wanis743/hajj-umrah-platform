import React, { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { OS_VERSION, OS_CODENAME } from './osTypes';

const BOOT_LINES = [
  'Mounting ledger volume ............ OK',
  'Starting journal service .......... OK',
  'Loading chart of accounts ......... OK',
  'Binding reconciliation engine ..... OK',
  'Starting desktop compositor ....... OK',
];

/**
 * The OS boot sequence. Runs once per browser session; click anywhere to skip.
 */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const [lineCount, setLineCount] = useState(0);

  useEffect(() => {
    const lineTimer = window.setInterval(() => {
      setLineCount((c) => Math.min(c + 1, BOOT_LINES.length));
    }, 320);
    const doneTimer = window.setTimeout(onDone, 2300);
    return () => {
      window.clearInterval(lineTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      className="absolute inset-0 z-[200] flex cursor-pointer flex-col items-center justify-center bg-[#05070d] text-white"
      onClick={onDone}
      role="presentation"
    >
      <div className="fos-boot-logo flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-700 shadow-[0_0_60px_rgba(99,102,241,0.5)]">
        <Zap className="h-9 w-9 text-white" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-[0.35em]">
        FINANCE <span className="font-light text-white/60">OS</span>
      </h1>
      <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-white/30">
        {OS_CODENAME} · v{OS_VERSION}
      </p>

      <div className="mt-10 h-1 w-56 overflow-hidden rounded-full bg-white/10">
        <div className="fos-boot-bar relative h-full rounded-full bg-indigo-500">
          <span className="fos-bar-sweep absolute inset-y-0 w-1/3 bg-white/40 blur-sm" />
        </div>
      </div>

      <div className="mt-6 h-20 font-mono text-[10px] leading-5 text-emerald-400/70" dir="ltr">
        {BOOT_LINES.slice(0, lineCount).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>

      <p className="absolute bottom-8 text-[10px] uppercase tracking-[0.25em] text-white/25">
        Press anywhere to skip
      </p>
    </div>
  );
}
