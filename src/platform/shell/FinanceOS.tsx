/**
 * Finance OS — the shell root.
 *
 * This is the only component the host application mounts, and the only place
 * where the three worlds meet:
 *
 *   - the **host** (Supabase auth, the app's i18n provider) supplies identity
 *     and an initial language;
 *   - the **kernel** — a machine, kept outside React by `machine.ts` — owns
 *     processes, volumes, the registry, services and windows;
 *   - the **shell** paints all of it: desktop, taskbar, flyouts, dialogs and
 *     the boot / lock / power screens.
 *
 * Applications appear here only as a catalog of manifests plus lazy entry
 * points. The root never imports an app, never renders one directly, and never
 * hands one a kernel: a window's contents come from `AppSurface`, which gives
 * the app an `AppRuntime` over the syscall ABI and nothing else.
 *
 * Layering, from the bottom up — the z-index bands are declared in `fluent.css`:
 *
 *   desktop (0) · snap preview (900) · windows (950, isolated) · taskbar (1000)
 *   flyouts (1100) · task view (1120) · snap layouts (1150) · switcher (1180)
 *   dialogs (1200) · toasts (1300) · boot / lock / power (1400)
 *
 * The windows layer is isolated on purpose: window z-indexes are the window
 * manager's business and can run high, so they are contained rather than
 * allowed to compete with the shell's own chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n/I18nProvider';
import {
  APP_IDS,
  REG,
  type LaunchArgs,
  type PowerAction,
  type SnapZone,
  type WindowInfo,
} from '../kernel/abi';
import type { Kernel } from '../kernel/contracts';
import type { AppLocale, AppPackage } from '../sdk';
import { accentVariables, type Appearance } from './appearance';
import {
  KernelProvider,
  ShellHostProvider,
  useAppearance,
  useKernel,
  useKernelView,
  useKernelView2,
  useDismissOnOutside,
  useGlobalKeys,
  useShellHostState,
  useShellLocale,
} from './bindings';
import { createShellHost, type ShellHostController } from './host';
import { bootMachine, haltMachine, resetMachineBoot, useMachine } from './machine';
import { useShellUi, type ShellActions, type ShellUi, type SnapAnchor } from './shellState';
import { Desktop } from './Desktop';
import { Taskbar } from './Taskbar';
import { WindowFrame } from './WindowFrame';
import { StartMenu } from './StartMenu';
import { SearchPanel } from './Search';
import { CalendarFlyout, FLYOUT_DISMISS_SELECTOR, NotificationCentre, QuickSettings, WidgetsBoard } from './Flyouts';
import { Switcher, TaskView } from './TaskView';
import { ConsentDialog, FileDialog, MessageBox, ToastHost } from './Dialogs';
import { BootScreen, LockScreen, PowerScreen, type PowerScreenAction } from './Screens';
import { CrashPane } from './appHost';
import './fluent.css';

/** Taskbar height, mirroring `--fx-taskbar`; the work area stops here. */
const TASKBAR_HEIGHT = 48;
/** Half the snap-layout flyout's width, used to keep it inside the desktop. */
const SNAP_FLYOUT_HALF = 110;
/** A window whose process has already gone still needs *something* to render. */
const NO_ARGS: LaunchArgs = {};

/* ------------------------------------------------------------------ *
 * Root
 * ------------------------------------------------------------------ */

export interface FinanceOSProps {
  /** Every application that ships with this build of the system. */
  readonly packages: readonly AppPackage[];
  /** Leaves the OS — Sign out and the Start menu's Back both use it. */
  readonly onBack?: () => void;
}

/**
 * Resolves the signed-in user, then hands a per-profile machine to the shell.
 *
 * The namespace is derived from the account id so that two users sharing a
 * browser do not share a `C:` volume, a registry hive or a notification
 * history — the same reason Windows keeps a profile per account.
 */
