/**
 * Fluent UI kit — primitives.
 *
 * The controls every Finance OS app uses. Since 2026-09-28 these are real
 * Fluent UI React v9 components (`@fluentui/react-components@9.74.7`) rather
 * than hand-written markup over `.fx-*` classes: the keyboard behaviour, focus
 * rings, high-contrast handling and RTL mirroring are Microsoft's, and the
 * colours are ours, because `FluentProvider` in `shell/FinanceOS.tsx` is seeded
 * from the same `var(--fx-*)` ladder `fluent.css` declares.
 *
 * Every exported name and prop signature is unchanged, so the ~200 call sites
 * across the eighteen apps did not move. Where Fluent has no equivalent
 * (`Segmented`), or where its equivalent would leave the app's own window
 * (`Tooltip` portals to `document.body`), the control stays hand-built and says
 * so at its definition.
 *
 * Griffel note: only *longhand* CSS properties below. `makeStyles` expands
 * shorthands unreliably, and `mergeClasses` resolves a conflict in favour of the
 * last class named — which is why an override here beats Fluent's own recipe.
 *
 * These components are presentation only: no syscalls, no data access.
 */
import {
  Badge as FluentBadge,
  Button as FluentButton,
  Checkbox as FluentCheckbox,
  Field as FluentField,
  Input as FluentInput,
  ProgressBar as FluentProgressBar,
  SearchBox as FluentSearchBox,
  Select as FluentSelect,
  Slider as FluentSlider,
  Spinner as FluentSpinner,
  Switch as FluentSwitch,
  Textarea as FluentTextarea,
  ToggleButton,
  makeStyles,
  mergeClasses,
} from '@fluentui/react-components';
import { type LucideIcon } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { toneColor, type ButtonVariant, type ControlSize, type Tone } from './tokens';

/* ------------------------------------------------------------------ *
 * Shared recipes
 *
 * These exist for one of three reasons, never for decoration: Fluent has no
 * such variant (`danger`), Fluent's token for it is outside the set
 * `fluentTheme.ts` pins (`badge*`), or the OS's geometry predates Fluent and
 * eighteen apps measure against it (`segment*`).
 * ------------------------------------------------------------------ */

