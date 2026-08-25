import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useOS } from './OSContext';

/** Month calendar popover anchored below the menu-bar clock. */
export function CalendarPanel() {
  const { tr, lang } = useOS();
  const locale = lang === 'ar' || lang === 'dz' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-GB';
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const monthLabel = cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekdayNames = useMemo(() => {
    const base = new Date(2024, 0, 7); // a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
        .toLocaleDateString(locale, { weekday: 'narrow' }));
  }, [locale]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [cursor]);

  return (
    <div className="glass fos-pop absolute end-2 top-[38px] z-[460] w-72 rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <button
          className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label={tr('الشهر السابق', 'Mois précédent', 'Previous month')}
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <span className="text-sm font-semibold capitalize text-white/90">{monthLabel}</span>
        <button
          className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label={tr('الشهر التالي', 'Mois suivant', 'Next month')}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdayNames.map((w) => (
          <span key={w} className="py-1 text-[10px] font-semibold uppercase text-white/35">{w}</span>
        ))}
        {cells.map((d, i) => {
          const isToday = d !== null
            && cursor.getFullYear() === today.getFullYear()
            && cursor.getMonth() === today.getMonth()
            && d === today.getDate();
          return (
            <span
              key={i}
              className={`flex aspect-square items-center justify-center rounded-lg text-[12px] ${
                d === null ? '' : isToday
                  ? 'font-bold text-white'
                  : 'text-white/70 hover:bg-white/10'
              }`}
              style={isToday ? { background: 'var(--brand-500)' } : undefined}
            >
              {d ?? ''}
            </span>
          );
        })}
      </div>
      <div className="mt-3 border-t border-white/10 pt-2 text-center text-[11px] text-white/45">
        {today.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
}