export function FinanceOS({ packages, onBack }: FinanceOSProps) {
  const { session, loading, staffProfile } = useAuth();
  const { lang } = useI18n();

  const principal = useMemo(() => {
    const user = session?.user ?? null;
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
    const email = user?.email ?? null;
    const localPart = email === null ? '' : (email.split('@')[0] ?? '');
    return {
      sid: user?.id ?? 'guest',
      displayName: fullName !== '' ? fullName : localPart !== '' ? localPart : 'Operator',
      email,
      // A deactivated profile keeps its account but loses its role, so it lands
      // on a desktop with baseline rights only — read, launch, be notified.
      roles: staffProfile !== null && staffProfile.is_active ? [staffProfile.role] : [],
      agencyId: null,
      branchId: staffProfile?.branch_id ?? null,
    };
  }, [session, staffProfile]);

  if (loading) return <Splash />;

  return (
    <Session
      namespace={`financeos.v3.${principal.sid}`}
      packages={packages}
      principal={principal}
      language={lang}
      onBack={onBack}
    />
  );
}

export default FinanceOS;

/* ------------------------------------------------------------------ *
 * Session — machine lifetime, identity, power
 * ------------------------------------------------------------------ */

interface SessionProps {
  readonly namespace: string;
  readonly packages: readonly AppPackage[];
  readonly principal: Parameters<Kernel['security']['setPrincipal']>[0];
  readonly language: string;
  readonly onBack?: () => void;
}

