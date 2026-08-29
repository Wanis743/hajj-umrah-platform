/**
 * The app tile.
 *
 * Two shapes, one component. An app with no artwork gets the Windows treatment
 * of a rounded gradient plate behind a glyph — that plate is what makes a Start
 * menu of 19 apps read as one system without anyone drawing anything. An app
 * that ships a logo gets the logo alone, full bleed, because a real mark *is*
 * the identity and a tile behind it only dilutes it.
 *
 * Both lookups are name → asset and live in the SDK (`ui/glyphs`, `ui/logos`)
 * because a manifest is data and cannot import React, and because an app that
 * lists other apps resolves the very same names and cannot import the shell.
 */
import type { AppCategoryId } from '../kernel/abi';
import { logoFor } from '../sdk/ui/logos';
import { iconFor } from './iconRegistry';

/**
 * `tone` comes from the manifest category, so accounting apps read teal,
 * analysis violet and system apps graphite — a coherent Start menu without
 * per-app artwork. It is ignored once an app ships a logo.
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
  const classes = `fx-app-icon${className === undefined ? '' : ` ${className}`}`;
  const logo = logoFor(icon);

  // Decorative: every call site pairs the icon with the app's name, so an alt
  // text here would only make screen readers say it twice.
  if (logo !== null) {
    return (
      <img
        className={classes}
        data-logo="true"
        src={logo}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ width: size, height: size }}
      />
    );
  }

  const Glyph = iconFor(icon);
  return (
    <span
      className={classes}
      data-tone={category}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }}
    >
      <Glyph size={Math.round(size * 0.56)} strokeWidth={1.9} aria-hidden />
    </span>
  );
}
