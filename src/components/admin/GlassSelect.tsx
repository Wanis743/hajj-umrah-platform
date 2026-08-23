import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Drop-in replacement for <Select>. Accepts the very same <option>   */
/*  children (static or mapped) and renders a designed glass popover.  */
/* ------------------------------------------------------------------ */

export interface SelectOptionItem {
  value: string;
  label: ReactNode;
  text: string;
  disabled?: boolean;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

function collect(children: ReactNode, out: SelectOptionItem[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
    if (child.type === 'option') {
      const label = props.children ?? '';
      out.push({
        value: props.value === undefined ? textOf(label) : String(props.value),
        label,
        text: textOf(label),
        disabled: props.disabled,
      });
    } else {
      collect(props.children, out);
    }
  });
}

export interface SelectProps {
  value?: string | number | null;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  title?: string;
  'aria-label'?: string;
  required?: boolean;
}

export default function Select({
  value,
  onChange,
  children,
  className = '',
  disabled,
  placeholder,
  id,
  name,
  title,
  required,
  ...rest
}: SelectProps) {
  const items = useMemo(() => {
    const out: SelectOptionItem[] = [];
    collect(children, out);
    return out;
  }, [children]);

  const current = String(value ?? '');
  const selected = items.find((o) => o.value === current);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; drop: 'down' | 'up' } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const searchable = items.length > 7;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => o.text.toLowerCase().includes(q));
  }, [items, query]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estimated = Math.min(320, filtered.length * 36 + (searchable ? 52 : 0) + 16);
    const below = window.innerHeight - r.bottom;
    const drop: 'down' | 'up' = below < estimated + 16 && r.top > below ? 'up' : 'down';
    setRect({
      top: drop === 'down' ? r.bottom + 6 : Math.max(8, r.top - estimated - 6),
      left: r.left,
      width: r.width,
      drop,
    });
  }, [filtered.length, searchable]);

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
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const idx = filtered.findIndex((o) => o.value === current);
    setCursor(idx >= 0 ? idx : 0);
    if (searchable) window.setTimeout(() => searchRef.current?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (option: SelectOptionItem) => {
    if (option.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (!onChange) return;
    onChange({
      target: { value: option.value, name: name ?? '' },
      currentTarget: { value: option.value, name: name ?? '' },
    } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(filtered.length - 1);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const option = filtered[cursor];
      if (option) {
        e.preventDefault();
        commit(option);
      }
    }
  };

  const label = selected?.label ?? placeholder ?? items[0]?.label ?? '';
  const isPlaceholder = !selected || selected.text.trim() === '';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        aria-label={rest['aria-label']}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`gsel-trigger ${open ? 'is-open' : ''} ${isPlaceholder ? 'is-empty' : ''} ${className.replace(/\binput\b/g, '').trim()}`}
      >
        <span className="gsel-value">{label || placeholder || '—'}</span>
        <ChevronDown className="gsel-caret" aria-hidden="true" />
      </button>

      {open && rect && createPortal(
        <div
          ref={popRef}
          className={`gsel-pop gsel-${rect.drop}`}
          style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
          role="listbox"
          onKeyDown={onKeyDown}
        >
          {searchable && (
            <div className="gsel-search">
              <Search className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                placeholder="…"
                className="gsel-search-input"
              />
              <span className="gsel-count">{filtered.length}</span>
            </div>
          )}
          <div className="gsel-list">
            {filtered.length === 0 && <p className="gsel-empty">—</p>}
            {filtered.map((o, i) => (
              <button
                key={`${o.value}-${i}`}
                type="button"
                role="option"
                aria-selected={o.value === current}
                disabled={o.disabled}
                onMouseEnter={() => setCursor(i)}
                onClick={() => commit(o)}
                className={`gsel-item ${o.value === current ? 'is-active' : ''} ${i === cursor ? 'is-cursor' : ''}`}
              >
                <span className="gsel-item-label">{o.label || <em className="opacity-50">—</em>}</span>
                {o.value === current && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
