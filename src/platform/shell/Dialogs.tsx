/**
 * Modal surfaces: consent (UAC), message boxes, the file picker and the toast
 * stack.
 *
 * All four are driven from outside. The kernel raises a message box or a file
 * dialog through `ShellHost` and awaits a promise; the security subsystem queues
 * an elevation request and awaits the same way. These components render the head
 * of each queue and call the resolver — they never decide anything themselves,
 * which is what makes a syscall's `ELEVATION_REQUIRED` path honest: the answer
 * really did come from the user.
 *
 * The file picker is a genuine browser over the VFS: volumes, folders,
 * breadcrumbs, content-type filtering, keyboard traversal. An app calling
 * `dialog.open` gets a real path back or `null`.
 */
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  CircleHelp,
  Info,
  ShieldAlert,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { DialogKind, ToastKind, VfsStat } from '../kernel/abi';
import { dirname, join } from '../kernel/core/paths';
import { KERNEL_USER_FOLDER } from '../kernel/kernel';
import type { AppLocale } from '../sdk';
import { capabilityLabel, fmt } from '../sdk';
import { useKernel, useKernelView } from './bindings';
import { iconForContentType } from './iconRegistry';
import type { PendingDialog, PendingFileDialog, ToastItem } from './host';

const KIND_GLYPH: Readonly<Record<DialogKind, LucideIcon>> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  question: CircleHelp,
};

const TOAST_GLYPH: Readonly<Record<ToastKind, LucideIcon>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

export interface ToastHostProps {
  readonly toasts: readonly ToastItem[];
  readonly locale: AppLocale;
  readonly onDismiss: (id: string) => void;
}

