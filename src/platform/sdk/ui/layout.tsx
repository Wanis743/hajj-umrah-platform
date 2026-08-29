/**
 * Fluent UI kit — layout and navigation.
 *
 * `AppFrame` is the standard chrome an app builds inside: a command bar, an
 * optional navigation rail, the content region and a status bar. Using it
 * means every window in the OS has the same anatomy, the same spacing and the
 * same scroll behaviour.
 */
import clsx from 'clsx';
import { ChevronRight, Inbox, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, IconButton } from './primitives';
import { toneColor, toneSurface, type Tone } from './tokens';

/* ------------------------------------------------------------------ *
 * App frame
 * ------------------------------------------------------------------ */

export interface AppFrameProps {
  /** Command bar contents; omit for chrome-free apps (Calculator). */
  commands?: ReactNode;
  /** Left navigation rail. */
  nav?: ReactNode;
  navWidth?: number;
  /** Right detail/inspector pane. */
  aside?: ReactNode;
  asideWidth?: number;
  /** Status bar contents. */
  status?: ReactNode;
  children: ReactNode;
  /** Applies the standard 16px content padding. */
  padded?: boolean;
  /** Lets content scroll instead of clipping (default true). */
  scroll?: boolean;
}

export function AppFrame({
  commands,
  nav,
  navWidth = 220,
  aside,
  asideWidth = 300,
  status,
  children,
  padded,
  scroll = true,
}: AppFrameProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      {commands !== undefined ? <div className="fx-commandbar">{commands}</div> : null}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
        {nav !== undefined ? (
          <div
            style={{
              width: navWidth,
              flex: 'none',
              borderInlineEnd: '1px solid var(--fx-divider)',
              overflow: 'auto',
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              background: 'var(--fx-card-secondary)',
            }}
          >
            {nav}
          </div>
        ) : null}
        <div
          className={scroll ? 'fx-scroll' : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            padding: padded === true ? 16 : 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: scroll ? 'auto' : 'hidden',
          }}
        >
          {children}
        </div>
        {aside !== undefined ? (
          <div
            style={{
              width: asideWidth,
              flex: 'none',
              borderInlineStart: '1px solid var(--fx-divider)',
              overflow: 'auto',
              background: 'var(--fx-card-secondary)',
            }}
          >
            {aside}
          </div>
        ) : null}
      </div>
      {status !== undefined ? <div className="fx-statusbar">{status}</div> : null}
    </div>
  );
}

/** Vertical rule inside a command bar. */
export function ToolbarSeparator() {
  return <span style={{ width: 1, alignSelf: 'stretch', margin: '4px 4px', background: 'var(--fx-divider)' }} />;
}

/** Pushes the remaining command-bar items to the far edge. */
export function ToolbarSpacer() {
  return <span style={{ flex: 1 }} />;
}

export interface StatusItemProps {
  icon?: LucideIcon;
  children: ReactNode;
  tone?: Tone;
  title?: string;
}

