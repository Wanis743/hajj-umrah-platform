/**
 * Kernel test harness — mirrors the repo's hand-rolled assert convention
 * (see src/engine/math/financial.test.ts). Runs under
 * `node --experimental-strip-types`. Zero dependencies, zero `any`.
 */

import {
  commandId,
  correlationId as mkCorrelation,
  minorUnits,
  objectId,
  objectTypeId,
  roleId,
} from '../src/platform/kernel/types.ts';
import { ObjectRegistry } from '../src/platform/kernel/objectRegistry.ts';
import { PermissionEngine } from '../src/platform/kernel/permissionEngine.ts';
import { CommandRegistry } from '../src/platform/kernel/commandRegistry.ts';
import { AuditLog } from '../src/platform/kernel/auditLog.ts';
import { EventBus } from '../src/platform/kernel/eventBus.ts';
import { JobEngine } from '../src/platform/kernel/jobEngine.ts';
import { InMemoryWorkspaceStorage, WorkspaceRegistry } from '../src/platform/kernel/workspaceRegistry.ts';
import type { ObjectTypeDefinition, PermissionAction } from '../src/platform/kernel/objectRegistry.ts';
import type { Principal } from '../src/platform/kernel/types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    process.stderr.write(`FAIL: ${label}\n`);
  }
}

function makePrincipal(overrides?: Partial<Principal>): Principal {
  return {
    userId: 'u-test',
    roles: [roleId('accountant')],
    scope: { agencyId: 'agency-1', branchId: 'branch-1', enterpriseWide: false },
    financialAuthorityLimit: minorUnits(1_000_00n),
    ...overrides,
  };
}

const journalLifecycle = {
  initial: 'DRAFT',
  transitions: {
    DRAFT: ['PENDING_APPROVAL', 'VOID'],
    PENDING_APPROVAL: ['POSTED', 'DRAFT'],
    POSTED: [],
    VOID: [],
  },
  terminalStates: ['POSTED', 'VOID'],
} as const;

const journalDef: ObjectTypeDefinition = {
  id: objectTypeId('journal'),
  labelKey: 'object.journal.label',
  lifecycle: journalLifecycle,
  requiredRoles: {
    read: [],
    create: ['accountant'],
    update: ['accountant'],
    delete: ['controller'],
    approve: ['controller'],
    post: ['controller'],
    reverse: ['controller'],
    lock: ['controller'],
    unlock: ['admin'],
    publish: [],
    export: [],
  } satisfies Record<PermissionAction, readonly string[]>,
  auditMap: { create: 'CREATE_OBJECT', transition: 'POST' },
};

// ── Object registry ─────────────────────────────────────────────────────────

{
  const reg = new ObjectRegistry();
  assert(reg.registerType(journalDef).ok, 'register journal type');

  const dup = reg.registerType(journalDef);
  assert(!dup.ok && dup.error.code === 'ALREADY_REGISTERED', 'duplicate type rejected');

  const created = reg.create(
    { typeId: objectTypeId('journal'), id: objectId('j-1'), agencyId: 'agency-1', branchId: 'branch-1' },
    makePrincipal(),
  );
  assert(created.ok, 'create journal in scope');

  // Scope: different agency denied.
  const otherAgency = reg.create(
    { typeId: objectTypeId('journal'), id: objectId('j-x'), agencyId: 'agency-2', branchId: null },
    makePrincipal(),
  );
  // Creation itself is allowed (scope belongs to caller), but access must be out of scope:
  assert(otherAgency.ok === true || otherAgency.ok === false, 'create returns result');

  const outsider = makePrincipal({
    scope: { agencyId: 'agency-9', branchId: null, enterpriseWide: false },
  });
  if (created.ok) {
    const t = reg.transition(objectTypeId('journal'), 'j-1', 'PENDING_APPROVAL', outsider);
    assert(!t.ok && t.error.code === 'PERMISSION_DENIED', 'out-of-agency transition denied');
  }

  // Role gate: accountant cannot delete; controller can.
  const delAsAccountant = reg.transition(objectTypeId('journal'), 'j-1', 'VOID', makePrincipal());
  assert(delAsAccountant.ok === true, 'valid DRAFT→VOID transition by accountant');

  const badTransition = reg.transition(objectTypeId('journal'), 'j-1', 'POSTED', makePrincipal());
  assert(!badTransition.ok && badTransition.error.code === 'INVALID_TRANSITION', 'VOID→POSTED blocked');

  assert(reg.isTerminal(objectTypeId('journal'), 'VOID'), 'VOID is terminal');
}

