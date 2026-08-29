/**
 * Shell public surface.
 *
 * The host application mounts {@link FinanceOS} and supplies the app catalog;
 * everything else here exists for the shell's own modules and for tests. Apps
 * import none of it — they see `@/platform/sdk` and nothing more.
 */
export { FinanceOS, default } from './FinanceOS';
export type { FinanceOSProps } from './FinanceOS';

export { createShellHost } from './host';
export type {
  PendingDialog,
  PendingFileDialog,
  ShellHostController,
  ShellHostOptions,
  ShellHostSnapshot,
  ToastItem,
} from './host';

export {
  bootMachine,
  ensureMachine,
  haltMachine,
  releaseMachine,
  resetMachineBoot,
  retainMachine,
  useMachine,
} from './machine';

export { useShellUi } from './shellState';
export type { FlyoutName, ScreenName, ShellActions, ShellUi, SnapAnchor } from './shellState';

export {
  ACCENTS,
  ICON_PIXELS,
  WALLPAPERS,
  accentVariables,
  readAppearance,
  wallpaperById,
} from './appearance';
export type {
  AccentSwatch,
  Appearance,
  IconSize,
  ShellLang,
  TaskbarAlignment,
  ThemeName,
  Wallpaper,
} from './appearance';

export {
  KernelProvider,
  ShellHostProvider,
  makeLocale,
  useAppearance,
  useDismissOnOutside,
  useGlobalKeys,
  useKernel,
  useKernelAction,
  useKernelView,
  useKernelView2,
  useShellHostController,
  useShellHostState,
  useShellLocale,
  useToast,
  useWallClock,
} from './bindings';
export type { KernelObservable } from './bindings';

export { iconFor, iconForContentType } from './iconRegistry';
export { AppIcon } from './icons';
export { AppSurface, CrashPane } from './appHost';
export type { AppInstanceSpec } from './appHost';