export function ToastHost({ toasts, locale, onDismiss }: ToastHostProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fx-toast-host" role="log" aria-live="polite">
      {toasts.map((toast) => {
        const Glyph = TOAST_GLYPH[toast.spec.kind];
        return (
          <div key={toast.id} className="fx-toast" data-kind={toast.spec.kind}>
            <Glyph size={17} strokeWidth={1.8} className="fx-toast-glyph" />
            <div className="fx-toast-text">
              <span className="fx-toast-title">{toast.spec.title}</span>
              {toast.spec.body === undefined ? null : <span className="fx-caption-text">{toast.spec.body}</span>}
            </div>
            <button
              type="button"
              className="fx-toast-close"
              title={locale.tr('إغلاق', 'Fermer', 'Dismiss')}
              aria-label={locale.tr('إغلاق', 'Fermer', 'Dismiss')}
              onClick={() => onDismiss(toast.id)}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shared modal shell
 * ------------------------------------------------------------------ */

function Modal({
  label,
  onCancel,
  children,
  wide,
}: {
  label: string;
  onCancel: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="fx-dialog-smoke">
      <div
        ref={ref}
        className="fx-dialog"
        data-wide={wide === true ? 'true' : 'false'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Message box
 * ------------------------------------------------------------------ */

export interface MessageBoxProps {
  readonly pending: PendingDialog;
  readonly locale: AppLocale;
  readonly onAnswer: (id: string, confirmed: boolean) => void;
}

export function MessageBox({ pending, locale, onAnswer }: MessageBoxProps) {
  const { spec } = pending;
  const Glyph = KIND_GLYPH[spec.kind];
  const confirm = spec.confirmLabel === undefined ? locale.tr('موافق', 'OK', 'OK') : locale.t(spec.confirmLabel);
  const cancel = spec.cancelLabel === undefined ? null : locale.t(spec.cancelLabel);

  return (
    <Modal label={spec.title} onCancel={() => onAnswer(pending.id, false)}>
      <div className="fx-dialog-body">
        <Glyph size={26} strokeWidth={1.7} className="fx-dialog-glyph" data-kind={spec.kind} />
        <div className="fx-dialog-text">
          <h2 className="fx-subtitle-text">{spec.title}</h2>
          <p>{spec.body}</p>
        </div>
      </div>
      <div className="fx-dialog-footer">
        {cancel === null ? null : (
          <button type="button" className="fx-btn" onClick={() => onAnswer(pending.id, false)}>
            {cancel}
          </button>
        )}
        <button
          type="button"
          className="fx-btn"
          data-variant={spec.destructive === true ? 'danger' : 'accent'}
          autoFocus
          onClick={() => onAnswer(pending.id, true)}
        >
          {confirm}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Consent (UAC)
 * ------------------------------------------------------------------ */

export interface ConsentDialogProps {
  readonly locale: AppLocale;
}

/**
 * Reads the elevation queue itself: consent is a security-subsystem concern and
 * the root should not have to shuttle it. Answering resolves the promise the
 * blocked syscall is waiting on.
 */
export function ConsentDialog({ locale }: ConsentDialogProps) {
  const kernel = useKernel();
  const pending = useKernelView(kernel.security, () => kernel.security.pending());
  const request = pending[0];
  if (request === undefined) return null;

  const principal = kernel.security.principal();
  const answer = (granted: boolean) => kernel.security.resolveElevation(request.id, granted);

  return (
    <Modal label={locale.tr('التحكم في الحساب', 'Contrôle de compte', 'Account control')} onCancel={() => answer(false)}>
      <div className="fx-uac-head">
        <ShieldAlert size={20} strokeWidth={1.8} />
        {locale.tr(
          'هل تريد السماح لهذا التطبيق بإجراء تغييرات؟',
          'Autoriser cette application à apporter des modifications ?',
          'Do you want to allow this app to make changes?',
        )}
      </div>
      <div className="fx-uac-body">
        <dl className="fx-uac-facts">
          <dt className="fx-caption-text">{locale.tr('التطبيق', 'Application', 'App')}</dt>
          <dd>{locale.t(request.appName)}</dd>
          <dt className="fx-caption-text">{locale.tr('الصلاحية', 'Autorisation', 'Permission')}</dt>
          <dd>{locale.t(capabilityLabel(request.capability))}</dd>
          <dt className="fx-caption-text">{locale.tr('السبب', 'Motif', 'Reason')}</dt>
          <dd>{locale.t(request.reason)}</dd>
          <dt className="fx-caption-text">{locale.tr('المستخدم', 'Utilisateur', 'User')}</dt>
          <dd>
            {principal.displayName}
            <span className="fx-caption-text"> · pid {request.pid}</span>
          </dd>
        </dl>
        <p className="fx-caption-text">
          {locale.tr(
            'تبقى الموافقة سارية 15 دقيقة ثم تُطلب من جديد.',
            'Le consentement reste valable 15 minutes, puis sera redemandé.',
            'Consent lasts 15 minutes, then it is asked for again.',
          )}
        </p>
      </div>
      <div className="fx-dialog-footer">
        <button type="button" className="fx-btn" onClick={() => answer(false)}>
          {locale.tr('لا', 'Non', 'No')}
        </button>
        <button type="button" className="fx-btn" data-variant="accent" autoFocus onClick={() => answer(true)}>
          {locale.tr('نعم', 'Oui', 'Yes')}
        </button>
      </div>
      {pending.length > 1 ? (
        <p className="fx-uac-queue fx-caption-text">
          {locale.tr('طلبات أخرى في الانتظار:', 'Autres demandes en attente :', 'More requests waiting:')}{' '}
          {pending.length - 1}
        </p>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * File picker
 * ------------------------------------------------------------------ */

interface Place {
  readonly path: string;
  readonly label: string;
}

export interface FileDialogProps {
  readonly pending: PendingFileDialog;
  readonly locale: AppLocale;
  readonly onAnswer: (id: string, path: string | null) => void;
}

export function FileDialog({ pending, locale, onAnswer }: FileDialogProps) {
  const kernel = useKernel();
  const { spec } = pending;
  const [cwd, setCwd] = useState(() => spec.startPath ?? `${KERNEL_USER_FOLDER}\\Documents`);
  const [name, setName] = useState(spec.suggestedName ?? '');
  const [selected, setSelected] = useState<string | null>(null);

  const volumes = useKernelView(kernel.vfs, () => kernel.vfs.volumes());
  const listing = useKernelView(kernel.vfs, () => kernel.vfs.list(cwd, false));
  const entries = useMemo<readonly VfsStat[]>(() => {
    if (!listing.ok) return [];
    const allowed = spec.contentTypes;
    return listing.value
      .filter((stat) => stat.kind === 'directory' || allowed === undefined || allowed.includes(stat.contentType))
      .slice()
      .sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name, locale.intlLocale)
          : a.kind === 'directory'
            ? -1
            : 1,
      );
  }, [listing, spec.contentTypes, locale]);

  const places = useMemo<readonly Place[]>(
    () => [
      { path: `${KERNEL_USER_FOLDER}\\Desktop`, label: locale.tr('سطح المكتب', 'Bureau', 'Desktop') },
      { path: `${KERNEL_USER_FOLDER}\\Documents`, label: locale.tr('المستندات', 'Documents', 'Documents') },
      { path: `${KERNEL_USER_FOLDER}\\Downloads`, label: locale.tr('التنزيلات', 'Téléchargements', 'Downloads') },
      ...volumes.map((volume) => ({ path: `${volume.letter}\\`, label: `${locale.t(volume.label)} (${volume.letter})` })),
    ],
    [volumes, locale],
  );

  // Save mode composes a path from the typed name; open mode already has one.
  const typed = name.trim();
  const target = spec.mode === 'save' ? (typed.length === 0 ? null : join(cwd, typed)) : selected;
  const exists = target !== null && kernel.vfs.stat(target).ok;
  const cancel = () => onAnswer(pending.id, null);

  const enter = (stat: VfsStat) => {
    if (stat.kind === 'directory') {
      setCwd(stat.path);
      setSelected(null);
      return;
    }
    if (spec.mode === 'save') setName(stat.name);
    else onAnswer(pending.id, stat.path);
  };

  const commit = () => {
    if (target === null) return;
    if (spec.mode === 'open' && !exists) return;
    onAnswer(pending.id, target);
  };

  const title =
    spec.title ??
    (spec.mode === 'save' ? locale.tr('حفظ باسم', 'Enregistrer sous', 'Save as') : locale.tr('فتح', 'Ouvrir', 'Open'));

  return (
    <Modal label={title} onCancel={cancel} wide>
      <header className="fx-picker-head">
        <span className="fx-subtitle-text">{title}</span>
        <button
          type="button"
          className="fx-icon-btn"
          title={locale.tr('مستوى أعلى', 'Dossier parent', 'Up one level')}
          aria-label={locale.tr('مستوى أعلى', 'Dossier parent', 'Up one level')}
          onClick={() => {
            setCwd((path) => dirname(path));
            setSelected(null);
          }}
        >
          <ArrowUp size={15} />
        </button>
        <span className="fx-picker-path fx-title-ellipsis">{cwd}</span>
      </header>

      <div className="fx-picker-main">
        <nav className="fx-picker-places fx-scroll">
          {places.map((place) => (
            <button
              key={place.path}
              type="button"
              className="fx-nav-item"
              data-selected={place.path.toLowerCase() === cwd.toLowerCase()}
              onClick={() => {
                setCwd(place.path);
                setSelected(null);
              }}
            >
              {place.label}
            </button>
          ))}
        </nav>

        <div className="fx-picker-list fx-scroll">
          {entries.length === 0 ? (
            <p className="fx-caption-text">{locale.tr('المجلد فارغ', 'Dossier vide', 'This folder is empty')}</p>
          ) : (
            entries.map((stat) => {
              const Glyph = iconForContentType(stat.contentType, stat.kind);
              return (
                <button
                  key={stat.path}
                  type="button"
                  className="fx-picker-row"
                  data-selected={stat.path === selected}
                  onClick={() => {
                    setSelected(stat.kind === 'file' ? stat.path : null);
                    if (stat.kind === 'file' && spec.mode === 'save') setName(stat.name);
                  }}
                  onDoubleClick={() => enter(stat)}
                >
                  <Glyph size={16} strokeWidth={1.7} />
                  <span className="fx-picker-name fx-title-ellipsis">{stat.name}</span>
                  <span className="fx-caption-text">{fmt.relativeTime(stat.modifiedAt, locale.lang)}</span>
                  <span className="fx-caption-text fx-num">
                    {stat.kind === 'file' ? fmt.bytes(stat.size, locale.lang) : ''}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {spec.mode === 'save' ? (
        <div className="fx-picker-name-row">
          <label className="fx-caption-text" htmlFor="fx-picker-filename">
            {locale.tr('اسم الملف', 'Nom du fichier', 'File name')}
          </label>
          <input
            id="fx-picker-filename"
            className="fx-input"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
            }}
          />
          {exists ? (
            <span className="fx-picker-warn fx-caption-text">
              <AlertTriangle size={13} />
              {locale.tr('سيتم استبدال الملف', 'Le fichier sera remplacé', 'The file will be replaced')}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="fx-dialog-footer">
        <span className="fx-caption-text">
          {spec.contentTypes === undefined
            ? locale.tr('كل الملفات', 'Tous les fichiers', 'All files')
            : spec.contentTypes.join(', ')}
        </span>
        <button type="button" className="fx-btn" onClick={cancel}>
          {locale.tr('إلغاء', 'Annuler', 'Cancel')}
        </button>
        <button
          type="button"
          className="fx-btn"
          data-variant="accent"
          disabled={target === null || (spec.mode === 'open' && !exists)}
          onClick={commit}
        >
          {spec.mode === 'save' ? locale.tr('حفظ', 'Enregistrer', 'Save') : locale.tr('فتح', 'Ouvrir', 'Open')}
        </button>
      </div>
    </Modal>
  );
}