export function StatusItem({ icon: Glyph, children, tone, title }: StatusItemProps) {
  const color = tone === undefined || tone === 'neutral' ? undefined : toneColor(tone);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color }} title={title}>
      {Glyph ? <Glyph size={12} /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

export interface NavItemProps {
  icon?: LucideIcon;
  label: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  badge?: number | string | null;
  disabled?: boolean;
  /** Indentation level for nested groups. */
  depth?: number;
}

export function NavItem({ icon: Glyph, label, selected, onClick, badge, disabled, depth = 0 }: NavItemProps) {
  return (
    <button
      type="button"
      className="fx-nav-item"
      data-selected={selected === true ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
      style={{
        paddingInlineStart: 12 + depth * 16,
        opacity: disabled === true ? 0.45 : 1,
        color: selected === true ? 'var(--fx-text-primary)' : 'var(--fx-text-secondary)',
        fontWeight: selected === true ? 600 : 400,
      }}
    >
      {Glyph ? <Glyph size={16} style={{ flex: 'none' }} /> : null}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {badge !== null && badge !== undefined && badge !== 0 ? (
        <span
          style={{
            flex: 'none',
            minWidth: 18,
            height: 18,
            paddingInline: 5,
            borderRadius: 999,
            background: 'var(--fx-accent)',
            color: 'var(--fx-on-accent)',
            fontSize: 10,
            fontWeight: 700,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export function NavGroupLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '10px 12px 4px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--fx-text-tertiary)',
      }}
    >
      {children}
    </div>
  );
}

export interface PivotTab<T extends string> {
  readonly id: T;
  readonly label: ReactNode;
  readonly badge?: number | null;
}

export interface PivotProps<T extends string> {
  tabs: readonly PivotTab<T>[];
  active: T;
  onChange: (next: T) => void;
  className?: string;
}

/** Fluent pivot (underlined tab strip). */
export function Pivot<T extends string>({ tabs, active, onChange, className }: PivotProps<T>) {
  return (
    <div className={clsx('fx-pivot', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className="fx-pivot-item"
          data-selected={tab.id === active ? 'true' : undefined}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge !== null && tab.badge !== undefined && tab.badge > 0 ? (
            <span style={{ marginInlineStart: 6, fontSize: 11, color: 'var(--fx-accent-text)', fontWeight: 700 }}>
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export interface BreadcrumbSegment {
  readonly label: string;
  readonly value: string;
}

export function Breadcrumb({
  segments,
  onNavigate,
}: {
  segments: readonly BreadcrumbSegment[];
  onNavigate: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, overflow: 'hidden' }}>
      {segments.map((segment, index) => (
        <span key={segment.value} style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
          {index > 0 ? <ChevronRight size={13} className="fx-crumb-sep" /> : null}
          <button
            type="button"
            onClick={() => onNavigate(segment.value)}
            style={{
              padding: '3px 7px',
              borderRadius: 4,
              fontSize: 'var(--fx-caption)',
              color: index === segments.length - 1 ? 'var(--fx-text-primary)' : 'var(--fx-text-secondary)',
              fontWeight: index === segments.length - 1 ? 600 : 400,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 200,
            }}
          >
            {segment.label}
          </button>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export interface CardProps {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  padded?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Card({ children, title, subtitle, actions, icon: Glyph, padded = true, className, style }: CardProps) {
  return (
    <section className={clsx('fx-card', className)} style={style}>
      {title !== undefined ? (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 14px',
            borderBottom: '1px solid var(--fx-divider)',
          }}
        >
          {Glyph ? <Glyph size={15} style={{ color: 'var(--fx-text-secondary)', flex: 'none' }} /> : null}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 'var(--fx-body)', fontWeight: 600 }}>{title}</div>
            {subtitle !== undefined ? (
              <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-tertiary)', marginTop: 1 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          {actions !== undefined ? <div style={{ display: 'flex', gap: 4, flex: 'none' }}>{actions}</div> : null}
        </header>
      ) : null}
      <div style={{ padding: padded ? 14 : 0 }}>{children}</div>
    </section>
  );
}

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h3 style={{ fontSize: 'var(--fx-body-large)', fontWeight: 600, margin: 0 }}>{title}</h3>
        {action !== undefined ? <div style={{ marginInlineStart: 'auto' }}>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Fluent info bar — inline, non-blocking status inside a window. */
export function InfoBar({
  tone = 'info',
  title,
  children,
  icon: Glyph,
  onDismiss,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: LucideIcon;
  onDismiss?: () => void;
  action?: ReactNode;
}) {
  const background = toneSurface(tone);
  const foreground = tone === 'accent' ? 'var(--fx-accent-text)' : toneColor(tone);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 'var(--fx-radius-control)',
        background,
        border: '1px solid var(--fx-stroke)',
      }}
      role="status"
    >
      {Glyph ? <Glyph size={16} style={{ color: foreground, flex: 'none', marginTop: 1 }} /> : null}
      <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--fx-caption)', lineHeight: 1.5 }}>
        {title !== undefined ? <div style={{ fontWeight: 600, color: foreground }}>{title}</div> : null}
        {children}
      </div>
      {action}
      {onDismiss ? <IconButton icon={X} label="Dismiss" onClick={onDismiss} size={14} /> : null}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Glyph = Inbox, title, description, action, compact }: EmptyStateProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: compact === true ? '28px 16px' : '56px 24px',
        textAlign: 'center',
        color: 'var(--fx-text-secondary)',
      }}
    >
      <Glyph size={compact === true ? 28 : 40} strokeWidth={1.25} style={{ color: 'var(--fx-text-disabled)' }} />
      <div style={{ fontSize: 'var(--fx-body)', fontWeight: 600, color: 'var(--fx-text-primary)' }}>{title}</div>
      {description !== undefined ? (
        <div style={{ fontSize: 'var(--fx-caption)', maxWidth: 380, lineHeight: 1.55 }}>{description}</div>
      ) : null}
      {action !== undefined ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Split pane
 * ------------------------------------------------------------------ */

export interface SplitPaneProps {
  first: ReactNode;
  second: ReactNode;
  /** Initial size of the first pane, in pixels. */
  initial?: number;
  min?: number;
  max?: number;
  direction?: 'horizontal' | 'vertical';
}

/** Draggable two-pane splitter using pointer capture (no drag libraries). */
export function SplitPane({ first, second, initial = 280, min = 160, max = 720, direction = 'horizontal' }: SplitPaneProps) {
  const [size, setSize] = useState(initial);
  const container = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current || !container.current) return;
      const rect = container.current.getBoundingClientRect();
      const raw = direction === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
      setSize(Math.max(min, Math.min(max, raw)));
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [direction, min, max]);

  const horizontal = direction === 'horizontal';
  return (
    <div
      ref={container}
      style={{
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: horizontal ? size : undefined,
          height: horizontal ? undefined : size,
          flex: 'none',
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {first}
      </div>
      <div
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        style={{
          flex: 'none',
          width: horizontal ? 5 : undefined,
          height: horizontal ? undefined : 5,
          cursor: horizontal ? 'col-resize' : 'row-resize',
          background: 'var(--fx-divider)',
          touchAction: 'none',
        }}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {second}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * In-window dialog
 * ------------------------------------------------------------------ */

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** Primary action; rendered as the accent button. */
  primary?: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; danger?: boolean };
  secondaryLabel?: string;
  width?: number;
}

/**
 * A modal scoped to the app's own window (kernel `shell.messageBox` handles
 * system-level modals). Escape closes; the smoke layer absorbs clicks.
 */
export function Dialog({ open, title, children, onClose, primary, secondaryLabel = 'Cancel', width = 460 }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fx-dialog-smoke"
      style={{ position: 'absolute', inset: 0, zIndex: 40 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="fx-dialog" style={{ width: `min(${width}px, calc(100% - 32px))` }} role="dialog" aria-modal="true">
        <div style={{ padding: '20px 24px 4px' }}>
          <h2 style={{ fontFamily: 'var(--fx-font-display)', fontSize: 'var(--fx-subtitle)', fontWeight: 600, margin: 0 }}>
            {title}
          </h2>
        </div>
        <div style={{ padding: '12px 24px 20px', fontSize: 'var(--fx-body)', lineHeight: 1.5 }}>{children}</div>
        <div className="fx-dialog-footer" style={{ padding: '16px 24px' }}>
          {primary !== undefined ? (
            <Button
              variant={primary.danger === true ? 'danger' : 'accent'}
              onClick={primary.onClick}
              disabled={primary.disabled}
              busy={primary.busy}
              block
            >
              {primary.label}
            </Button>
          ) : null}
          <Button onClick={onClose} block>
            {secondaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
