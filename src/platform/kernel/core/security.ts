/**
 * Security — principals, capability grants and elevation (UAC).
 *
 * Two independent checks stand between an app and a privileged operation:
 *
 *   1. *Grant*: the capability must be in the intersection of the app manifest's
 *      request and the principal's role-derived privileges. Computed once at
 *      spawn and frozen into the process record.
 *   2. *Elevation*: capabilities in `PRIVILEGED_CAPABILITIES` additionally need a
 *      live consent token. The shell renders the prompt; this subsystem holds the
 *      promise and the expiry.
 *
 * Roles come from the host application's authenticated session, so the OS
 * inherits the same authority model as the rest of the product rather than
 * inventing a parallel one.
 */
import {
  PRIVILEGED_CAPABILITIES,
  sid as toSid,
  type Capability,
  type Localized,
  type Pid,
  type PrincipalInfo,
} from '../abi';
import type { IsoTimestamp } from '../types';
import type { ElevationRequest, KernelClock, KernelLogger, SecuritySubsystem } from '../contracts';
import { EVENT_IDS } from './eventlog';
import { uuid } from './ids';
import { createSignal } from './store';

/** How long a granted elevation stays valid, matching Windows' UAC window. */
const ELEVATION_TTL_MS = 15 * 60 * 1000;

/**
 * Role → capability map. A principal's grantable set is the union over its
 * roles. Read capabilities are broad; posting and closing are deliberately not.
 */
const ROLE_CAPABILITIES: Readonly<Record<string, readonly Capability[]>> = {
  super_admin: [
    'fs.read',
    'fs.write',
    'registry.read',
    'registry.write',
    'ledger.read',
    'ledger.post',
    'ledger.close',
    'process.enumerate',
    'process.terminate',
    'service.control',
    'eventlog.read',
    'eventlog.write',
    'notify',
    'clipboard',
    'window.manage',
    'shell.launch',
    'settings.write',
    'power',
    'net.query',
  ],
  admin: [
    'fs.read',
    'fs.write',
    'registry.read',
    'registry.write',
    'ledger.read',
    'ledger.post',
    'ledger.close',
    'process.enumerate',
    'process.terminate',
    'service.control',
    'eventlog.read',
    'eventlog.write',
    'notify',
    'clipboard',
    'window.manage',
    'shell.launch',
    'settings.write',
    'power',
    'net.query',
  ],
  finance_manager: [
    'fs.read',
    'fs.write',
    'registry.read',
    'registry.write',
    'ledger.read',
    'ledger.post',
    'ledger.close',
    'process.enumerate',
    'eventlog.read',
    'eventlog.write',
    'notify',
    'clipboard',
    'window.manage',
    'shell.launch',
    'settings.write',
    'net.query',
  ],
  accountant: [
    'fs.read',
    'fs.write',
    'registry.read',
    'registry.write',
    'ledger.read',
    'ledger.post',
    'process.enumerate',
    'eventlog.read',
    'eventlog.write',
    'notify',
    'clipboard',
    'window.manage',
    'shell.launch',
    'settings.write',
    'net.query',
  ],
  auditor: [
    'fs.read',
    'registry.read',
    'ledger.read',
    'process.enumerate',
    'eventlog.read',
    'notify',
    'clipboard',
    'window.manage',
    'shell.launch',
    'net.query',
  ],
  staff: [
    'fs.read',
    'fs.write',
    'registry.read',
    'registry.write',
    'ledger.read',
    'notify',
    'clipboard',
    'window.manage',
    'shell.launch',
    'settings.write',
  ],
  viewer: ['fs.read', 'registry.read', 'ledger.read', 'notify', 'window.manage', 'shell.launch'],
};

/** Every principal gets these, regardless of role — they are not privileges. */
const BASELINE: readonly Capability[] = ['fs.read', 'registry.read', 'notify', 'window.manage', 'shell.launch'];

interface PendingPrompt extends ElevationRequest {
  readonly resolve: (granted: boolean) => void;
}

class Security implements SecuritySubsystem {
  private current: PrincipalInfo;
  private elevationExpiresAt: number | null = null;
  private elevatedCapabilities = new Set<Capability>();
  private readonly prompts = new Map<string, PendingPrompt>();
  private readonly signal = createSignal();

  constructor(
    private readonly clock: KernelClock,
    private readonly log: KernelLogger,
  ) {
    this.current = {
      sid: toSid('S-1-5-0'),
      displayName: 'Guest',
      email: null,
      roles: [],
      capabilities: [...BASELINE],
      elevated: false,
      elevationExpiresAt: null,
      agencyId: null,
      branchId: null,
    };
  }

  principal(): PrincipalInfo {
    this.expireIfDue();
    return this.current;
  }

