/**
 * Application registry — the installed-software inventory.
 *
 * An app exists to the OS because its manifest is registered here. That gives
 * the shell one place to read from (Start, taskbar pins, jump lists) and Settings
 * one inventory to list, and it gives the user one place to inspect: every record
 * is mirrored into `HKLM\SOFTWARE\FinanceOS\Apps`, so Regedit shows the same
 * inventory Settings does.
 *
 * The split between machine and user state matches Windows:
 *   - HKLM holds what was installed (version, publisher, capabilities);
 *   - HKCU holds how *this* user uses it (pin order, launch counts, defaults).
 *
 * Re-registering a manifest is an upgrade, not a reinstall: the user's pins and
 * launch history survive.
 */
import {
  REG,
  fail,
  succeed,
  type AbiResult,
  type AppId,
  type AppManifest,
  type VfsContentType,
} from '../abi';
import type { IsoTimestamp } from '../types';
import type { AppRegistrySubsystem, InstalledApp, KernelClock, RegistrySubsystem } from '../contracts';
import { EVENT_IDS } from './eventlog';
import type { KernelLogger } from '../contracts';
import { createSignal } from './store';

/** HKCU sub-keys this subsystem owns. */
const PINS_VALUE = 'Pinned';
const LAUNCH_KEY = `${REG.userStart}\\Launches`;
const LAST_LAUNCH_KEY = `${REG.userStart}\\LastLaunched`;
const ASSOCIATION_KEY = `${REG.userAppSettings}\\Associations`;
const DISABLED_VALUE = 'DisabledApps';
/**
 * Apps this user removed. The host installs the OS image on every boot, so
 * without a record of the removal an uninstall would silently come back on the
 * next reload; Windows keeps the same list, which is why a removed inbox app
 * stays removed until it is installed again.
 */
const REMOVED_VALUE = 'Removed';

interface Entry {
  manifest: AppManifest;
  readonly installedAt: IsoTimestamp;
  launches: number;
  lastLaunchedAt: IsoTimestamp | null;
}

class AppRegistry implements AppRegistrySubsystem {
  private readonly entries = new Map<string, Entry>();
  /**
   * The installation media, in effect: every manifest the host has ever handed
   * this kernel, kept whether or not the app is currently installed. Uninstall
   * forgets the installation, not where it came from, which is what lets
   * `restore` put a removed app back without reloading the page.
   */
  private readonly image = new Map<string, AppManifest>();
  private readonly signal = createSignal();

  constructor(
    private readonly clock: KernelClock,
    private readonly registry: RegistrySubsystem,
    private readonly log: KernelLogger,
  ) {}

  install(manifest: AppManifest): InstalledApp {
    const key = manifest.id as string;
    const existing = this.entries.get(key);
    this.image.set(key, manifest);

    // Launch history is per-user and outlives an upgrade, so it is read back
    // from the registry rather than reset.
    const launches = this.registry.getNumber(LAUNCH_KEY, key, existing?.launches ?? 0);
    const lastLaunched = this.registry.getString(LAST_LAUNCH_KEY, key, '');

    const entry: Entry = {
      manifest,
      installedAt: existing?.installedAt ?? this.clock.iso(),
      launches,
      lastLaunchedAt: lastLaunched === '' ? (existing?.lastLaunchedAt ?? null) : (lastLaunched as IsoTimestamp),
    };
    this.entries.set(key, entry);

    // An explicit install undoes an earlier removal: the app was asked for.
    const removed = this.removedIds();
    if (removed.includes(key)) this.writeRemoved(removed.filter((candidate) => candidate !== key));

    const hive = `${REG.machineApps}\\${key}`;
    this.registry.set(hive, 'DisplayName', manifest.name.en);
    this.registry.set(hive, 'Version', manifest.version);
    this.registry.set(hive, 'Publisher', manifest.publisher);
    this.registry.set(hive, 'Category', manifest.category);
    this.registry.set(hive, 'InstalledAt', entry.installedAt);
    this.registry.set(hive, 'SystemComponent', manifest.systemComponent);
    this.registry.set(hive, 'Capabilities', [...manifest.capabilities]);

    // A first install seeds the taskbar the way the manifest asked for; after
    // that the user's pin list is authoritative and is never rewritten.
    if (existing === undefined && manifest.pinned && !this.pins().includes(key)) {
      this.writePins([...this.pins(), key]);
    }

    if (existing === undefined) {
      this.log.write('Setup', 'information', EVENT_IDS.appInstalled, 'AppRegistry', `Installed ${manifest.name.en}`, {
        appId: key,
        version: manifest.version,
      });
    }
    this.signal.bump();
    return this.snapshot(entry);
  }

