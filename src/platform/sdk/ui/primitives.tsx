/**
 * Fluent UI kit — primitives.
 *
 * The controls every Finance OS app uses. Each one renders the Windows 11
 * control states declared in `platform/shell/fluent.css` (`.fx-*`), so an app
 * never hand-writes chrome and the whole OS stays visually coherent.
 *
 * These components are presentation only: no syscalls, no data access.
 */
import clsx from 'clsx';
import { Check, ChevronDown, Search, X, type LucideIcon } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { toneColor, type ButtonVariant, type ControlSize, type Tone } from './tokens';

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

export interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
  /** Fills the available inline space (dialog footers, side panels). */
  block?: boolean;
}

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  icon: LeadingIcon,
  trailingIcon: TrailingIcon,
  disabled,
  busy,
  title,
  type = 'button',
  className,
  block,
}: ButtonProps) {
  const glyph = size === 'lg' ? 18 : size === 'sm' ? 13 : 15;
  return (
    <button
      type={type}
      className={clsx('fx-btn', className)}
      data-variant={variant}
      data-size={size}
      style={block ? { width: '100%' } : undefined}
      disabled={disabled === true || busy === true}
      title={title}
      onClick={onClick}
    >
      {busy === true ? <Spinner size={glyph} /> : LeadingIcon ? <LeadingIcon size={glyph} /> : null}
      {children}
      {TrailingIcon ? <TrailingIcon size={glyph} /> : null}
    </button>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  tone?: Tone;
  className?: string;
}

/** Square 32px command button — toolbars, title bars, grid row actions. */
export function IconButton({
  icon: Glyph,
  label,
  onClick,
  active,
  disabled,
  size = 16,
  tone,
  className,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={clsx('fx-icon-btn', className)}
      data-active={active === true ? 'true' : undefined}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={tone !== undefined && active !== true ? { color: toneColor(tone) } : undefined}
    >
      <Glyph size={size} />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Text input
 * ------------------------------------------------------------------ */

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'onChange' | 'value' | 'size'> {
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  mono?: boolean;
  className?: string;
  onEnter?: () => void;
  onEscape?: () => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { value, onChange, invalid, mono, className, onEnter, onEscape, ...rest },
  ref,
) {
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && onEnter) {
      event.preventDefault();
      onEnter();
    } else if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      onEscape();
    }
  };
  return (
    <input
      {...rest}
      ref={ref}
      className={clsx('fx-input', mono === true && 'fx-input-mono', className)}
      data-invalid={invalid === true ? 'true' : undefined}
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      onKeyDown={handleKey}
      spellCheck={false}
      autoComplete="off"
    />
  );
});

export interface TextAreaProps {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  className?: string;
}

export function TextArea({ value, onChange, rows = 4, placeholder, mono, disabled, className }: TextAreaProps) {
  return (
    <textarea
      className={clsx('fx-input', mono === true && 'fx-input-mono', className)}
      style={{ resize: 'vertical', minHeight: rows * 20 + 12, lineHeight: 1.45 }}
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export interface SearchBoxProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  width?: number | string;
  autoFocus?: boolean;
  onEnter?: () => void;
  className?: string;
}

/** Fluent search field with inline glyph and clear affordance. */
export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  { value, onChange, placeholder, width = 240, autoFocus, onEnter, className },
  ref,
) {
  return (
    <div className={clsx('fx-search', className)} style={{ position: 'relative', width }}>
      <Search
        size={14}
        style={{
          position: 'absolute',
          insetInlineStart: 9,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--fx-text-tertiary)',
          pointerEvents: 'none',
        }}
      />
      <Input
        ref={ref}
        value={value}
        onChange={onChange}
        onEnter={onEnter}
        onEscape={() => onChange('')}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ paddingInlineStart: 30, paddingInlineEnd: value === '' ? 10 : 28 }}
      />
      {value !== '' ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange('')}
          style={{
            position: 'absolute',
            insetInlineEnd: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 22,
            height: 22,
            borderRadius: 4,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--fx-text-secondary)',
          }}
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * Selection controls
 * ------------------------------------------------------------------ */

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  /** Tri-state for grid "select all" headers. */
  indeterminate?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled, indeterminate }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate === true ? 'mixed' : checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        opacity: disabled === true ? 0.5 : 1,
        textAlign: 'start',
      }}
    >
      <span className="fx-checkbox" data-checked={checked || indeterminate === true ? 'true' : 'false'}>
        {indeterminate === true ? (
          <span style={{ width: 8, height: 2, borderRadius: 1, background: 'currentColor' }} />
        ) : (
          <Check size={13} strokeWidth={3} />
        )}
      </span>
      {label !== undefined ? <span style={{ fontSize: 'var(--fx-body)' }}>{label}</span> : null}
    </button>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        opacity: disabled === true ? 0.5 : 1,
      }}
    >
      <span className="fx-switch" data-checked={checked ? 'true' : 'false'}>
        <span className="fx-switch-thumb" />
      </span>
      {label !== undefined ? <span style={{ fontSize: 'var(--fx-body)' }}>{label}</span> : null}
    </button>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (next: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
  className?: string;
}

