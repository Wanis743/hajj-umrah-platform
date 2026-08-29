/**
 * Fluent UI kit — layout and navigation.
 *
 * `AppFrame` is the standard chrome an app builds inside: a command bar, an
 * optional navigation rail, the content region and a status bar. Using it
 * means every window in the OS has the same anatomy, the same spacing and the
 * same scroll behaviour.
 */
import clsx from 'clsx';
import { ChevronRight, Inbox, PanelLeft, PanelRight, X, type LucideIcon } from 'lucide-react';
import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AppRuntimeContext } from '../context';
import { Button, IconButton } from './primitives';
import { fitRails, splitGeometry, useElementWidth, type RailFit } from './responsive';
import { toneColor, toneSurface, type Tone } from './tokens';

/**
 * Trilingual labels for chrome this kit adds on its own — the fold toggles have
 * no author to write their tooltips. The context is read optionally and falls
 * back to English, so every component here still renders outside an app window.
 */
function useKitLabels(): (ar: string, fr: string, en: string) => string {
  const runtime = useContext(AppRuntimeContext);
  return runtime === null ? (_ar, _fr, en) => en : runtime.locale.tr;
}

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
  /** Accessible name for the navigation rail, used once it folds into a drawer. */
  navLabel?: string;
  /** Accessible name for the detail pane, used once it folds into a drawer. */
  asideLabel?: string;
}

interface FoldDrawerProps {
  readonly side: 'start' | 'end';
  readonly title: string;
  readonly closeLabel: string;
  readonly width: number;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** A folded rail, re-offered as a sheet over the content it had to give up. */
function FoldDrawer({ side, title, closeLabel, width, onClose, children }: FoldDrawerProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stop here: the shell closes windows on Escape, and a drawer is a layer
      // of its own, so dismissing it must not also dismiss the app.
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Picking a destination means you are done with the drawer. Only navigation
  // items count — a checkbox or an expander inside the rail is not a departure.
  const dismissOnPick =
    side === 'start'
      ? (event: { target: EventTarget }) => {
          if ((event.target as HTMLElement).closest('.fx-nav-item') !== null) onClose();
        }
      : undefined;

  return (
    <>
      <div className="fx-fold-scrim" onPointerDown={onClose} />
      <aside
        className="fx-fold-sheet"
        data-side={side}
        aria-label={title}
        style={{ width: `min(${width}px, calc(100% - 40px))` }}
        onClick={dismissOnPick}
      >
        <div className="fx-fold-sheet-head">
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fx-caption)', fontWeight: 600 }}>{title}</span>
          <IconButton icon={X} label={closeLabel} onClick={onClose} size={14} />
        </div>
        <div className="fx-fold-sheet-body" data-side={side}>
          {children}
        </div>
      </aside>
    </>
  );
}

interface FrameBarProps {
  readonly commands: ReactNode;
  readonly fold: RailFit;
  readonly open: 'nav' | 'aside' | null;
  readonly navName: string;
  readonly asideName: string;
  readonly onToggle: (side: 'nav' | 'aside') => void;
}

/**
 * The command bar, plus a way back to whichever rails folded. Once folded it
 * wraps instead of scrolling: a command bar can hold an open menu, and a scroll
 * container would clip it.
 */
function FrameBar({ commands, fold, open, navName, asideName, onToggle }: FrameBarProps) {
  const folded = fold.nav || fold.aside;
  return (
    <div className="fx-commandbar" style={folded ? { flexWrap: 'wrap' } : undefined}>
      {fold.nav ? (
        <IconButton icon={PanelLeft} label={navName} active={open === 'nav'} onClick={() => onToggle('nav')} />
      ) : null}
      {commands}
      {fold.aside ? (
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex' }}>
          <IconButton icon={PanelRight} label={asideName} active={open === 'aside'} onClick={() => onToggle('aside')} />
        </span>
      ) : null}
    </div>
  );
}

interface FrameBodyProps {
  readonly nav: ReactNode;
  readonly navWidth: number;
  readonly aside: ReactNode;
  readonly asideWidth: number;
  readonly fold: RailFit;
  readonly padded: boolean | undefined;
  readonly scroll: boolean;
  readonly children: ReactNode;
}

