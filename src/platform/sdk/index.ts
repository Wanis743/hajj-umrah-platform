/**
 * `@/platform/sdk` — the application-facing surface of Finance OS.
 *
 * Applications import from this barrel only. It re-exports the ABI *types*
 * (never kernel implementations), the hook layer, the formatting helpers and
 * the Fluent UI kit.
 */

/* ---- runtime & hooks --------------------------------------------- */
export type {
  AppEntryProps,
  AppLang,
  AppLocale,
  AppPackage,
  AppRuntime,
  DatasetOptions,
  DatasetState,
} from './types';
export { CHANNEL_ACTIVATED, CHANNEL_APP_COMMAND, CHANNEL_APPS_CHANGED, CHANNEL_DATA_INVALIDATED, CHANNEL_THEME_CHANGED } from './types';
export {
  useApp,
  useAppCommands,
  useAsyncAction,
  useCapability,
  useDataset,
  useDirectory,
  useDirtyState,
  useIpc,
  useKernelInterval,
  useLedgerCommand,
  useLocale,
  useMappedDataset,
  usePolledSyscall,
  usePrincipal,
  useSetting,
  useSyscall,
  useTextFile,
  useWindowBadge,
  useWindowTitle,
} from './hooks';

/* ---- formatting -------------------------------------------------- */
export * as fmt from './format';

/* ---- ABI types the apps legitimately need ------------------------ */
export type {
  AbiError,
  AbiErrorCode,
  AbiResult,
  AppCategoryId,
  AppCommandDef,
  AppId,
  AppInventoryRecord,
  AppManifest,
  Capability,
  CommandInvocation,
  CommandOutcome,
  DatasetName,
  DatasetPage,
  DatasetQuery,
  DatasetRow,
  EventChannel,
  EventLevel,
  EventQuery,
  EventRecord,
  Handle,
  IpcMessage,
  LaunchArgs,
  LedgerCommandName,
  Localized,
  MessageBoxSpec,
  NotificationRecord,
  NotificationSpec,
  Pid,
  PowerAction,
  PrincipalInfo,
  ProcessInfo,
  ProcessMetrics,
  ProcessPriority,
  ProcessState,
  RegistryEntry,
  RegistryValue,
  ServiceInfo,
  ServiceStartType,
  ServiceState,
  SnapZone,
  SyscallName,
  SyscallRequest,
  SyscallResponse,
  SystemMetrics,
  SystemMetricSample,
  ToastKind,
  ToastSpec,
  VfsContentType,
  VfsStat,
  VfsVolumeInfo,
  WindowId,
  WindowInfo,
} from '../kernel/abi';

export {
  APP_IDS,
  CAPABILITIES,
  DATASETS,
  IPC_CHANNELS,
  LEDGER_COMMANDS,
  // Which capabilities cost a consent prompt is a fact about the *kernel's*
  // elevation gate, not about any app — but a permission list that cannot tell
  // "granted at install" from "asks every time" is a permission list that lies.
  PRIVILEGED_CAPABILITIES,
  REG,
  appId,
} from '../kernel/abi';

/* ---- capability names -------------------------------------------- */
export { CAPABILITY_LABELS, capabilityLabel } from './capabilities';

/* ---- Fluent UI kit ---------------------------------------------- */
export * from './ui';
