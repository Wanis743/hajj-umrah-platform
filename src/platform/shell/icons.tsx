/**
 * The app tile.
 *
 * Windows gives every app a rounded gradient plate behind its glyph; this is
 * that plate. The name → glyph lookup lives in `iconRegistry.ts` because a
 * manifest is data and cannot import React.
 */
import type { AppCategoryId } from '../kernel/abi';
import { iconFor } from './iconRegistry';

/**
 * `tone` comes from the manifest category, so accounting apps read teal,
 * analysis violet and system apps graphite — a coherent Start menu without
 * per-app artwork.
 */
export function AppIcon({
  icon,
  category,
  size = 32,
  className,
}: {
  icon: string;
  category: AppCategoryId;
  size?: number;
  className?: string;
}) {
  const Glyph = iconFor(icon);
  return (
    <span
      className={`fx-app-icon${className === undefined ? '' : ` ${className}`}`}
      data-tone={category}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
    >
      <Glyph size={Math.round(size * 0.56)} strokeWidth={1.9} aria-hidden />
    </span>
  );
}