/** The rails that are still in flow, either side of the content region. */
function FrameBody({ nav, navWidth, aside, asideWidth, fold, padded, scroll, children }: FrameBodyProps) {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
      {nav !== undefined && !fold.nav ? (
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
      {aside !== undefined && !fold.aside ? (
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
  );
}

/**
 * The frame folds its rails when its own box gets too narrow to hold them.
 *
 * Two things are deliberate. The trigger is the frame's width and not the
 * screen's, because a quarter-snapped window on a 4K desktop has exactly the
 * problem a phone has — see `fitRails`, whose threshold is chosen so no app can
 * fold at or above its declared `minSize`, which is why nothing on a desktop
 * moves. And a folded rail becomes a drawer rather than disappearing: an app
 * whose navigation is simply gone below 400px is not responsive, it is broken.
 */
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
  navLabel,
  asideLabel,
}: AppFrameProps) {
  const [frame, width] = useElementWidth<HTMLDivElement>();
  const tr = useKitLabels();
  const [drawer, setDrawer] = useState<'nav' | 'aside' | null>(null);
  const close = useCallback(() => setDrawer(null), []);
  const toggle = useCallback((side: 'nav' | 'aside') => {
    setDrawer((current) => (current === side ? null : side));
  }, []);

  const fold = fitRails(width, nav === undefined ? null : navWidth, aside === undefined ? null : asideWidth);
  const folded = fold.nav || fold.aside;
  // Derived, not stored: widening the window puts a rail back in flow, and its
  // drawer has to close in the same paint rather than one effect later.
  const open = drawer !== null && (drawer === 'nav' ? fold.nav : fold.aside) ? drawer : null;
  // …and then forgotten, one paint later. Without this, a window widened past the
  // fold and narrowed again would spring open a drawer the user never asked for
  // twice: the rail came back in flow, which is a dismissal of its own.
  useEffect(() => {
    if (drawer !== null && open === null) setDrawer(null);
  }, [drawer, open]);

  const navName = navLabel ?? tr('التنقل', 'Navigation', 'Navigation');
  const asideName = asideLabel ?? tr('التفاصيل', 'Détails', 'Details');
  const sheet =
    open === null
      ? null
      : open === 'nav'
        ? { side: 'start' as const, title: navName, width: navWidth, content: nav }
        : { side: 'end' as const, title: asideName, width: asideWidth, content: aside };

  return (
    <div
      ref={frame}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        // Only once a drawer is possible, so a desktop frame stays exactly the
        // containing block it has always been.
        position: folded ? 'relative' : undefined,
      }}
    >
      {commands !== undefined || folded ? (
        <FrameBar
          commands={commands}
          fold={fold}
          open={open}
          navName={navName}
          asideName={asideName}
          onToggle={toggle}
        />
      ) : null}
      <FrameBody
        nav={nav}
        navWidth={navWidth}
        aside={aside}
        asideWidth={asideWidth}
        fold={fold}
        padded={padded}
        scroll={scroll}
      >
        {children}
      </FrameBody>
      {status !== undefined ? <div className="fx-statusbar">{status}</div> : null}
      {sheet !== null ? (
        <FoldDrawer
          side={sheet.side}
          title={sheet.title}
          closeLabel={tr('إغلاق', 'Fermer', 'Close')}
          width={sheet.width}
          onClose={close}
        >
          {sheet.content}
        </FoldDrawer>
      ) : null}
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
  const [container, width] = useElementWidth<HTMLDivElement>();
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
  }, [container, direction, min, max]);

  const geometry = splitGeometry(direction, width, size, min);

  return (
    <div
      ref={container}
      style={{
        display: 'flex',
        flexDirection: geometry.column ? 'column' : 'row',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          ...geometry.first,
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
        onPointerDown={
          geometry.stacked
            ? undefined
            : (event) => {
                dragging.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
              }
        }
        style={{ ...geometry.grip, flex: 'none', background: 'var(--fx-divider)', touchAction: 'none' }}
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