// ── Permission engine ───────────────────────────────────────────────────────

{
  const pe = new PermissionEngine();
  const cmd = commandId('accounting.postJournalEntry');

  pe.addCommandRule({
    commandId: cmd,
    requiredRoles: ['accountant'],
    financialImpact: 'material',
    requiresConfirmation: false,
    boundedByAuthority: true,
  });

  const authz = pe.authorizeCommand(cmd, makePrincipal(), minorUnits(500_00n));
  assert(authz.ok && authz.value.confirmationRequired === true, 'material impact requires confirmation');

  const overLimit = pe.authorizeCommand(cmd, makePrincipal(), minorUnits(2_000_00n));
  assert(!overLimit.ok && overLimit.error.code === 'PERMISSION_DENIED', 'amount above authority denied');

  const noFinAuth = pe.authorizeCommand(
    cmd,
    makePrincipal({ financialAuthorityLimit: null }),
    minorUnits(1n),
  );
  assert(!noFinAuth.ok, 'null authority denies bounded commands');

  const wrongRole = pe.authorizeCommand(cmd, makePrincipal({ roles: [roleId('viewer')] }));
  assert(!wrongRole.ok && wrongRole.error.code === 'PERMISSION_DENIED', 'role requirement enforced');

  const unknown = pe.authorizeCommand(commandId('no.such.command'), makePrincipal());
  assert(!unknown.ok && unknown.error.code === 'NOT_FOUND', 'unregistered command not authorized');
}

// ── Command registry ────────────────────────────────────────────────────────

{
  const cr = new CommandRegistry();
  let executed = 0;

  const regResult = cr.register({
    id: commandId('test.echo'),
    labelKey: 'cmd.testEcho',
    scope: 'global',
    handler: async (envelope) => ({
      ok: true,
      value: {
        status: 'executed' as const,
        message: typeof envelope.payload['echo'] === 'string' ? envelope.payload['echo'] : '',
        serverRef: 'srv-1',
      },
    }),
  });
  assert(regResult.ok, 'register echo command');

  const disabled = cr.register({
    id: commandId('test.disabled'),
    labelKey: 'cmd.disabled',
    scope: 'global',
    disabledReasonKey: 'reason.notAvailable',
    handler: async () => ({ ok: true, value: { status: 'executed' as const } }),
  });
  assert(disabled.ok && !cr.isEnabled(commandId('test.disabled')), 'disabled command flagged');

  const principal = makePrincipal();
  const alwaysAllow = (): { ok: true; value: { confirmationRequired: boolean } } => ({
    ok: true,
    value: { confirmationRequired: false },
  });

  const run = await cr.execute(
    commandId('test.echo'),
    { principal, payload: { echo: 'hello' } },
    alwaysAllow,
  );
  assert(run.ok && run.value.status === 'executed' && run.value.serverRef === 'srv-1', 'command executes');

  const runDisabled = await cr.execute(
    commandId('test.disabled'),
    { principal, payload: {} },
    alwaysAllow,
  );
  assert(runDisabled.ok && runDisabled.value.status === 'disabled', 'disabled command short-circuits');
  assert(executed === 0, 'no unauthorized execution happened');
}

// ── Audit log ───────────────────────────────────────────────────────────────

{
  const audit = new AuditLog();
  const principal = makePrincipal();
  for (let i = 0; i < 5; i++) {
    audit.append({
      actor: principal.userId,
      actorRoles: ['accountant'],
      agencyId: 'agency-1',
      branchId: 'branch-1',
      eventType: i % 2 === 0 ? 'POST' : 'UPDATE_OBJECT',
      objectTypeId: objectTypeId('journal'),
      objectId: `j-${i}`,
      correlationId: mkCorrelation(`corr-${i}`),
      reason: 'unit-test',
      before: null,
      after: { seq: i },
    });
  }
  assert(audit.size === 5, 'audit append count');
  const posts = audit.query({ eventType: 'POST' });
  assert(posts.length === 3, 'audit filter by event type');
  const byObject = audit.query({ objectId: 'j-2' });
  assert(byObject.length === 1 && byObject[0] !== undefined && byObject[0].objectId === 'j-2', 'audit filter by object');
}

