/**
 * Job Engine (spec §7, §34, §66) — long-running operations with progress,
 * retries, cancellation and result artifacts. Deterministic job types
 * (calculation/simulation) record their parameters so replays are reproducible.
 */

import type { JobId, KernelError, Principal, Result } from './types.ts';
import { err, ok } from './types.ts';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type JobKind =
  | 'calculation'
  | 'simulation'
  | 'optimization'
  | 'reconciliation'
  | 'import'
  | 'report'
  | 'ai_task';

export interface JobArtifact {
  readonly kind: string;
  /** Reference to a stored artifact (server object or blob path). */
  readonly ref: string;
}

export interface JobRecord {
  readonly id: JobId;
  readonly kind: JobKind;
  readonly title: string;
  readonly status: JobStatus;
  /** 0..100 while running; frozen afterwards. */
  readonly progress: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly actor: Principal['userId'];
  /** Deterministic seed/version for replayable jobs (§66). */
  readonly seed: number | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly logs: readonly string[];
  readonly result: JobArtifact | null;
  readonly error: KernelError | null;
  /** Idempotency key — submitting the same key twice returns the first job. */
  readonly idempotencyKey: string | null;
}

export type JobExecutor = (
  report: (progress: number, message?: string) => void,
  signal: AbortSignal,
) => Promise<{ artifact: JobArtifact | null; logs?: readonly string[] }>;

/** Internal mutable form of a job record (JobRecord fields are externally readonly). */
interface MutableJob {
  id: JobId;
  kind: JobKind;
  title: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  actor: string;
  seed: number | null;
  parameters: Record<string, unknown>;
  logs: string[];
  result: JobArtifact | null;
  error: KernelError | null;
  idempotencyKey: string | null;
}

const JOB_ERR = 'JOB_ENGINE' as const;

export class JobEngine {
  private seq = 0;
  private readonly jobs = new Map<string, MutableJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly executors = new Map<JobKind, JobExecutor>();
  private readonly idempotency = new Map<string, JobId>();

  registerExecutor(kind: JobKind, executor: JobExecutor): void {
    this.executors.set(kind, executor);
  }

  /**
   * Submit a job. Safe to call repeatedly with the same idempotencyKey:
   * the original job is returned unchanged.
   */
  submit(input: {
    kind: JobKind;
    title: string;
    actor: Principal;
    parameters?: Readonly<Record<string, unknown>>;
    seed?: number;
    idempotencyKey?: string;
  }): Result<JobRecord, KernelError> {
    if (input.idempotencyKey !== undefined) {
      const existing = this.idempotency.get(input.idempotencyKey);
      if (existing !== undefined) {
        const job = this.jobs.get(existing);
        if (job) return ok(job);
      }
    }
    const id: JobId = `job-${(++this.seq).toString(36)}-${Date.now().toString(36)}` as JobId;
    const now = new Date().toISOString();
    const job: MutableJob = {
      id,
      kind: input.kind,
      title: input.title,
      status: 'queued',
      progress: 0,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      actor: input.actor.userId,
      seed: input.seed ?? null,
      parameters: input.parameters ?? {},
      logs: [],
      result: null,
      error: null,
      idempotencyKey: input.idempotencyKey ?? null,
    };
    this.jobs.set(id, job);
    if (input.idempotencyKey !== undefined) {
      this.idempotency.set(input.idempotencyKey, id);
    }
    // Fire-and-forget execution; state transitions are recorded synchronously.
    void this.run(job);
    return ok(snapshot(job));
  }

  get(id: JobId): Result<JobRecord, KernelError> {
    const job = this.jobs.get(id);
    if (!job) return err({ code: 'NOT_FOUND', message: `Unknown job: ${id}`, details: { domain: JOB_ERR } });
    return ok(snapshot(job));
  }

  list(): readonly JobRecord[] {
    return [...this.jobs.values()].map(snapshot);
  }

  cancel(id: JobId): Result<JobRecord, KernelError> {
    const job = this.jobs.get(id);
    if (!job) return err({ code: 'NOT_FOUND', message: `Unknown job: ${id}`, details: { domain: JOB_ERR } });
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return ok(snapshot(job)); // already terminal — idempotent
    }
    this.controllers.get(id)?.abort();
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    return ok(snapshot(job));
  }

  /** Retry a failed job with identical parameters; safe jobs only (§34). */
  retry(id: JobId): Result<JobRecord, KernelError> {
    const prior = this.jobs.get(id);
    if (!prior) return err({ code: 'NOT_FOUND', message: `Unknown job: ${id}`, details: { domain: JOB_ERR } });
    if (prior.status !== 'failed') {
      return err({ code: 'CONFLICT', message: 'Only failed jobs can be retried', details: { domain: JOB_ERR } });
    }
    return this.submit({
      kind: prior.kind,
      title: prior.title,
      actor: { userId: prior.actor, roles: [], scope: { agencyId: '', branchId: null, enterpriseWide: false }, financialAuthorityLimit: null },
      parameters: prior.parameters,
      seed: prior.seed ?? undefined,
      idempotencyKey: undefined,
    });
  }

  private async run(job: MutableJob): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.status = 'running';
    job.startedAt = new Date().toISOString();

    const executor = this.executors.get(job.kind);
    if (!executor) {
      job.status = 'failed';
      job.error = { code: 'VALIDATION_FAILED', message: `No executor registered for ${job.kind}`, details: { domain: JOB_ERR } };
      job.finishedAt = new Date().toISOString();
      return;
    }

    try {
      const outcome = await executor(
        (progress, message) => {
          job.progress = Math.max(0, Math.min(100, progress));
          if (message !== undefined) job.logs.push(`[${new Date().toISOString()}] ${message}`);
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        job.status = 'cancelled';
      } else {
        job.status = 'succeeded';
        job.result = outcome.artifact;
        if (outcome.logs !== undefined) job.logs.push(...outcome.logs);
      }
    } catch (cause) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = {
        code: 'VALIDATION_FAILED',
        message: String(cause),
        details: { domain: JOB_ERR },
      };
    } finally {
      if (job.finishedAt === null) job.finishedAt = new Date().toISOString();
      this.controllers.delete(job.id);
    }
  }
}

function snapshot(job: MutableJob): JobRecord {
  return { ...job, logs: [...job.logs] };
}
