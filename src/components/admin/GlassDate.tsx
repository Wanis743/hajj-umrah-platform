import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Drop-in replacement for <input type="date"> with a glass calendar */
/* ------------------------------------------------------------------ */

export interface GlassDateProps {
 value?: string | null;
 onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
 className?: string;
 disabled?: boolean;
 placeholder?: string;
 id?: string;
 name?: string;
 title?: string;
 min?: string;
 max?: string;
 required?: boolean;
 'aria-label'?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (v?: string | null) => {
 if (!v) return null;
 const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
 if (!m) return null;
 const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
 return Number.isNaN(d.getTime()) ? null : d;
};

export default function GlassDate({
 value, onChange, className = '', disabled, placeholder, id, name, title, min, max, required, ...rest
}: GlassDateProps) {
 const selected = parseISO(value);
 const [open, setOpen] = useState(false);
 const [view, setView] = useState<Date>(() => selected ?? new Date());
 const [rect, setRect] = useState<{ top: number; left: number; drop: 'down' | 'up' } | null>(null);

 const triggerRef = useRef<HTMLButtonElement>(null);
 const popRef = useRef<HTMLDivElement>(null);

 const locale = typeof document !== 'undefined' && document.documentElement.lang ? document.documentElement.lang : 'fr';

 useEffect(() => { if (open) setView(parseISO(value) ?? new Date());   }, [open]);

 const place = useCallback(() => {
  const el = triggerRef.current;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const estimated = 330;
  const below = window.innerHeight - r.bottom;
  const drop: 'down' | 'up' = below < estimated + 16 && r.top > below ? 'up' : 'down';
  const width = 268;
  setRect({
   top: drop === 'down' ? r.bottom + 6 : Math.max(8, r.top - estimated - 6),
   left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8)),
   drop,
  });
 }, []);

 useLayoutEffect(() => {
  if (!open) return;
  place();
  const handler = () => place();
  window.addEventListener('scroll', handler, true);
  window.addEventListener('resize', handler);
  return () => {
   window.removeEventListener('scroll', handler, true);
   window.removeEventListener('resize', handler);
  };
 }, [open, place]);

 useEffect(() => {
  if (!open) return;
  const onDown = (e: MouseEvent) => {
   const target = e.target as Node;
   if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
   setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
  document.addEventListener('mousedown', onDown);
  document.addEventListener('keydown', onKey);
  return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
 }, [open]);

 const commit = (iso: string) => {
  setOpen(false);
  triggerRef.current?.focus();
  onChange?.({
   target: { value: iso, name: name ?? '' },
   currentTarget: { value: iso, name: name ?? '' },
  } as unknown as ChangeEvent<HTMLInputElement>);
 };

 const weekdays = useMemo(() => {
  const base = new Date(2024, 0, 1); // Monday
  return Array.from({ length: 7 }, (_, i) => {
   const d = new Date(base);
   d.setDate(base.getDate() + i);
   return new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(d);
  });
 }, [locale]);

 const cells = useMemo(() => {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const out: (Date | null)[] = Array.from({ length: startOffset }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) out.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (out.length % 7 !== 0) out.push(null);
  return out;
 }, [view]);

 const todayISO = toISO(new Date());
 const selectedISO = selected ? toISO(selected) : '';
 const disabledISO = (iso: string) => (min && iso < min) || (max && iso > max);

 const label = selected
  ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(selected)
  : '';

 return (
  <>
   <button
    ref={triggerRef}
    type="button"
    id={id}
    title={title}
    aria-label={rest['aria-label']}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-required={required}
    disabled={disabled}
    onClick={() => !disabled && setOpen((v) => !v)}
    className={`gsel-trigger gdate-trigger ${open ? 'is-open' : ''} ${selected ? '' : 'is-empty'} ${className.replace(/\binput\b/g, '').trim()}`}
   >
    <CalendarDays className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span className="gsel-value">{label || placeholder || '—'}</span>
        {selected && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="clear"
            onClick={(e) => { e.stopPropagation(); commit(''); }}
            className="gdate-clear"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && rect && createPortal(
        <div
          ref={popRef}
          className={`gsel-pop gdate-pop gsel-${rect.drop}`}
          style={{ top: rect.top, left: rect.left }}
          role="dialog"
        >
          <div className="gdate-head">
            <button type="button" className="gdate-nav" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} aria-label="previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="gdate-title">
              {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(view)}
            </span>
            <button type="button" className="gdate-nav" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} aria-label="next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="gdate-grid gdate-week">
            {weekdays.map((w, i) => <span key={`w-${i}`} className="gdate-wd">{w}</span>)}
          </div>

          <div className="gdate-grid">
            {cells.map((d, i) => {
              if (!d) return <span key={`e-${i}`} />;
              const iso = toISO(d);
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!!disabledISO(iso)}
                  onClick={() => commit(iso)}
                  className={`gdate-day ${iso === selectedISO ? 'is-selected' : ''} ${iso === todayISO ? 'is-today' : ''}`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="gdate-foot">
            <button type="button" className="gdate-quick" onClick={() => commit(todayISO)}>
              {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date())}
            </button>
            <button type="button" className="gdate-quick" onClick={() => commit('')}>—</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