  uninstall(id: AppId): AbiResult<true> {
    const key = id as string;
    const entry = this.entries.get(key);
    if (entry === undefined) return fail('NOT_FOUND', `No such application: ${key}`);
    if (entry.manifest.systemComponent) {
      return fail('PERMISSION_DENIED', `${entry.manifest.name.en} ships with the system and cannot be removed`);
    }

    this.entries.delete(key);
    this.registry.delete(`${REG.machineApps}\\${key}`);
    this.registry.delete(LAUNCH_KEY, key);
    this.registry.delete(LAST_LAUNCH_KEY, key);
    this.writePins(this.pins().filter((pinned) => pinned !== key));
    this.writeRemoved([...this.removedIds(), key]);

    this.log.write('Setup', 'information', EVENT_IDS.appUninstalled, 'AppRegistry', `Removed ${entry.manifest.name.en}`, {
      appId: key,
    });
    this.signal.bump();
    return succeed(true);
  }

  list(): readonly InstalledApp[] {
    return [...this.entries.values()]
      .map((entry) => this.snapshot(entry))
      .sort((a, b) => a.manifest.name.en.localeCompare(b.manifest.name.en));
  }

  get(id: AppId): InstalledApp | null {
    const entry = this.entries.get(id as string);
    return entry === undefined ? null : this.snapshot(entry);
  }

  catalogue(): readonly AppManifest[] {
    return [...this.image.values()].sort((a, b) => a.name.en.localeCompare(b.name.en));
  }

  restore(id: AppId): AbiResult<InstalledApp> {
    const key = id as string;
    const existing = this.entries.get(key);
    if (existing !== undefined) return succeed(this.snapshot(existing));
    const manifest = this.image.get(key);
    if (manifest === undefined) return fail('NOT_FOUND', `No installation package for ${key}`);
    return succeed(this.install(manifest));
  }

  removed(): readonly AppId[] {
    return this.removedIds() as readonly AppId[];
  }

  setPinned(id: AppId, pinned: boolean): void {
    const key = id as string;
    if (!this.entries.has(key)) return;
    const current = this.pins();
    if (pinned === current.includes(key)) return;
    this.writePins(pinned ? [...current, key] : current.filter((candidate) => candidate !== key));
    this.signal.bump();
  }

  noteLaunch(id: AppId): void {
    const key = id as string;
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    entry.launches += 1;
    entry.lastLaunchedAt = this.clock.iso();
    this.registry.set(LAUNCH_KEY, key, entry.launches);
    this.registry.set(LAST_LAUNCH_KEY, key, entry.lastLaunchedAt);
    this.signal.bump();
  }

  handlerFor(contentType: VfsContentType, extension: string): AppId | null {
    const ext = normalizeExtension(extension);

    // A user default beats the manifest, exactly like "Open with → Always".
    const override = ext === '' ? '' : this.registry.getString(ASSOCIATION_KEY, ext, '');
    if (override !== '' && this.entries.has(override)) return override as AppId;

    const candidates = [...this.entries.values()].filter((entry) => this.enabled(entry));

    for (const entry of candidates) {
      for (const association of entry.manifest.fileAssociations ?? []) {
        if (association.contentType === contentType) return entry.manifest.id;
      }
    }
    if (ext === '') return null;
    for (const entry of candidates) {
      for (const association of entry.manifest.fileAssociations ?? []) {
        if (association.extensions.some((candidate) => normalizeExtension(candidate) === ext)) {
          return entry.manifest.id;
        }
      }
    }
    return null;
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  /* ---------------- internals ---------------- */

  private snapshot(entry: Entry): InstalledApp {
    return {
      manifest: entry.manifest,
      installedAt: entry.installedAt,
      pinned: this.pins().includes(entry.manifest.id as string),
      enabled: this.enabled(entry),
      launches: entry.launches,
      lastLaunchedAt: entry.lastLaunchedAt,
    };
  }

  /** Policy can disable an app without uninstalling it. */
  private enabled(entry: Entry): boolean {
    const disabled = this.registry.get(REG.machinePolicy, DISABLED_VALUE);
    if (!Array.isArray(disabled)) return true;
    return !disabled.includes(entry.manifest.id as string);
  }

  private pins(): readonly string[] {
    const value = this.registry.get(REG.userTaskbar, PINS_VALUE);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private writePins(next: readonly string[]): void {
    this.registry.set(REG.userTaskbar, PINS_VALUE, [...new Set(next)]);
  }

  private removedIds(): readonly string[] {
    const value = this.registry.get(REG.userAppSettings, REMOVED_VALUE);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private writeRemoved(next: readonly string[]): void {
    this.registry.set(REG.userAppSettings, REMOVED_VALUE, [...new Set(next)]);
  }
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

export function createAppRegistry(
  clock: KernelClock,
  registry: RegistrySubsystem,
  log: KernelLogger,
): AppRegistrySubsystem {
  return new AppRegistry(clock, registry, log);
}