  setPrincipal(nextPrincipal: {
    sid: string;
    displayName: string;
    email: string | null;
    roles: readonly string[];
    agencyId: string | null;
    branchId: string | null;
  }): void {
    const capabilities = computeCapabilities(nextPrincipal.roles);
    const changed = this.current.sid !== toSid(nextPrincipal.sid);
    this.current = {
      sid: toSid(nextPrincipal.sid),
      displayName: nextPrincipal.displayName,
      email: nextPrincipal.email,
      roles: [...nextPrincipal.roles],
      capabilities,
      elevated: false,
      elevationExpiresAt: null,
      agencyId: nextPrincipal.agencyId,
      branchId: nextPrincipal.branchId,
    };
    // A new identity never inherits the previous one's consent.
    this.elevationExpiresAt = null;
    this.elevatedCapabilities = new Set<Capability>();
    for (const prompt of this.prompts.values()) prompt.resolve(false);
    this.prompts.clear();

    if (changed) {
      this.log.write('Security', 'information', EVENT_IDS.principalChanged, 'Security', 'Principal changed', {
        sid: nextPrincipal.sid,
        roles: nextPrincipal.roles.join(','),
        capabilities: capabilities.length,
      });
    }
    this.signal.bump();
  }

  grantable(): readonly Capability[] {
    return this.current.capabilities;
  }

  holds(capability: Capability): boolean {
    return this.current.capabilities.includes(capability);
  }

  isElevated(capability: Capability): boolean {
    if (!PRIVILEGED_CAPABILITIES.includes(capability)) return true;
    this.expireIfDue();
    return this.elevatedCapabilities.has(capability);
  }

  async requestElevation(
    processId: Pid,
    appName: Localized,
    capability: Capability,
    reason: Localized,
  ): Promise<boolean> {
    if (!this.holds(capability)) {
      this.log.write(
        'Security',
        'warning',
        EVENT_IDS.elevationDenied,
        'Security',
        `Elevation refused: principal lacks ${capability}`,
        { capability, app: appName.en },
        processId,
      );
      return false;
    }
    if (this.isElevated(capability)) return true;

    const id = uuid();
    this.log.write(
      'Security',
      'information',
      EVENT_IDS.elevationRequested,
      'Security',
      `Elevation requested for ${capability}`,
      { capability, app: appName.en, reason: reason.en },
      processId,
    );

    return new Promise<boolean>((resolve) => {
      this.prompts.set(id, {
        id,
        pid: processId,
        appName,
        capability,
        reason,
        requestedAt: this.clock.iso(),
        resolve,
      });
      this.signal.bump();
    });
  }

  pending(): readonly ElevationRequest[] {
    return [...this.prompts.values()].map(({ id, pid, appName, capability, reason, requestedAt }) => ({
      id,
      pid,
      appName,
      capability,
      reason,
      requestedAt,
    }));
  }

  resolveElevation(id: string, granted: boolean): void {
    const prompt = this.prompts.get(id);
    if (prompt === undefined) return;
    this.prompts.delete(id);

    if (granted) {
      this.elevatedCapabilities.add(prompt.capability);
      this.elevationExpiresAt = this.clock.now() + ELEVATION_TTL_MS;
      this.current = {
        ...this.current,
        elevated: true,
        elevationExpiresAt: new Date(this.elevationExpiresAt).toISOString() as IsoTimestamp,
      };
    }

    this.log.write(
      'Security',
      granted ? 'information' : 'warning',
      granted ? EVENT_IDS.elevationGranted : EVENT_IDS.elevationDenied,
      'Security',
      `Elevation ${granted ? 'granted' : 'denied'} for ${prompt.capability}`,
      { capability: prompt.capability, app: prompt.appName.en },
      prompt.pid,
    );
    prompt.resolve(granted);
    this.signal.bump();
  }

  revokeElevation(): void {
    if (this.elevatedCapabilities.size === 0 && this.elevationExpiresAt === null) return;
    this.elevatedCapabilities = new Set<Capability>();
    this.elevationExpiresAt = null;
    this.current = { ...this.current, elevated: false, elevationExpiresAt: null };
    this.log.write('Security', 'information', EVENT_IDS.elevationRevoked, 'Security', 'Elevation revoked');
    this.signal.bump();
  }

  subscribe(listener: () => void): () => void {
    return this.signal.subscribe(listener);
  }

  private expireIfDue(): void {
    if (this.elevationExpiresAt === null) return;
    if (this.clock.now() < this.elevationExpiresAt) return;
    this.elevatedCapabilities = new Set<Capability>();
    this.elevationExpiresAt = null;
    this.current = { ...this.current, elevated: false, elevationExpiresAt: null };
    this.log.write('Security', 'information', EVENT_IDS.elevationRevoked, 'Security', 'Elevation expired');
    this.signal.bump();
  }
}

/** Union of role grants plus the baseline, de-duplicated and stably ordered. */
export function computeCapabilities(roles: readonly string[]): readonly Capability[] {
  const granted = new Set<Capability>(BASELINE);
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) granted.add(capability);
  }
  return [...granted];
}

/**
 * The capability set a process actually receives: what the manifest asks for,
 * intersected with what the principal can delegate. Anything else is dropped
 * silently — the app finds out when the syscall is denied, exactly as it would
 * on a real OS.
 */
export function intersectCapabilities(
  requested: readonly Capability[],
  principal: readonly Capability[],
): readonly Capability[] {
  const allowed = new Set(principal);
  return requested.filter((capability) => allowed.has(capability));
}

export function createSecurity(clock: KernelClock, log: KernelLogger): SecuritySubsystem {
  return new Security(clock, log);
}

/** Roles the security model knows about — Settings renders these. */
export const KNOWN_ROLES: readonly string[] = Object.keys(ROLE_CAPABILITIES);