/** Native select styled as a Fluent combo box (keeps keyboard semantics). */
export function Select({ value, onChange, options, placeholder, disabled, width, className }: SelectProps) {
  return (
    <div style={{ position: 'relative', width: width ?? '100%' }} className={className}>
      <select
        className="fx-input"
        style={{ appearance: 'none', paddingInlineEnd: 28, cursor: 'default' }}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          insetInlineEnd: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--fx-text-secondary)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: LucideIcon;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: readonly SegmentedOption<T>[];
  size?: 'sm' | 'md';
}

/** Compact mutually-exclusive selector (view switchers, period toggles). */
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: SegmentedProps<T>) {
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 2,
        gap: 2,
        borderRadius: 'var(--fx-radius-control)',
        background: 'var(--fx-control)',
        border: '1px solid var(--fx-control-stroke)',
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Glyph = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: size === 'sm' ? 22 : 26,
              paddingInline: 10,
              borderRadius: 3,
              fontSize: size === 'sm' ? 11 : 'var(--fx-caption)',
              fontWeight: selected ? 600 : 400,
              background: selected ? 'var(--fx-accent)' : 'transparent',
              color: selected ? 'var(--fx-on-accent)' : 'var(--fx-text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            {Glyph ? <Glyph size={13} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface SliderProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, disabled }: SliderProps) {
  return (
    <input
      type="range"
      className="fx-slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  title?: string;
}

export function Badge({ children, tone = 'neutral', icon: Glyph, title }: BadgeProps) {
  return (
    <span className="fx-badge" data-tone={tone} title={title}>
      {Glyph ? <Glyph size={11} /> : null}
      {children}
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="fx-spinner"
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)) }}
      role="status"
      aria-label="Loading"
    />
  );
}

export interface ProgressBarProps {
  /** 0–1. Omit for the indeterminate animation. */
  value?: number | null;
  tone?: Tone;
  height?: number;
}

export function ProgressBar({ value, tone = 'accent', height = 4 }: ProgressBarProps) {
  const indeterminate = value === null || value === undefined;
  const pct = indeterminate ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="fx-progress"
      style={{ height }}
      data-indeterminate={indeterminate ? 'true' : undefined}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div
        className="fx-progress-fill"
        style={{
          width: indeterminate ? undefined : `${pct}%`,
          background: tone === 'accent' ? 'var(--fx-accent)' : toneColor(tone),
        }}
      />
    </div>
  );
}

export interface MeterProps {
  value: number;
  max: number;
  tone?: Tone;
  label?: string;
}

/** Labelled utilisation meter — budgets, quotas, Task Manager gauges. */
export function Meter({ value, max, tone = 'accent', label }: MeterProps) {
  const ratio = max > 0 ? value / max : 0;
  const auto: Tone = ratio > 1 ? 'danger' : ratio > 0.9 ? 'warning' : tone;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {label !== undefined ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fx-caption)' }}>
          <span style={{ color: 'var(--fx-text-secondary)' }}>{label}</span>
          <span style={{ color: auto === 'accent' ? 'var(--fx-text-secondary)' : toneColor(auto), fontWeight: 600 }}>
            {Math.round(ratio * 100)}%
          </span>
        </div>
      ) : null}
      <ProgressBar value={Math.min(1, ratio)} tone={auto} height={6} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Delay before showing, matching the Windows 11 tooltip cadence. */
  delayMs?: number;
}

export function Tooltip({ content, children, delayMs = 450 }: TooltipProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const anchor = useRef<HTMLSpanElement | null>(null);

  const show = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) setPosition({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
    }, delayMs);
  }, [delayMs]);

  const hide = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPosition(null);
  }, []);

  return (
    <span ref={anchor} onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide} style={{ display: 'inline-flex' }}>
      {children}
      {position !== null ? (
        <span className="fx-tooltip" style={{ left: position.x, top: position.y, transform: 'translateX(-50%)' }}>
          {content}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Form field
 * ------------------------------------------------------------------ */

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Renders label and control side by side (Settings pages). */
  horizontal?: boolean;
}

export function Field({ label, children, hint, error, required, horizontal }: FieldProps) {
  const id = useId();
  if (horizontal === true) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '10px 0',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fx-body)' }}>{label}</div>
          {hint !== undefined ? (
            <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)', marginTop: 2 }}>{hint}</div>
          ) : null}
        </div>
        <div style={{ flex: 'none' }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <label htmlFor={id} style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>
        {label}
        {required === true ? <span style={{ color: 'var(--fx-danger)' }}> *</span> : null}
      </label>
      {children}
      {error !== null && error !== undefined && error !== '' ? (
        <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-danger)' }}>{error}</div>
      ) : hint !== undefined ? (
        <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)' }}>{hint}</div>
      ) : null}
    </div>
  );
}
