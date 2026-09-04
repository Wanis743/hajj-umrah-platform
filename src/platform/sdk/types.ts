/**
 * Application SDK — types.
 *
 * This is the whole world an application may see. Apps under `src/apps/**`
 * import from `@/platform/sdk` and nothing else platform-side; the boundary
 * gate (`scripts/verify-os-boundary.mjs`) fails the build otherwise.
 *
 * The runtime object is *constructed by the kernel host* and injected through
 * React context, so an app cannot reach the kernel, the shell, Supabase or
 * browser storage on its own.
 */
import type { ComponentType } from 'react';
import type {
  AbiResult,
  AppId,
  AppManifest,
  DatasetName,
  DatasetPage,
  DatasetQuery,
  IpcMessage,
  LaunchArgs,
  Localized,
  MessageBoxSpec,
  NotificationSpec,
  Pid,
  SyscallName,
  SyscallRequest,
  SyscallResponse,
  ToastSpec,
  WindowId,
} from '../kernel/abi';
import { IPC_CHANNELS } from '../kernel/abi';

/** Language codes the shell can be running in. */
export type AppLang = 'ar' | 'fr' | 'en';

export interface AppLocale {
  readonly lang: AppLang;
  readonly rtl: boolean;
  /** Resolve a tri-lingual label. */
  readonly t: (text: Localized) => string;
  /** Inline form for one-off strings. */
  readonly tr: (ar: string, fr: string, en: string) => string;
  /** Intl locale tag, e.g. `ar-DZ`. */
  readonly intlLocale: string;
}

/**
 * The per-process runtime handed to an application component.
 *
 * Every method is either a syscall or a thin, capability-checked convenience
 * over one. Nothing here exposes kernel objects.
 */
export interface AppRuntime {
  readonly pid: Pid;
  readonly appId: AppId;
  readonly manifest: AppManifest;
  /** Window hosting this instance, or `null` for headless launches. */
  readonly window: WindowId | null;
  readonly args: LaunchArgs;
  readonly locale: AppLocale;

  /** The single, typed entry point to the kernel. */
  invoke<K extends SyscallName>(name: K, request: SyscallRequest<K>): Promise<AbiResult<SyscallResponse<K>>>;

  /** Subscribe to an IPC channel; returns an unsubscribe function. */
  subscribe(channel: string, handler: (message: IpcMessage) => void): () => void;

  /** Publish on an IPC channel. Returns the number of receivers. */
  publish(channel: string, payload: unknown): Promise<number>;

  /** Convenience wrappers (each is one syscall). */
  toast(spec: ToastSpec): Promise<void>;
  notify(spec: NotificationSpec): Promise<void>;
  confirm(spec: MessageBoxSpec): Promise<boolean>;

  /** Window chrome. */
  setTitle(title: string): Promise<void>;
  setDirty(dirty: boolean): Promise<void>;
  setBadge(badge: number | null): Promise<void>;
  setProgress(progress: number | null): Promise<void>;
  close(): Promise<void>;

  /** Launch another installed app (requires `shell.launch`). */
  launch(appId: AppId, args?: LaunchArgs): Promise<void>;
  /** Open a VFS path with its associated app. */
  openPath(path: string): Promise<void>;
}

/** Props every app entry component receives. */
export interface AppEntryProps {
  readonly runtime: AppRuntime;
}

/**
 * How an application ships.
 *
 * A manifest is data — it must not import React, because the shell installs
 * every manifest at boot to build Start, search and file associations. The entry
 * component is imported lazily and only when the app is first launched, so a
 * cold desktop downloads chrome and nothing else.
 */
export interface AppPackage {
  readonly manifest: AppManifest;
  readonly load: () => Promise<{ readonly default: ComponentType<AppEntryProps> }>;
}

/** Result shape of `useDataset`. */
export interface DatasetState {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly fetchedAt: string | null;
  readonly fromCache: boolean;
  readonly refetch: () => void;
}

export interface DatasetOptions extends Omit<DatasetQuery, 'dataset'> {
  /** Skip fetching until true. */
  readonly enabled?: boolean;
  /** Re-fetch whenever one of these datasets is invalidated. */
  readonly watch?: readonly DatasetName[];
}

export type { DatasetPage, DatasetQuery };

/**
 * Channels an app is expected to listen on, named for readability. These are
 * aliases of the ABI's `IPC_CHANNELS`, not copies — the kernel and the SDK can
 * never drift apart on a channel name.
 */
export const CHANNEL_DATA_INVALIDATED = IPC_CHANNELS.dataChanged;
/** Channel the shell uses to route palette / jump-list commands to an app. */
export const CHANNEL_APP_COMMAND = IPC_CHANNELS.appCommand;
/** Channel the shell publishes theme changes on. */
export const CHANNEL_THEME_CHANGED = IPC_CHANNELS.appearance;
/** Delivered when a running single-instance app is launched again. */
export const CHANNEL_ACTIVATED = IPC_CHANNELS.activate;
/** Delivered when the installed-app inventory changes (install, removal, pin). */
export const CHANNEL_APPS_CHANGED = IPC_CHANNELS.appsChanged;
