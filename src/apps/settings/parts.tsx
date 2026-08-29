/**
 * Settings — shared page furniture.
 *
 * A settings row is the same shape on every page in Windows: label and hint on
 * one side, one control on the other. Keeping it here means a page reads as a
 * list of decisions rather than a list of flexbox declarations.
 */
import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';

export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid var(--fx-divider)',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 'var(--fx-body)' }}>{title}</div>
        {hint !== undefined ? <div style={{ fontSize: 11, color: 'var(--fx-text-tertiary)' }}>{hint}</div> : null}
      </div>
      <div style={{ flex: 'none' }}>{children}</div>
    </div>
  );
}

/** The identity banner at the top of a Windows 11 settings section. */
export function Hero({
  icon: Glyph,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        borderRadius: 'var(--fx-radius-card)',
        background: 'var(--fx-card)',
        border: '1px solid var(--fx-stroke-card)',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--fx-radius-pill)',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--fx-accent)',
          color: 'var(--fx-on-accent)',
          flex: 'none',
        }}
      >
        <Glyph size={24} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 'var(--fx-subtitle)', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 'var(--fx-caption)', color: 'var(--fx-text-secondary)' }}>{subtitle}</div>
      </div>
      {actions === undefined ? null : <div style={{ display: 'flex', gap: 8, flex: 'none' }}>{actions}</div>}
    </div>
  );
}