function Session({ namespace, packages, principal, language, onBack }: SessionProps) {
  const [generation, setGeneration] = useState(0);
  const kernel = useMachine(namespace, packages, generation);
  const [ui, actions] = useShellUi('boot');
  const [bootError, setBootError] = useState<string | null>(null);
  const [halted, setHalted] = useState(false);

  // The kernel may ask for a power action from syscall context, long before the
  // handler below exists; the indirection keeps the host controller's identity
  // tied to the kernel rather than to every re-render.
  const powerRef = useRef<(action: PowerAction) => void>(() => undefined);

  const controller = useMemo(
    () =>
      createShellHost({
        onPower: (action) => powerRef.current(action),
        // Do Not Disturb is a registry value Quick Settings owns; reading it at
        // delivery time means the toggle takes effect on the next notification.
        quiet: () => kernel.registry.getBoolean(REG.userSession, 'DoNotDisturb', false),
      }),
    [kernel],
  );

  useEffect(() => {
    kernel.attachShell(controller.host);
  }, [kernel, controller]);

  useEffect(() => {
    kernel.security.setPrincipal(principal);
  }, [kernel, principal]);

  // The host's language seeds the OS the first time this profile boots. After
  // that Settings owns it, so an existing value is never overwritten.
  useEffect(() => {
    if (kernel.registry.getString(REG.userAppearance, 'Language', '') !== '') return;
    kernel.registry.set(REG.userAppearance, 'Language', language);
  }, [kernel, language]);

  useEffect(() => {
    if (kernel.booted()) {
      actions.setScreen('desktop');
      return;
    }
    let live = true;
    setBootError(null);
    bootMachine(namespace).then(
      () => {
        if (live) actions.setScreen('desktop');
      },
      (error: unknown) => {
        if (!live) return;
        // Forget the failed attempt so the retry below is a real second try.
        resetMachineBoot(namespace);
        setBootError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      live = false;
    };
  }, [kernel, namespace, actions]);

  /** Cold start: a brand-new machine, as the power button gives you. */
  const powerOn = useCallback(() => {
    setHalted(false);
    setBootError(null);
    actions.setScreen('boot');
    setGeneration((value) => value + 1);
  }, [actions]);

  const power = useCallback(
    (action: PowerAction) => {
      if (action === 'lock') {
        actions.setScreen('lock');
        return;
      }
      if (action === 'sleep') {
        // Sleep really stops the machine; the lock screen is what you come back
        // to, and unlocking starts it again.
        actions.setScreen('lock');
        void haltMachine(namespace);
        return;
      }
      // Signing out belongs to the host — it owns the account session. With
      // nowhere to hand control back to, signing out *is* a shutdown, and the
      // screen says so rather than spinning on a promise nobody will keep.
      const target =
        action === 'restart' ? 'restart' : action === 'signOut' && onBack !== undefined ? 'signout' : 'shutdown';
      actions.setScreen(target);
      void haltMachine(namespace).then(() => {
        if (action === 'restart') {
          powerOn();
          return;
        }
        if (target === 'signout') {
          onBack?.();
          return;
        }
        setHalted(true);
      });
    },
    [actions, namespace, onBack, powerOn],
  );

  useEffect(() => {
    powerRef.current = power;
  }, [power]);

  const unlock = useCallback(() => {
    if (kernel.booted()) {
      actions.setScreen('desktop');
      return;
    }
    powerOn();
  }, [kernel, actions, powerOn]);

  const retryBoot = useCallback(() => {
    setBootError(null);
    setGeneration((value) => value + 1);
  }, []);

  return (
    <KernelProvider kernel={kernel}>
      <ShellHostProvider controller={controller}>
        <Shell
          ui={ui}
          actions={actions}
          controller={controller}
          packages={packages}
          halted={halted}
          bootError={bootError}
          onRetryBoot={retryBoot}
          onUnlock={unlock}
          onPower={power}
          onPowerOn={powerOn}
        />
      </ShellHostProvider>
    </KernelProvider>
  );
}

/* ------------------------------------------------------------------ *
 * Shell — the desktop and everything above it
 * ------------------------------------------------------------------ */

interface ShellProps {
  readonly ui: ShellUi;
  readonly actions: ShellActions;
  readonly controller: ShellHostController;
  readonly packages: readonly AppPackage[];
  readonly halted: boolean;
  readonly bootError: string | null;
  readonly onRetryBoot: () => void;
  readonly onUnlock: () => void;
  readonly onPower: (action: PowerAction) => void;
  readonly onPowerOn: () => void;
}

function Shell({
  ui,
  actions,
  controller,
  packages,
  halted,
  bootError,
  onRetryBoot,
  onUnlock,
  onPower,
  onPowerOn,
}: ShellProps) {
  const kernel = useKernel();
  const appearance = useAppearance();
  const locale = useShellLocale();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [peek, setPeek] = useState(false);

  const catalog = useMemo(
    () => new Map(packages.map((pkg) => [pkg.manifest.id as string, pkg])),
    [packages],
  );

  const windows = useKernelView2(kernel.wm, kernel.processes, () => kernel.wm.visible());
  const focused = useKernelView(kernel.wm, () => {
    const id = kernel.wm.focused();
    return id === null ? null : kernel.wm.get(id);
  });
  const hint = ui.snapHint === null ? null : kernel.wm.zoneRect(ui.snapHint);
  const viewport = useKernelView(kernel.wm, () => kernel.wm.viewport());

  /* -------- work area -------- */

  // An auto-hidden taskbar gives its 48px back to the windows, exactly as on
  // Windows: maximised means the whole desktop.
  const insetBottom = appearance.taskbarAutoHide ? 0 : TASKBAR_HEIGHT;
  useEffect(() => {
    const host = rootRef.current;
    if (host === null) return;
    const publish = () => {
      const box = host.getBoundingClientRect();
      kernel.wm.setViewport({
        w: Math.round(box.width),
        h: Math.round(box.height),
        insetTop: 0,
        insetBottom,
      });
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(host);
    return () => observer.disconnect();
  }, [kernel, insetBottom]);

  /* -------- closing a window -------- */

  const requestClose = useCallback(
    (win: WindowInfo) => {
      if (!win.dirty) {
        kernel.wm.close(win.id);
        return;
      }
      void controller.host
        .messageBox({
          kind: 'question',
          title: win.title,
          body: locale.tr(
            'هناك تغييرات غير محفوظة. إغلاق النافذة سيؤدي إلى فقدانها.',
            'Des modifications ne sont pas enregistrées. Fermer la fenêtre les perdra.',
            'There are unsaved changes. Closing the window will discard them.',
          ),
          confirmLabel: { ar: 'إغلاق دون حفظ', fr: 'Fermer sans enregistrer', en: 'Close without saving' },
          cancelLabel: { ar: 'إلغاء', fr: 'Annuler', en: 'Cancel' },
          destructive: true,
        })
        .then((confirmed) => {
          if (confirmed) kernel.wm.close(win.id);
        });
    },
    [kernel, controller, locale],
  );

  /* -------- dismissal -------- */

  const closeSnapFlyout = useCallback(() => {
    actions.setSnapFlyout(null);
    actions.setSnapHint(null);
  }, [actions]);

  // Start, Search and Task View dismiss themselves; the tray flyouts and the
  // widgets board do not, because they are anchored, not modal.
  const trayOpen =
    ui.flyout === 'quick' || ui.flyout === 'notifications' || ui.flyout === 'calendar' || ui.flyout === 'widgets';
  useDismissOnOutside(trayOpen, actions.closeFlyout, FLYOUT_DISMISS_SELECTOR);
  useDismissOnOutside(ui.snapFlyout !== null, closeSnapFlyout, '.fx-snap-flyout');

  /* -------- keyboard -------- */

  useShellShortcuts({ kernel, ui, actions, focused, onRequestClose: requestClose, onPower });

  /* -------- composition -------- */

  const snapFlyout = ui.snapFlyout;
  const barShown = !appearance.taskbarAutoHide || peek || ui.flyout !== null;

  return (
    <div
      ref={rootRef}
      className="fos"
      dir={locale.rtl ? 'rtl' : 'ltr'}
      lang={locale.lang}
      data-theme={appearance.theme}
      data-transparency={appearance.transparency ? 'true' : 'false'}
      data-animations={appearance.animations ? 'true' : 'false'}
      data-taskbar={barShown ? 'shown' : 'hidden'}
      // The accent ladder is a set of custom properties, which `CSSProperties`
      // has no way to describe; the cast is the whole of the compromise.
      style={accentVariables(appearance.accent) as CSSProperties}
    >
      <Desktop locale={locale} appearance={appearance} />

      {hint === null ? null : (
        <div
          className="fx-snap-overlay"
          style={{ left: hint.x, top: hint.y, width: hint.w, height: hint.h }}
          aria-hidden="true"
        />
      )}

      <div className="fx-windows">
        {windows.map((win) => (
          <WindowFrame
            key={win.id as string}
            win={win}
            pkg={catalog.get(win.appId as string) ?? null}
            locale={locale}
            args={kernel.processes.get(win.pid)?.args ?? NO_ARGS}
            onSnapHint={actions.setSnapHint}
            onSnapFlyout={actions.setSnapFlyout}
            onRequestClose={requestClose}
          />
        ))}
      </div>

      {snapFlyout === null ? null : (
        <SnapLayouts
          anchor={snapFlyout}
          locale={locale}
          width={viewport.w}
          onHover={actions.setSnapHint}
          onPick={(zone) => {
            kernel.wm.snap(snapFlyout.window, zone);
            closeSnapFlyout();
          }}
          onDismiss={closeSnapFlyout}
        />
      )}

      <div
        onPointerEnter={() => setPeek(true)}
        onPointerLeave={() => setPeek(false)}
      >
        {appearance.taskbarAutoHide ? (
          <div
            className="fx-taskbar-reveal"
            style={{ pointerEvents: barShown ? 'none' : 'auto' }}
            aria-hidden="true"
          />
        ) : null}
        <Taskbar
          locale={locale}
          appearance={appearance}
          ui={ui}
          actions={actions}
          onRequestClose={requestClose}
        />
      </div>

      <ShellOverlays
        ui={ui}
        locale={locale}
        appearance={appearance}
        actions={actions}
        controller={controller}
        halted={halted}
        bootError={bootError}
        onRetryBoot={onRetryBoot}
        onUnlock={onUnlock}
        onPower={onPower}
        onPowerOn={onPowerOn}
        onRequestClose={requestClose}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overlays
 * ------------------------------------------------------------------ */

interface ShellOverlaysProps {
  readonly ui: ShellUi;
  readonly locale: AppLocale;
  readonly appearance: Appearance;
  readonly actions: ShellActions;
  readonly controller: ShellHostController;
  readonly halted: boolean;
  readonly bootError: string | null;
  readonly onRetryBoot: () => void;
  readonly onUnlock: () => void;
  readonly onPower: (action: PowerAction) => void;
  readonly onPowerOn: () => void;
  readonly onRequestClose: (win: WindowInfo) => void;
}

/**
 * Everything that paints above the windows: the seven shell flyouts, Alt+Tab,
 * the kernel's consent dialog, the host's message and file dialogs, the toast
 * stack, and the full-screen surfaces that replace the desktop entirely.
 *
 * Split out of `Shell` because it is a layer, not a decision: `Shell` owns the
 * desktop, the window list and the work area, and hands the rest of the z-order
 * to one component that reads `ui` and paints.
 */
function ShellOverlays({
  ui,
  locale,
  appearance,
  actions,
  controller,
  halted,
  bootError,
  onRetryBoot,
  onUnlock,
  onPower,
  onPowerOn,
  onRequestClose,
}: ShellOverlaysProps) {
  const kernel = useKernel();
  const hostState = useShellHostState(controller);
  return (
    <>
      {ui.flyout === 'start' ? (
        <StartMenu locale={locale} onDismiss={actions.closeFlyout} onPower={onPower} />
      ) : null}
      {ui.flyout === 'search' ? <SearchPanel locale={locale} onDismiss={actions.closeFlyout} /> : null}
      {ui.flyout === 'quick' ? (
        <QuickSettings locale={locale} appearance={appearance} onDismiss={actions.closeFlyout} />
      ) : null}
      {ui.flyout === 'notifications' ? (
        <NotificationCentre locale={locale} onDismiss={actions.closeFlyout} />
      ) : null}
      {ui.flyout === 'calendar' ? <CalendarFlyout locale={locale} /> : null}
      {ui.flyout === 'widgets' ? <WidgetsBoard locale={locale} onDismiss={actions.closeFlyout} /> : null}
      {ui.flyout === 'taskview' ? (
        <TaskView locale={locale} onDismiss={actions.closeFlyout} onRequestClose={onRequestClose} />
      ) : null}

      {ui.switcher === null ? null : (
        <Switcher
          locale={locale}
          index={ui.switcher}
          onPick={(win) => {
            actions.setSwitcher(null);
            if (win.state === 'minimized') kernel.wm.restore(win.id);
            kernel.wm.focus(win.id);
          }}
        />
      )}

      <ConsentDialog locale={locale} />
      {hostState.dialog === null ? null : (
        <MessageBox
          pending={hostState.dialog}
          locale={locale}
          onAnswer={(id, confirmed) => controller.answerDialog(id, confirmed)}
        />
      )}
      {hostState.fileDialog === null ? null : (
        <FileDialog
          pending={hostState.fileDialog}
          locale={locale}
          onAnswer={(id, path) => controller.answerFileDialog(id, path)}
        />
      )}
      <ToastHost toasts={hostState.toasts} locale={locale} onDismiss={(id) => controller.dismissToast(id)} />

      {ui.screen === 'desktop' ? null : (
        <ScreenLayer
          screen={ui.screen}
          locale={locale}
          appearance={appearance}
          halted={halted}
          bootError={bootError}
          onRetryBoot={onRetryBoot}
          onUnlock={onUnlock}
          onPowerOn={onPowerOn}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Full-screen surfaces
 * ------------------------------------------------------------------ */

interface ScreenLayerProps {
  readonly screen: ShellUi['screen'];
  readonly locale: AppLocale;
  readonly appearance: Appearance;
  readonly halted: boolean;
  readonly bootError: string | null;
  readonly onRetryBoot: () => void;
  readonly onUnlock: () => void;
  readonly onPowerOn: () => void;
}

function ScreenLayer({
  screen,
  locale,
  appearance,
  halted,
  bootError,
  onRetryBoot,
  onUnlock,
  onPowerOn,
}: ScreenLayerProps) {
  if (screen === 'lock') return <LockScreen locale={locale} appearance={appearance} onUnlock={onUnlock} />;

  if (screen === 'boot') {
    if (bootError === null) return <BootScreen locale={locale} />;
    // A machine that cannot start says so, instead of spinning for ever.
    return (
      <div className="fx-screen fx-screen-boot" role="alert">
        <CrashPane
          title={locale.tr('تعذّر تشغيل النظام', 'Le système n’a pas pu démarrer', 'The system could not start')}
          detail={bootError}
          retryLabel={locale.tr('إعادة المحاولة', 'Réessayer', 'Try again')}
          onRetry={onRetryBoot}
        />
      </div>
    );
  }

  const action: PowerScreenAction = screen === 'restart' ? 'restart' : screen === 'signout' ? 'signout' : 'shutdown';
  return <PowerScreen locale={locale} action={action} halted={halted} onPowerOn={onPowerOn} />;
}

/* ------------------------------------------------------------------ *
 * Snap layouts
 * ------------------------------------------------------------------ */

interface SnapLayout {
  readonly id: string;
  readonly columns: string;
  readonly rows: string;
  readonly cells: readonly SnapZone[];
}

/**
 * The six layouts Windows 11 offers, covering every zone the window manager
 * knows: halves, thirds, two-thirds pairs, quadrants and a top/bottom stack.
 */
const SNAP_LAYOUTS: readonly SnapLayout[] = [
  { id: 'halves', columns: '1fr 1fr', rows: '1fr', cells: ['left', 'right'] },
  { id: 'thirds', columns: '1fr 1fr 1fr', rows: '1fr', cells: ['leftThird', 'centerThird', 'rightThird'] },
  { id: 'wide-left', columns: '2fr 1fr', rows: '1fr', cells: ['leftTwoThirds', 'rightThird'] },
  { id: 'wide-right', columns: '1fr 2fr', rows: '1fr', cells: ['leftThird', 'rightTwoThirds'] },
  {
    id: 'quadrants',
    columns: '1fr 1fr',
    rows: '1fr 1fr',
    cells: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'],
  },
  { id: 'stack', columns: '1fr', rows: '1fr 1fr', cells: ['top', 'bottom'] },
];

function zoneLabel(zone: SnapZone, locale: AppLocale): string {
  switch (zone) {
    case 'left':
      return locale.tr('النصف الأيسر', 'Moitié gauche', 'Left half');
    case 'right':
      return locale.tr('النصف الأيمن', 'Moitié droite', 'Right half');
    case 'top':
      return locale.tr('النصف الأعلى', 'Moitié haute', 'Top half');
    case 'bottom':
      return locale.tr('النصف الأسفل', 'Moitié basse', 'Bottom half');
    case 'topLeft':
      return locale.tr('أعلى اليسار', 'En haut à gauche', 'Top left');
    case 'topRight':
      return locale.tr('أعلى اليمين', 'En haut à droite', 'Top right');
    case 'bottomLeft':
      return locale.tr('أسفل اليسار', 'En bas à gauche', 'Bottom left');
    case 'bottomRight':
      return locale.tr('أسفل اليمين', 'En bas à droite', 'Bottom right');
    case 'leftThird':
      return locale.tr('الثلث الأيسر', 'Tiers gauche', 'Left third');
    case 'centerThird':
      return locale.tr('الثلث الأوسط', 'Tiers central', 'Centre third');
    case 'rightThird':
      return locale.tr('الثلث الأيمن', 'Tiers droit', 'Right third');
    case 'leftTwoThirds':
      return locale.tr('الثلثان الأيسران', 'Deux tiers gauche', 'Left two-thirds');
    case 'rightTwoThirds':
      return locale.tr('الثلثان الأيمنان', 'Deux tiers droite', 'Right two-thirds');
  }
}

interface SnapLayoutsProps {
  readonly anchor: SnapAnchor;
  readonly locale: AppLocale;
  /** Desktop width, used to keep the flyout on screen near the edges. */
  readonly width: number;
  readonly onHover: (zone: SnapZone | null) => void;
  readonly onPick: (zone: SnapZone) => void;
  readonly onDismiss: () => void;
}

/**
 * The flyout that drops from a maximize button. Hovering a cell paints the real
 * snap preview through the window manager, so what you see is where the window
 * will land — not an approximation drawn by the flyout.
 */
function SnapLayouts({ anchor, locale, width, onHover, onPick, onDismiss }: SnapLayoutsProps) {
  const centre = Math.min(Math.max(anchor.x, SNAP_FLYOUT_HALF), Math.max(SNAP_FLYOUT_HALF, width - SNAP_FLYOUT_HALF));

  return (
    <div
      className="fx-snap-flyout"
      style={{ left: centre - SNAP_FLYOUT_HALF, top: anchor.y }}
      role="group"
      aria-label={locale.tr('تخطيطات الالتصاق', 'Dispositions d’ancrage', 'Snap layouts')}
      onPointerLeave={() => {
        onHover(null);
        onDismiss();
      }}
    >
      {SNAP_LAYOUTS.map((layout) => (
        <div
          key={layout.id}
          className="fx-snap-tile"
          style={{ gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows }}
        >
          {layout.cells.map((zone) => (
            <button
              key={zone}
              type="button"
              className="fx-snap-cell"
              title={zoneLabel(zone, locale)}
              aria-label={zoneLabel(zone, locale)}
              onPointerEnter={() => onHover(zone)}
              onClick={() => onPick(zone)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

interface Shortcuts {
  readonly kernel: Kernel;
  readonly ui: ShellUi;
  readonly actions: ShellActions;
  readonly focused: WindowInfo | null;
  readonly onRequestClose: (win: WindowInfo) => void;
  readonly onPower: (action: PowerAction) => void;
}

/**
 * Global shortcuts.
 *
 * Best-effort by nature: a browser cannot take the Windows key or Alt+Tab away
 * from the real operating system underneath, so every chord here also has a
 * pointer path through the taskbar or a menu. Where the browser does deliver
 * the event, the behaviour matches Windows 11.
 */
function useShellShortcuts(env: Shortcuts): void {
  const latest = useRef(env);
  const metaTap = useRef(false);

  useEffect(() => {
    latest.current = env;
  }, [env]);

  useGlobalKeys(
    useCallback((event: KeyboardEvent) => {
      // Tapping the Windows key opens Start; using it as a modifier does not.
      if (event.key === 'Meta') {
        metaTap.current = true;
        return;
      }
      metaTap.current = false;
      handleKeyDown(latest.current, event);
    }, []),
  );

  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      const { ui, actions, kernel } = latest.current;
      if (event.key === 'Meta') {
        const tapped = metaTap.current;
        metaTap.current = false;
        if (tapped && ui.screen === 'desktop') actions.toggleFlyout('start');
        return;
      }
      // Releasing Alt commits the Alt+Tab selection, as on Windows.
      if (event.key !== 'Alt' || ui.switcher === null) return;
      const order = kernel.wm.mruOrder().filter((win) => win.desktop === kernel.wm.activeDesktop());
      const target = order.length === 0 ? undefined : order[Math.abs(ui.switcher) % order.length];
      actions.setSwitcher(null);
      if (target === undefined) return;
      if (target.state === 'minimized') kernel.wm.restore(target.id);
      kernel.wm.focus(target.id);
    };
    window.addEventListener('keyup', onKeyUp, true);
    return () => window.removeEventListener('keyup', onKeyUp, true);
  }, []);
}

function handleKeyDown(env: Shortcuts, event: KeyboardEvent): void {
  const { kernel, ui, actions } = env;
  if (ui.screen !== 'desktop') return;

  if (event.altKey && event.key === 'Tab') {
    event.preventDefault();
    const order = kernel.wm.mruOrder().filter((win) => win.desktop === kernel.wm.activeDesktop());
    if (order.length === 0) return;
    // The first press selects the window behind the current one.
    const next = ui.switcher === null ? (order.length > 1 ? 1 : 0) : ui.switcher + (event.shiftKey ? -1 : 1);
    actions.setSwitcher(((next % order.length) + order.length) % order.length);
    return;
  }

  if (event.altKey && event.key === 'F4') {
    event.preventDefault();
    if (env.focused !== null) env.onRequestClose(env.focused);
    return;
  }

  if (event.ctrlKey && event.shiftKey && event.key === 'Escape') {
    event.preventDefault();
    void kernel.launch(APP_IDS.taskManager);
    return;
  }

  if (event.key === 'Escape') {
    handleEscape(env, event);
    return;
  }

  if (!event.metaKey) return;
  if (event.ctrlKey ? handleDesktopChord(env, event) : handleWinChord(env, event)) event.preventDefault();
}

/**
 * Escape unwinds one layer at a time — the switcher, then the snap flyout, then
 * whatever flyout is open — so a single press never closes two things at once.
 */
function handleEscape(env: Shortcuts, event: KeyboardEvent): void {
  const { ui, actions } = env;
  if (ui.switcher !== null) {
    event.preventDefault();
    actions.setSwitcher(null);
    return;
  }
  if (ui.snapFlyout !== null) {
    event.preventDefault();
    actions.setSnapFlyout(null);
    actions.setSnapHint(null);
    return;
  }
  if (ui.flyout !== null) {
    event.preventDefault();
    actions.closeFlyout();
  }
}

/** Win+… chords. Returns true when the chord was handled. */
function handleWinChord(env: Shortcuts, event: KeyboardEvent): boolean {
  const { kernel, actions } = env;
  switch (event.key.toLowerCase()) {
    case 'i':
      void kernel.launch(APP_IDS.settings);
      return true;
    case 'r':
      void kernel.launch(APP_IDS.terminal);
      return true;
    case 's':
    case 'q':
      actions.openFlyout('search');
      return true;
    case 'a':
      actions.openFlyout('quick');
      return true;
    case 'n':
      actions.openFlyout('notifications');
      return true;
    case 'w':
      actions.openFlyout('widgets');
      return true;
    case 'd':
    case 'm':
      kernel.wm.minimizeAll();
      return true;
    case 'l':
      env.onPower('lock');
      return true;
    case 'tab':
      actions.openFlyout('taskview');
      return true;
    default:
      return handleWindowChord(env, event);
  }
}

/** Win+Arrow window arrangement. */
function handleWindowChord(env: Shortcuts, event: KeyboardEvent): boolean {
  const { kernel, focused } = env;
  if (focused === null) return false;
  switch (event.key) {
    case 'ArrowLeft':
      kernel.wm.snap(focused.id, 'left');
      return true;
    case 'ArrowRight':
      kernel.wm.snap(focused.id, 'right');
      return true;
    case 'ArrowUp':
      if (focused.state !== 'maximized') kernel.wm.toggleMaximize(focused.id);
      return true;
    case 'ArrowDown':
      // Down steps back: maximised → restored → minimised.
      if (focused.state === 'maximized' || focused.state === 'snapped') kernel.wm.restore(focused.id);
      else kernel.wm.minimize(focused.id);
      return true;
    default:
      return false;
  }
}

/** Win+Ctrl+… virtual-desktop chords. */
function handleDesktopChord(env: Shortcuts, event: KeyboardEvent): boolean {
  const { wm } = env.kernel;
  const desktops = wm.desktops();
  const current = desktops.findIndex((desktop) => desktop.id === wm.activeDesktop());
  switch (event.key.toLowerCase()) {
    case 'd':
      wm.switchDesktop(wm.addDesktop());
      return true;
    case 'f4': {
      if (desktops.length < 2) return true;
      const active = wm.activeDesktop();
      const fallback = desktops[current === 0 ? 1 : current - 1];
      if (fallback !== undefined) wm.switchDesktop(fallback.id);
      wm.removeDesktop(active);
      return true;
    }
    case 'arrowright': {
      const next = desktops[current + 1];
      if (next !== undefined) wm.switchDesktop(next.id);
      return true;
    }
    case 'arrowleft': {
      const previous = desktops[current - 1];
      if (previous !== undefined) wm.switchDesktop(previous.id);
      return true;
    }
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ *
 * Pre-kernel splash
 * ------------------------------------------------------------------ */

/**
 * Shown while the host resolves the account. There is no kernel yet, so this
 * deliberately says nothing about the system's state.
 */
function Splash() {
  return (
    <div className="fos" data-theme="dark">
      <div className="fx-screen fx-screen-boot" role="status" aria-live="polite">
        <div className="fx-boot-mark">
          <span className="fx-boot-logo">₣</span>
          <span className="fx-boot-name">Finance OS</span>
        </div>
        <div className="fx-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