const useStyles = makeStyles({
  block: { width: '100%' },

  /*
   * Fluent ships primary / secondary / outline / subtle / transparent and no
   * destructive appearance, so `.fx-btn[data-variant='danger']` is restated
   * here: a danger wash that fills solid on hover.
   */
  danger: {
    backgroundColor: 'var(--fx-danger-bg)',
    color: 'var(--fx-danger)',
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    ':hover': { backgroundColor: 'var(--fx-danger)', color: '#ffffff' },
    ':hover:active': { backgroundColor: 'var(--fx-danger)', color: '#ffffff' },
  },

  /*
   * Fluent pins an icon slot to a 20px box. Our glyphs carry their own `size`,
   * and `IconButton` is called with everything from 12 to 28, so the slot is
   * told to take the SVG's word for it.
   */
  glyph: { width: 'auto', height: 'auto', fontSize: 'inherit', lineHeight: 0 },

  /* A toggled command button reads as accent-filled in Windows 11, not as
   * Fluent's neutral "selected" grey. */
  toggled: {
    backgroundColor: 'var(--fx-accent)',
    color: 'var(--fx-on-accent)',
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    ':hover': { backgroundColor: 'var(--fx-accent-light1)', color: 'var(--fx-on-accent)' },
    ':hover:active': { backgroundColor: 'var(--fx-accent-dark1)', color: 'var(--fx-on-accent)' },
  },

  mono: { fontFamily: 'var(--fx-font-mono)', fontVariantNumeric: 'tabular-nums' },

  /* Fluent caps a SearchBox at 468px; ours are sized by their caller. */
  searchRoot: { maxWidth: 'none' },

  textareaRoot: { width: '100%' },
  fullWidth: { width: '100%' },

  segmentWrap: {
    display: 'inline-flex',
    paddingTop: '2px',
    paddingRight: '2px',
    paddingBottom: '2px',
    paddingLeft: '2px',
    columnGap: '2px',
    borderRadius: 'var(--fx-radius-control)',
    backgroundColor: 'var(--fx-control)',
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: 'var(--fx-control-stroke)',
    borderRightColor: 'var(--fx-control-stroke)',
    borderBottomColor: 'var(--fx-control-stroke)',
    borderLeftColor: 'var(--fx-control-stroke)',
  },
  segment: {
    minWidth: 'auto',
    minHeight: '26px',
    height: '26px',
    paddingTop: '0',
    paddingBottom: '0',
    paddingLeft: '10px',
    paddingRight: '10px',
    columnGap: '6px',
    borderRadius: '3px',
    borderTopWidth: '0',
    borderRightWidth: '0',
    borderBottomWidth: '0',
    borderLeftWidth: '0',
    borderTopStyle: 'none',
    borderRightStyle: 'none',
    borderBottomStyle: 'none',
    borderLeftStyle: 'none',
    backgroundColor: 'transparent',
    color: 'var(--fx-text-secondary)',
    fontSize: 'var(--fx-caption)',
    fontWeight: 400,
    whiteSpace: 'nowrap',
  },
  segmentSmall: { minHeight: '22px', height: '22px', fontSize: '11px' },
  segmentOn: {
    backgroundColor: 'var(--fx-accent)',
    color: 'var(--fx-on-accent)',
    fontWeight: 600,
    ':hover': { backgroundColor: 'var(--fx-accent-light1)', color: 'var(--fx-on-accent)' },
    ':hover:active': { backgroundColor: 'var(--fx-accent-dark1)', color: 'var(--fx-on-accent)' },
  },

  /*
   * Badge tones. Fluent's `tint` appearance reaches for `colorPalette*` tokens
   * that `fluentTheme.ts` does not pin, and a badge encodes *meaning* in
   * eighteen apps' tables — drifting it onto Microsoft's palette would change
   * what the UI says. The hairline stays an inset shadow for the reason
   * `fluent.css` gives: a real border adds 2px per axis to every pill.
   */
  badge: {
    height: 'auto',
    minHeight: '16px',
    minWidth: 'auto',
    paddingTop: '1px',
    paddingRight: '8px',
    paddingBottom: '1px',
    paddingLeft: '8px',
    columnGap: '4px',
    borderRadius: '999px',
    borderTopWidth: '0',
    borderRightWidth: '0',
    borderBottomWidth: '0',
    borderLeftWidth: '0',
    borderTopStyle: 'none',
    borderRightStyle: 'none',
    borderBottomStyle: 'none',
    borderLeftStyle: 'none',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
  },
  badgeNeutral: {
    backgroundColor: 'var(--fx-control)',
    color: 'var(--fx-text-secondary)',
    boxShadow: 'inset 0 0 0 1px var(--fx-stroke-card)',
  },
  badgeSuccess: {
    backgroundColor: 'var(--fx-success-bg)',
    color: 'var(--fx-success)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--fx-success) 32%, transparent)',
  },
  badgeWarning: {
    backgroundColor: 'var(--fx-warning-bg)',
    color: 'var(--fx-warning)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--fx-warning) 32%, transparent)',
  },
  badgeDanger: {
    backgroundColor: 'var(--fx-danger-bg)',
    color: 'var(--fx-danger)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--fx-danger) 32%, transparent)',
  },
  badgeInfo: {
    backgroundColor: 'var(--fx-info-bg)',
    color: 'var(--fx-info)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--fx-info) 32%, transparent)',
  },
  badgeAccent: {
    backgroundColor: 'color-mix(in srgb, var(--fx-accent) 20%, transparent)',
    color: 'var(--fx-accent-text)',
    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--fx-accent) 32%, transparent)',
  },

  fieldLabel: {
    fontSize: 'var(--fx-caption)',
    lineHeight: '16px',
    color: 'var(--fx-text-secondary)',
  },
});

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
  /** For an icon-only button, or one whose label differs from its text. */
  'aria-label'?: string;
  /** Set by `SplitButton` on the half that opens the menu. */
  'aria-haspopup'?: 'menu' | 'dialog' | true;
  'aria-expanded'?: boolean;
}

const FLUENT_SIZE: Record<ControlSize, 'small' | 'medium' | 'large'> = {
  sm: 'small',
  md: 'medium',
  lg: 'large',
};

