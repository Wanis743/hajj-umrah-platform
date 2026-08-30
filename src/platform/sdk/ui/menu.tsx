/**
 * Fluent UI kit — menus.
 *
 * One implementation serves app menu bars (Notepad's File/Edit/View), grid
 * context menus and jump lists, so keyboard behaviour and edge-flipping are
 * consistent with the shell's own context menus.
 */
import { ChevronRight, Check, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuEntry {
  readonly id: string;
  readonly label?: ReactNode;
  readonly icon?: LucideIcon;
  /** Right-aligned shortcut hint, e.g. `Ctrl+S`. */
  readonly accelerator?: string;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly danger?: boolean;
  readonly kind?: 'item' | 'separator' | 'header';
  readonly submenu?: readonly MenuEntry[];
}

export interface MenuFlyoutProps {
  x: number;
  y: number;
  entries: readonly MenuEntry[];
  onSelect: (id: string) => void;
  onDismiss: () => void;
  minWidth?: number;
  /** Positioning frame; `fixed` for shell menus, `absolute` inside a window. */
  position?: 'fixed' | 'absolute';
}

/** Windows 11 context menu: acrylic, 32px rows, edge-aware placement. */
export function MenuFlyout({ x, y, entries, onSelect, onDismiss, minWidth = 200, position = 'fixed' }: MenuFlyoutProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [openSub, setOpenSub] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.right > window.innerWidth - 8) dx = window.innerWidth - 8 - rect.right;
    if (rect.bottom > window.innerHeight - 8) dy = window.innerHeight - 8 - rect.bottom;
    if (dx !== 0 || dy !== 0) setOffset({ dx, dy });
  }, [x, y, entries]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onDismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };
    // Deferred so the opening click doesn't immediately dismiss the menu.
    const id = window.setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    window.addEventListener('keydown', key, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={root}
      className="fx-menu"
      role="menu"
      style={{ position, left: x + offset.dx, top: y + offset.dy, minWidth, zIndex: 1160 }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') return <div key={`sep-${index}`} className="fx-menu-sep" />;
        if (entry.kind === 'header') {
          return (
            <div key={entry.id} className="fx-menu-header">
              {entry.label}
            </div>
          );
        }
        const Glyph = entry.icon;
        const hasSub = entry.submenu !== undefined && entry.submenu.length > 0;
        return (
          <div
            key={entry.id}
            style={{ position: 'relative' }}
            onPointerEnter={() => setOpenSub(hasSub ? entry.id : null)}
          >
            <button
              type="button"
              role="menuitem"
              className="fx-menu-item"
              data-danger={entry.danger === true ? 'true' : undefined}
              disabled={entry.disabled}
              onClick={() => {
                if (hasSub) {
                  setOpenSub(entry.id);
                  return;
                }
                onSelect(entry.id);
                onDismiss();
              }}
            >
              <span style={{ width: 16, flex: 'none', display: 'grid', placeItems: 'center' }}>
                {entry.checked === true ? <Check size={14} /> : Glyph ? <Glyph size={15} /> : null}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.label}
              </span>
              {entry.accelerator !== undefined ? <span className="fx-menu-accel">{entry.accelerator}</span> : null}
              {hasSub ? <ChevronRight size={13} style={{ color: 'var(--fx-text-tertiary)' }} /> : null}
            </button>
            {hasSub && openSub === entry.id ? (
              <div
                className="fx-menu"
                role="menu"
                style={{ position: 'absolute', insetInlineStart: '100%', top: -4, minWidth: 180, zIndex: 1 }}
              >
                {(entry.submenu ?? []).map((child, childIndex) =>
                  child.kind === 'separator' ? (
                    <div key={`sub-sep-${childIndex}`} className="fx-menu-sep" />
                  ) : (
                    <button
                      key={child.id}
                      type="button"
                      role="menuitem"
                      className="fx-menu-item"
                      data-danger={child.danger === true ? 'true' : undefined}
                      disabled={child.disabled}
                      onClick={() => {
                        onSelect(child.id);
                        onDismiss();
                      }}
                    >
                      <span style={{ width: 16, flex: 'none', display: 'grid', placeItems: 'center' }}>
                        {child.checked === true ? <Check size={14} /> : child.icon ? <child.icon size={15} /> : null}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>{child.label}</span>
                      {child.accelerator !== undefined ? (
                        <span className="fx-menu-accel">{child.accelerator}</span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export interface MenuBarMenu {
  readonly id: string;
  readonly label: ReactNode;
  readonly entries: readonly MenuEntry[];
}

/** Classic application menu strip (Notepad, Sheets). */
export function MenuBar({
  menus,
  onSelect,
}: {
  menus: readonly MenuBarMenu[];
  onSelect: (menuId: string, entryId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const anchors = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const openMenu = (menuId: string) => {
    const element = anchors.current.get(menuId);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPoint({ x: rect.left, y: rect.bottom + 2 });
    setOpen(menuId);
  };

  const active = menus.find((menu) => menu.id === open);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingInline: 4 }}>
      {menus.map((menu) => (
        <button
          key={menu.id}
          type="button"
          ref={(element) => {
            if (element) anchors.current.set(menu.id, element);
            else anchors.current.delete(menu.id);
          }}
          onClick={() => (open === menu.id ? setOpen(null) : openMenu(menu.id))}
          onPointerEnter={() => {
            if (open !== null && open !== menu.id) openMenu(menu.id);
          }}
          style={{
            height: 26,
            paddingInline: 9,
            borderRadius: 4,
            fontSize: 'var(--fx-caption)',
            color: 'var(--fx-text-primary)',
            background: open === menu.id ? 'var(--fx-subtle-hover)' : undefined,
          }}
        >
          {menu.label}
        </button>
      ))}
      {active !== undefined && point !== null ? (
        <MenuFlyout
          x={point.x}
          y={point.y}
          entries={active.entries}
          onSelect={(entryId) => onSelect(active.id, entryId)}
          onDismiss={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
