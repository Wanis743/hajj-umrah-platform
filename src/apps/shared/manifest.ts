/**
 * Manifest helpers.
 *
 * A manifest is *data*: the kernel installs every one of them at boot to build
 * Start, search, the taskbar and file associations, long before any app entry
 * component is downloaded. So nothing in this file may import React, and nothing
 * in it may run — it only shapes literals.
 *
 * `defineApp` exists to make the interesting fields of a manifest the ones you
 * actually read. Size, resizability and instancing have the same answer for most
 * apps; spelling them out 18 times would bury the fields that differ.
 *
 * `accent` and `density` pass straight through and are deliberately *not*
 * defaulted here. Both are optional in the ABI and both are resolved where they
 * are read — `useKitAppearance` in the SDK — so there is exactly one place that
 * decides what "unset" means, and an app that says nothing about its appearance
 * carries no field claiming it did.
 */
import type { AppManifest, Localized } from '@/platform/kernel/abi';

/** Tri-lingual label, in the order the ABI declares. */
export const text = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

/** Every app in the OS image ships from the same publisher at the same version. */
const PUBLISHER = 'Finance OS';
const VERSION = '1.0.0';

type Draft = Omit<AppManifest, 'version' | 'publisher' | 'resizable' | 'singleInstance' | 'pinned' | 'desktopShortcut' | 'systemComponent'> &
  Partial<Pick<AppManifest, 'version' | 'publisher' | 'resizable' | 'singleInstance' | 'pinned' | 'desktopShortcut' | 'systemComponent'>>;

/**
 * Fills in the defaults shared by the OS image: shipped with the system,
 * resizable, one instance, not pinned and no desktop shortcut. An app overrides
 * only what is genuinely different about it.
 */
export function defineApp(draft: Draft): AppManifest {
  return {
    version: VERSION,
    publisher: PUBLISHER,
    resizable: true,
    singleInstance: true,
    pinned: false,
    desktopShortcut: false,
    systemComponent: true,
    ...draft,
  };
}