/**
 * Forwards its ref to the real `<button>`, which is how `SplitButton` measures
 * the chevron half in order to hang a menu off it.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
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
    'aria-label': ariaLabel,
    'aria-haspopup': ariaHasPopup,
    'aria-expanded': ariaExpanded,
  },
  ref,
) {
  const styles = useStyles();
  const glyph = size === 'lg' ? 18 : size === 'sm' ? 13 : 15;
  const leading = busy === true ? <Spinner size={glyph} /> : LeadingIcon ? <LeadingIcon size={glyph} /> : undefined;
  return (
    <FluentButton
      ref={ref}
      type={type}
      appearance={variant === 'accent' ? 'primary' : variant === 'subtle' ? 'subtle' : 'secondary'}
      size={FLUENT_SIZE[size]}
      icon={leading === undefined ? undefined : { className: styles.glyph, children: leading }}
      disabled={disabled === true || busy === true}
      title={title}
      aria-label={ariaLabel}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      className={mergeClasses(
        variant === 'danger' && styles.danger,
        block === true && styles.block,
        className,
      )}
    >
      {children}
      {TrailingIcon ? <TrailingIcon size={glyph} /> : null}
    </FluentButton>
  );
});

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

/**
 * Square 32px command button — toolbars, title bars, grid row actions.
 *
 * `active` decides the element: a plain `Button` when the prop is absent, so no
 * `aria-pressed` is announced on a one-shot command, and a `ToggleButton` when
 * it is present, so the pressed state is announced exactly once.
 */
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
  const styles = useStyles();
  const shared = {
    appearance: 'subtle' as const,
    icon: { className: styles.glyph, children: <Glyph size={size} /> },
    disabled,
    title: label,
    'aria-label': label,
    onClick,
    style: tone !== undefined && active !== true ? { color: toneColor(tone) } : undefined,
  };
  return active === undefined ? (
    <FluentButton {...shared} className={className} />
  ) : (
    <ToggleButton
      {...shared}
      checked={active}
      className={mergeClasses(active === true && styles.toggled, className)}
    />
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

/**
 * `ref`, and every native attribute passed through, reach the real `<input>`:
 * it is Fluent's primary slot. `className` and `style` reach the root `<span>`
 * that carries the border — which is the element a caller sizing a field to
 * 142px actually means.
 *
 * Slot props are assembled conditionally rather than spread with `undefined`
 * holes, because `slot.always` merges by plain object spread: an explicit
 * `undefined` would erase the `id` and `aria-invalid` a surrounding `Field`
 * injects.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { value, onChange, invalid, mono, className, onEnter, onEscape, style, children: _children, ...rest },
  ref,
) {
  const styles = useStyles();
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && onEnter) {
      event.preventDefault();
      onEnter();
    } else if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      onEscape();
    }
  };
  const input: Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> = {
    ...rest,
    onKeyDown: handleKey,
    spellCheck: false,
    autoComplete: 'off',
  };
  if (mono === true) input.className = styles.mono;
  if (invalid === true) input['aria-invalid'] = true;
  return (
    <FluentInput
      ref={ref}
      className={className}
      style={style}
      value={value}
      onChange={(_, data) => onChange(data.value)}
      input={input}
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
  const styles = useStyles();
  return (
    <FluentTextarea
      className={mergeClasses(styles.textareaRoot, className)}
      style={{ minHeight: rows * 20 + 12 }}
      resize="vertical"
      value={value}
      disabled={disabled}
      onChange={(_, data) => onChange(data.value)}
      textarea={{
        rows,
        placeholder,
        spellCheck: false,
        className: mono === true ? styles.mono : undefined,
      }}
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

/**
 * Fluent search field. The magnifier and the clear button are Fluent's own
 * slots now, which retires the hand-positioned glyph and the
 * `paddingInlineStart: 30` that compensated for it.
 *
 * `dismiss={null}` while the box is empty: Fluent renders its clear button
 * unconditionally, and this OS only ever showed one when there was something to
 * clear.
 */
export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  { value, onChange, placeholder, width = 240, autoFocus, onEnter, className },
  ref,
) {
  const styles = useStyles();
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && onEnter) {
      event.preventDefault();
      onEnter();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onChange('');
    }
  };
  return (
    <FluentSearchBox
      ref={ref}
      className={mergeClasses(styles.searchRoot, className)}
      style={{ width }}
      value={value}
      placeholder={placeholder}
      onChange={(_, data) => onChange(data.value)}
      dismiss={value === '' ? null : {}}
      input={{ autoFocus, spellCheck: false, autoComplete: 'off', onKeyDown: handleKey }}
    />
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
    <FluentCheckbox
      checked={indeterminate === true ? 'mixed' : checked}
      disabled={disabled}
      onChange={(_, data) => onChange(data.checked === true)}
      label={label === undefined ? undefined : { children: label }}
    />
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
    <FluentSwitch
      checked={checked}
      disabled={disabled}
      onChange={(_, data) => onChange(data.checked)}
      label={label === undefined ? undefined : { children: label }}
    />
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

/** Native select in Fluent chrome — keeps the platform's keyboard semantics. */
export function Select({ value, onChange, options, placeholder, disabled, width, className }: SelectProps) {
  return (
    <FluentSelect
      className={className}
      style={{ width: width ?? '100%' }}
      value={value}
      disabled={disabled}
      onChange={(_, data) => onChange(data.value)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </FluentSelect>
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

/**
 * Compact mutually-exclusive selector (view switchers, period toggles).
 *
 * Fluent has no segmented control. Each cell is a real `ToggleButton`, so focus
 * and press states are Fluent's, inside the pill this OS has always drawn.
 */
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: SegmentedProps<T>) {
  const styles = useStyles();
  return (
    <div className={styles.segmentWrap}>
      {options.map((option) => {
        const selected = option.value === value;
        const Glyph = option.icon;
        return (
          <ToggleButton
            key={option.value}
            appearance="transparent"
            size="small"
            checked={selected}
            onClick={() => onChange(option.value)}
            icon={Glyph ? { className: styles.glyph, children: <Glyph size={13} /> } : undefined}
            className={mergeClasses(
              styles.segment,
              size === 'sm' && styles.segmentSmall,
              selected && styles.segmentOn,
            )}
          >
            {option.label}
          </ToggleButton>
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
  const styles = useStyles();
  return (
    <FluentSlider
      className={styles.fullWidth}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(_, data) => onChange(data.value)}
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
  const styles = useStyles();
  const toneClass =
    tone === 'success'
      ? styles.badgeSuccess
      : tone === 'warning'
        ? styles.badgeWarning
        : tone === 'danger'
          ? styles.badgeDanger
          : tone === 'info'
            ? styles.badgeInfo
            : tone === 'accent'
              ? styles.badgeAccent
              : styles.badgeNeutral;
  return (
    <FluentBadge
      appearance="tint"
      size="small"
      title={title}
      className={mergeClasses(styles.badge, toneClass)}
      icon={Glyph ? { className: styles.glyph, children: <Glyph size={11} /> } : undefined}
    >
      {children}
    </FluentBadge>
  );
}

/**
 * Fluent's named spinner sizes start at 20px and this OS asks for 13 inside a
 * 26px button, so the pixel API is kept and handed to the ring itself.
 */
export function Spinner({ size = 16 }: { size?: number }) {
  return <FluentSpinner size="tiny" spinner={{ style: { width: size, height: size } }} />;
}

export interface ProgressBarProps {
  /** 0–1. Omit for the indeterminate animation. */
  value?: number | null;
  tone?: Tone;
  height?: number;
}

/**
 * Fluent's `thickness` is medium(2px) or large(4px) and its `color` union maps
 * to palette tokens `fluentTheme.ts` does not pin, so both arrive as style:
 * the height a caller asked for, and the tone this OS means by it. `value`
 * omitted is Fluent's own indeterminate signal, and its `max` already defaults
 * to 1 — the same 0–1 domain this component has always taken.
 */
export function ProgressBar({ value, tone = 'accent', height = 4 }: ProgressBarProps) {
  const indeterminate = value === null || value === undefined;
  return (
    <FluentProgressBar
      style={{ height }}
      value={indeterminate ? undefined : Math.max(0, Math.min(1, value))}
      bar={{
        style: { backgroundColor: tone === 'accent' ? 'var(--fx-accent)' : toneColor(tone) },
      }}
    />
  );
}

export interface MeterProps {
  value: number;
  max: number;
  tone?: Tone;
  label?: string;
}

/** Labelled utilisation meter — budgets, quotas, storage gauges. */
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
 *
 * Hand-built, deliberately. Fluent's Tooltip portals to `document.body`, and
 * an OS window is an `overflow: hidden` box inside a z-index band — a portalled
 * tip would draw outside its own window, over the taskbar. This one is a child
 * of its anchor and stays inside the band.
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

/**
 * Vertical fields are Fluent's `Field`, which repairs a real defect: the old
 * label's `htmlFor` named an id no child ever received, so clicking a field
 * label focused nothing. Fluent passes a generated id down by context, and
 * every control in this file reads it.
 *
 * Horizontal fields stay hand-built. Fluent's horizontal orientation is a
 * 33%/1fr grid that only moves the label and still prints the hint *below* the
 * control; this is a Windows Settings row — label and hint on the left, control
 * right-aligned — and sixteen apps' settings pages are built on that shape.
 */
export function Field({ label, children, hint, error, required, horizontal }: FieldProps) {
  const styles = useStyles();
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
  const message = error !== null && error !== undefined && error !== '' ? error : undefined;
  return (
    <FluentField
      label={{ className: styles.fieldLabel, children: label }}
      required={required}
      validationState={message !== undefined ? 'error' : 'none'}
      validationMessage={message}
      validationMessageIcon={null}
      hint={message !== undefined || hint === undefined ? undefined : { children: hint }}
    >
      {children}
    </FluentField>
  );
}