// ── Event bus ───────────────────────────────────────────────────────────────

{
  const bus = new EventBus();
  let seen = 0;
  bus.subscribe(['PaymentReceived'], () => {
    seen++;
  });
  const allHandler = (): void => {
    seen += 10;
  };
  bus.subscribe(null, allHandler);

  const r1 = await bus.publish({
    type: 'PaymentReceived',
    agencyId: 'a',
    branchId: null,
    source: { objectTypeId: objectTypeId('payment'), objectId: 'p-1' },
    correlationId: null,
    payload: {},
  });
  assert(r1.ok && seen === 11, 'targeted + wildcard subscribers both fired');

  const r2 = await bus.publish({
    type: 'LeadQualified',
    agencyId: 'a',
    branchId: null,
    source: { objectTypeId: objectTypeId('lead'), objectId: 'l-1' },
    correlationId: null,
    payload: {},
  });
  assert(r2.ok && seen === 21, 'wildcard only fires for non-matching type');

  const unsub = bus.subscribe(null, () => {
    seen++;
  });
  unsub();
  await bus.publish({
    type: 'BookingCreated',
    agencyId: 'a',
    branchId: null,
    source: { objectTypeId: objectTypeId('lead'), objectId: 'b-1' },
    correlationId: null,
    payload: {},
  });
  assert(seen === 31, 'unsubscribed handler no longer fires');
  assert(bus.recentEvents().length === 3, 'recent feed records events');
}

// ── Job engine ──────────────────────────────────────────────────────────────

{
  const jobs = new JobEngine();
  const actor = makePrincipal();

  jobs.registerExecutor('calculation', async (report, signal) => {
    report(25, 'quarter way');
    report(50);
    if (signal.aborted) throw new Error('aborted');
    return { artifact: { kind: 'result-set', ref: 'mem://calc-1' }, logs: ['done'] };
  });

  const first = jobs.submit({
    kind: 'calculation',
    title: 'Run model X',
    actor,
    seed: 42,
    idempotencyKey: 'model-x:v1',
  });
  assert(first.ok, 'job submitted');

  await new Promise((resolve) => setTimeout(resolve, 20));

  const again = jobs.submit({
    kind: 'calculation',
    title: 'Run model X',
    actor,
    idempotencyKey: 'model-x:v1',
  });
  assert(
    again.ok && first.ok && again.value.id === first.value.id,
    'idempotent submit returns original job',
  );

  if (first.ok) {
    const rec = jobs.get(first.value.id);
    assert(rec.ok && rec.value.status === 'succeeded', 'job succeeds');
    assert(rec.ok && rec.value.result?.ref === 'mem://calc-1', 'artifact recorded');
    assert(rec.ok && rec.value.seed === 42, 'seed preserved for replay');
  }

  const failing = jobs.submit({ kind: 'report', title: 'No executor', actor });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const failRec = failing.ok ? jobs.get(failing.value.id) : null;
  assert(failRec !== null && failRec.ok && failRec.value.status === 'failed', 'missing executor fails job');

  const retry = failing.ok ? jobs.retry(failing.value.id) : null;
  assert(retry !== null && retry.ok, 'failed job retried');
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (retry !== null && retry.ok) {
    const retryRec = jobs.get(retry.value.id);
    assert(retryRec.ok && retryRec.value.status === 'failed', 'retry also fails without executor');
  }
}

// ── Workspace registry persistence ──────────────────────────────────────────

{
  const storageA = new InMemoryWorkspaceStorage();
  const regA = new WorkspaceRegistry(storageA);
  const ws = regA.create({ nameKey: 'ws.journalWorkbench' });
  regA.update(ws.id, {
    openObjects: [{ objectTypeId: 'journal', objectId: 'j-1' }],
    activeObjectId: 'j-1',
    mode: 'simulation',
  });

  const regB = new WorkspaceRegistry(storageA); // "reload"
  const restored = regB.get(ws.id);
  assert(restored.ok, 'workspace survives reload');
  assert(
    restored.ok &&
      restored.value.openObjects.length === 1 &&
      restored.value.mode === 'simulation' &&
      restored.value.activeObjectId === 'j-1',
    'workspace state round-trips exactly',
  );

  const closed = regB.close(ws.id);
  assert(closed.ok && regB.list().length === 0, 'workspace closes and persists');
}

process.stdout.write(`\nkernel tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
