/**
 * Shell host — the kernel's window onto the user.
 *
 * The kernel calls `ShellHost` when a syscall needs a human: a toast, a
 * notification banner, a confirmation dialog, a file picker, the clipboard, a
 * power action. None of that can live inside the kernel (it has no React and no
 * DOM), so the shell implements the interface and hands it over through
 * `kernel.attachShell`.
 *
 * Everything here is an ordinary observable object, not a React hook, because
 * the kernel calls it from syscall context. React reads the state through
 * `useKernelView` and answers dialogs through the returned controller.
 */
import type {
  FileDialogSpec,
  MessageBoxSpec,
  NotificationRecord,
  PowerAction,
  ToastSpec,
} from '../kernel/abi';
import type { ShellHost } from '../kernel/contracts';

/** Default auto-dismiss, matching the Windows toast dwell time. */
const DEFAULT_TOAST_MS = 5_000;
/** Never keep more than this many toasts stacked; oldest is dropped. */
const MAX_TOASTS = 4;

export interface ToastItem {
  readonly id: string;
  readonly spec: ToastSpec;
  /** Wall-clock ms the toast appeared, used for ordering. */
  readonly at: number;
}

export interface PendingDialog {
  readonly id: string;
  readonly spec: MessageBoxSpec;
}

export interface PendingFileDialog {
  readonly id: string;
  readonly spec: FileDialogSpec;
}

export interface ShellHostSnapshot {
  readonly toasts: readonly ToastItem[];
  /** Only the head of the queue is rendered — dialogs are modal. */
  readonly dialog: PendingDialog | null;
  readonly fileDialog: PendingFileDialog | null;
}

export interface ShellHostController {
  /** Hand this to `kernel.attachShell`. */
  readonly host: ShellHost;
  subscribe(listener: () => void): () => void;
  snapshot(): ShellHostSnapshot;
  dismissToast(id: string): void;
  /** Answers the modal message box currently on screen. */
  answerDialog(id: string, confirmed: boolean): void;
  /** Answers the file dialog; `null` means the user cancelled. */
  answerFileDialog(id: string, path: string | null): void;
  /** Raises a toast from the shell itself (not on behalf of an app). */
  push(spec: ToastSpec): string;
}

export interface ShellHostOptions {
  /** Called when an app or the Start menu requests a power action. */
  readonly onPower: (action: PowerAction) => void;
  /**
   * Called for every notification the kernel accepts, so the shell can show the
   * banner. The record is already stored in the notification centre.
   */
  readonly onNotify?: (record: NotificationRecord) => void;
  /**
   * Do Not Disturb. Asked at the moment a notification arrives — the record
   * still lands in the notification centre, only the banner is withheld, which
   * is what Windows' focus assist does.
   */
  readonly quiet?: () => boolean;
}

class Controller implements ShellHostController {
  private toasts: readonly ToastItem[] = [];
  private dialogs: readonly PendingDialog[] = [];
  private fileDialogs: readonly PendingFileDialog[] = [];
  private snap: ShellHostSnapshot = { toasts: [], dialog: null, fileDialog: null };
  private readonly listeners = new Set<() => void>();
  private readonly answers = new Map<string, (value: boolean) => void>();
  private readonly paths = new Map<string, (value: string | null) => void>();
  private readonly timers = new Map<string, number>();

  readonly host: ShellHost;

  constructor(private readonly options: ShellHostOptions) {
    this.host = {
      toast: (spec) => this.push(spec),
      notify: (record) => this.notify(record),
      messageBox: (spec) => this.messageBox(spec),
      fileDialog: (spec) => this.fileDialog(spec),
      clipboardWrite: (text) => writeClipboard(text),
      clipboardRead: () => readClipboard(),
      power: (action) => this.options.onPower(action),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): ShellHostSnapshot {
    return this.snap;
  }

  push(spec: ToastSpec): string {
    const id = crypto.randomUUID();
    const item: ToastItem = { id, spec, at: Date.now() };
    this.toasts = [...this.toasts, item].slice(-MAX_TOASTS);

    // `timeoutMs: 0` pins the toast; anything else auto-dismisses.
    const timeout = spec.timeoutMs ?? DEFAULT_TOAST_MS;
    if (timeout > 0) {
      this.timers.set(id, window.setTimeout(() => this.dismissToast(id), timeout));
    }
    this.publish();
    return id;
  }

  dismissToast(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(id);
    }
    const next = this.toasts.filter((toast) => toast.id !== id);
    if (next.length === this.toasts.length) return;
    this.toasts = next;
    this.publish();
  }

  answerDialog(id: string, confirmed: boolean): void {
    const resolve = this.answers.get(id);
    if (resolve === undefined) return;
    this.answers.delete(id);
    this.dialogs = this.dialogs.filter((dialog) => dialog.id !== id);
    this.publish();
    resolve(confirmed);
  }

  answerFileDialog(id: string, path: string | null): void {
    const resolve = this.paths.get(id);
    if (resolve === undefined) return;
    this.paths.delete(id);
    this.fileDialogs = this.fileDialogs.filter((dialog) => dialog.id !== id);
    this.publish();
    resolve(path);
  }

  private notify(record: NotificationRecord): void {
    this.options.onNotify?.(record);
    // Windows shows every notification as a banner first; the centre keeps it.
    // Under Do Not Disturb only the banner is skipped — nothing is lost.
    if (this.options.quiet?.() === true) return;
    this.push({ kind: record.kind, title: record.title, body: record.body });
  }

  private messageBox(spec: MessageBoxSpec): Promise<boolean> {
    const id = crypto.randomUUID();
    return new Promise<boolean>((resolve) => {
      this.answers.set(id, resolve);
      this.dialogs = [...this.dialogs, { id, spec }];
      this.publish();
    });
  }

  private fileDialog(spec: FileDialogSpec): Promise<string | null> {
    const id = crypto.randomUUID();
    return new Promise<string | null>((resolve) => {
      this.paths.set(id, resolve);
      this.fileDialogs = [...this.fileDialogs, { id, spec }];
      this.publish();
    });
  }

  private publish(): void {
    this.snap = {
      toasts: this.toasts,
      dialog: this.dialogs[0] ?? null,
      fileDialog: this.fileDialogs[0] ?? null,
    };
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Clipboard access degrades honestly: the async API when the document is
 * trusted and focused, the legacy `execCommand` path otherwise, and `false`
 * when neither works — the syscall then reports `IO_ERROR` to the caller.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const staging = document.createElement('textarea');
    staging.value = text;
    staging.setAttribute('readonly', 'true');
    staging.style.position = 'fixed';
    staging.style.opacity = '0';
    document.body.appendChild(staging);
    staging.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(staging);
    return copied;
  } catch {
    return false;
  }
}

async function readClipboard(): Promise<string> {
  try {
    if (navigator.clipboard !== undefined) return await navigator.clipboard.readText();
  } catch {
    // Permission refused or the document is not focused.
  }
  return '';
}

export function createShellHost(options: ShellHostOptions): ShellHostController {
  return new Controller(options);
}
