/**
 * The machine table.
 *
 * A kernel is a machine, not a component: it owns volumes, a registry hive, a
 * scheduler and running services. Tying its lifetime to a React subtree would
 * mean the desktop loses every window whenever the host re-renders it, and — in
 * development — that React's double-mount boots and shuts the same kernel down
 * within a tick.
 *
 * So kernels live here, one per profile namespace, reference-counted:
 *
 *   ensure  → create the machine and install the OS image (idempotent)
 *   boot    → the one boot promise every caller awaits
 *   retain  → a mounted shell is using it
 *   release → nobody is; tear it down after a short grace period
 *
 * The grace period is what makes a remount free: React unmounts and remounts in
 * the same tick, the pending teardown is cancelled, and the desktop comes back
 * with its windows intact. A real unmount lets the timer fire, and the kernel is
 * shut down properly — services stopped, registry flushed, volumes unmounted.
 */
import { useEffect, useMemo } from 'react';
import type { Kernel } from '../kernel/contracts';
import { createKernel } from '../kernel/kernel';
import type { AppPackage } from '../sdk';

/**
 * Long enough to survive a React remount (which happens in the same tick),
 * short enough that navigating away really does stop the machine.
 */
const TEARDOWN_DELAY_MS = 250;

interface Machine {
  readonly kernel: Kernel;
  /** Mounted shells currently using this machine. */
  refs: number;
  /** The single in-flight or settled boot, so double-mount awaits one boot. */
  boot: Promise<void> | null;
  /** Pending teardown timer, 0 when none is scheduled. */
  teardown: number;
}

const machines = new Map<string, Machine>();

/**
 * Installs the OS image.
 *
 * Every package ships with the system, so the host registers it on each boot the
 * way Windows re-registers its inbox apps. The one exception is an app the user
 * uninstalled: the app registry remembers that, and re-installing it here would
 * quietly undo the removal on the next reload.
 */
function installImage(kernel: Kernel, packages: readonly AppPackage[]): void {
  const removed = new Set(kernel.apps.removed().map((id) => id as string));
  for (const { manifest } of packages) {
    if (kernel.apps.get(manifest.id) !== null) continue;
    if (!manifest.systemComponent && removed.has(manifest.id as string)) continue;
    kernel.apps.install(manifest);
  }
}

/**
 * The machine for a namespace, created on first use. Safe to call repeatedly:
 * an existing machine is returned as-is, with any newly shipped app installed.
 */
export function ensureMachine(namespace: string, packages: readonly AppPackage[]): Kernel {
  const existing = machines.get(namespace);
  if (existing !== undefined) {
    installImage(existing.kernel, packages);
    return existing.kernel;
  }
  // Nothing runs until boot(), so the image can be installed against a quiet
  // kernel — which is what lets Start and the taskbar render before boot ends.
  const kernel = createKernel({ namespace });
  installImage(kernel, packages);
  machines.set(namespace, { kernel, refs: 0, boot: null, teardown: 0 });
  return kernel;
}

/** Boots the machine once; every caller awaits the same promise. */
export function bootMachine(namespace: string): Promise<void> {
  const machine = machines.get(namespace);
  if (machine === undefined) return Promise.reject(new Error(`No machine for ${namespace}`));
  machine.boot ??= machine.kernel.boot();
  return machine.boot;
}

/**
 * Forgets a failed boot so it can be retried. A successful boot is never reset —
 * `kernel.boot()` is idempotent, but re-running it would be a lie about what
 * happened.
 */
export function resetMachineBoot(namespace: string): void {
  const machine = machines.get(namespace);
  if (machine === undefined || machine.kernel.booted()) return;
  machine.boot = null;
}

/** Marks the machine as in use, cancelling any scheduled teardown. */
export function retainMachine(namespace: string): void {
  const machine = machines.get(namespace);
  if (machine === undefined) return;
  if (machine.teardown !== 0) {
    window.clearTimeout(machine.teardown);
    machine.teardown = 0;
  }
  machine.refs += 1;
}

/**
 * Releases a reference. The last one out schedules the shutdown rather than
 * performing it, so a remount within the same tick keeps the machine running.
 */
export function releaseMachine(namespace: string): void {
  const machine = machines.get(namespace);
  if (machine === undefined) return;
  machine.refs = Math.max(0, machine.refs - 1);
  if (machine.refs > 0 || machine.teardown !== 0) return;
  machine.teardown = window.setTimeout(() => {
    machine.teardown = 0;
    if (machine.refs > 0) return;
    // Dropped from the table first: a later mount gets a fresh machine rather
    // than one whose services have already been stopped.
    machines.delete(namespace);
    void machine.kernel.shutdown();
  }, TEARDOWN_DELAY_MS);
}

/** Powers the machine off now, as a Restart or Shut down command does. */
export function haltMachine(namespace: string): Promise<void> {
  const machine = machines.get(namespace);
  if (machine === undefined) return Promise.resolve();
  if (machine.teardown !== 0) {
    window.clearTimeout(machine.teardown);
    machine.teardown = 0;
  }
  machines.delete(namespace);
  return machine.kernel.shutdown();
}

/**
 * The machine this shell runs on. Acquired for the component's lifetime; the
 * caller still has to await {@link bootMachine}, because booting is observable
 * and the shell shows it happening.
 *
 * `generation` is the power button: bumping it after {@link haltMachine} builds a
 * new machine, which is what Restart and Turn on do.
 */
export function useMachine(namespace: string, packages: readonly AppPackage[], generation: number): Kernel {
  // `generation` is a dependency of the *identity* of the machine rather than of
  // the expression that builds it, which is why the exhaustive-deps rule cannot
  // see it and both hooks below have to silence it by hand.
  const kernel = useMemo(
    () => ensureMachine(namespace, packages),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namespace, packages, generation],
  );
  useEffect(() => {
    retainMachine(namespace);
    return () => releaseMachine(namespace);
  }, [namespace, generation]);
  return kernel;
}
