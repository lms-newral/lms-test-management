import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExamAttemptStatus, Prisma } from '@prisma/client';
import { hostname } from 'os';
import type Redis from 'ioredis';
import { PrismaService } from 'src/prisma/prisma.service';
import { acceptBatch, deadLetterFields, entryAction, type ChainedEvent } from './attempt-ingest.logic';
import { recordViolation } from './attempt-proctor.logic';
import { EVENT_SKEW_MS } from './exam.constants';
import { ExamFinalizeQueue } from './exam-finalize.queue';
import { ExamStreamService, type Rejection } from './exam-stream.service';

type StreamEntry = { id: string; attemptId: string; events: ChainedEvent[] };

/** Keeps the contiguous run of events after lastSeq, so one missing batch does not block the rest. */
function contiguousFrom(lastSeq: number, events: ChainedEvent[]): ChainedEvent[] {
  const bySeq = new Map<number, ChainedEvent>();
  for (const e of events) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  const out = [...bySeq.values()].filter((e) => e.seq <= lastSeq);
  for (let s = lastSeq + 1; bySeq.has(s); s++) out.push(bySeq.get(s)!);
  return out;
}

/**
 * Drains the event streams into Postgres in bulk. Per read: one query for the
 * attempts, one transaction that inserts every accepted batch and moves each
 * attempt's seq/chain head (optimistically, so two workers can never both apply
 * the same seq), then the stored seq goes back to Redis and entries are acked.
 * Unacked entries are re-claimed after 30 s, so a crashed worker loses nothing.
 */
@Injectable()
export class ExamIngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExamIngestWorker.name);
  private readonly enabled: boolean;
  private readonly consumer = `${hostname()}-${process.pid}`;
  private readonly connections: Redis[] = [];
  private running = false;
  private deadLettered = 0;

  /** This environment's consumer group; a prefix keeps two deployments apart. */
  private get group() {
    return this.stream.keys.group;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: ExamStreamService,
    private readonly finalizeQueue: ExamFinalizeQueue,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('EXAM_INGEST_WORKER', 'true') !== 'false';
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.running = true;
    for (let shard = 0; shard < this.stream.shards; shard++) void this.loop(shard);
  }

  onModuleDestroy() {
    this.running = false;
    for (const c of this.connections) c.disconnect();
  }

  private async loop(shard: number) {
    const redis = this.stream.connection();
    this.connections.push(redis);
    const key = this.stream.streamKey(shard);
    await redis.xgroup('CREATE', key, this.group, '0', 'MKSTREAM').catch((e: Error) => {
      if (!e.message.includes('BUSYGROUP')) this.logger.error(`Stream group for ${key}: ${e.message}`);
    });
    let lastClaim = 0;
    let lastTrim = 0;

    while (this.running) {
      try {
        if (Date.now() - lastTrim > 300_000) {
          lastTrim = Date.now();
          await this.trimProcessed(redis, key);
        }
        if (Date.now() - lastClaim > 30_000) {
          lastClaim = Date.now();
          const claimed = (await redis.xautoclaim(key, this.group, this.consumer, 30_000, '0-0', 'COUNT', 500)) as [string, [string, string[]][]];
          const stale = this.parse(claimed[1]);
          if (stale.length) await this.process(redis, key, stale);
        }
        const read = (await redis.xreadgroup('GROUP', this.group, this.consumer, 'COUNT', 500, 'BLOCK', 2000, 'STREAMS', key, '>')) as
          | [string, [string, string[]][]][]
          | null;
        const entries = read ? this.parse(read[0][1]) : [];
        if (entries.length) await this.process(redis, key, entries);
      } catch (e) {
        if (!this.running) break;
        this.logger.error(`Ingest loop ${key}: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  /**
   * Removes entries that were delivered and acknowledged but not deleted (a crash
   * between ack and delete). Keeps everything from the oldest unacknowledged
   * entry, and everything not yet delivered, so no unprocessed event is touched.
   */
  private async trimProcessed(redis: Redis, key: string) {
    const groups = (await redis.xinfo('GROUPS', key).catch(() => [])) as unknown[][];
    const group = groups
      .map((g) => {
        const fields: Record<string, unknown> = {};
        for (let i = 0; i < g.length; i += 2) fields[String(g[i])] = g[i + 1];
        return fields;
      })
      .find((g) => g.name === this.group);
    if (!group) return;
    const pending = (await redis.xpending(key, this.group)) as [number, string | null, string | null, unknown];
    const [ms, seq] = String(group['last-delivered-id'] ?? '0-0').split('-');
    const afterDelivered = `${ms}-${Number(seq) + 1}`;
    const keepFrom = pending[0] > 0 && pending[1] ? pending[1] : afterDelivered;
    await redis.xtrim(key, 'MINID', keepFrom);
  }

  private parse(raw: [string, string[]][]): StreamEntry[] {
    return raw
      .filter(([, fields]) => Array.isArray(fields))
      .map(([id, fields]) => {
        const map: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
        let events: ChainedEvent[] = [];
        try {
          events = JSON.parse(map.e ?? '[]') as ChainedEvent[];
        } catch {
          events = [];
        }
        return { id, attemptId: map.a, events };
      });
  }

  private async process(redis: Redis, key: string, entries: StreamEntry[]) {
    const byAttempt = new Map<string, StreamEntry[]>();
    for (const entry of entries) byAttempt.set(entry.attemptId, [...(byAttempt.get(entry.attemptId) ?? []), entry]);

    const attempts = await this.prisma.examAttempt.findMany({ where: { id: { in: [...byAttempt.keys()] } } });
    const found = new Map(attempts.map((a) => [a.id, a]));

    const batches: Prisma.ExamEventBatchCreateManyInput[] = [];
    const updates: { id: string; expectedSeq: number; data: Prisma.ExamAttemptUpdateManyMutationInput }[] = [];
    const persisted: [string, number][] = [];
    const toFinalize: string[] = [];
    const ack: string[] = [];
    const rejections: [string, Rejection | null][] = [];
    const refusals: { id: string; reason: string }[] = [];

    for (const [attemptId, group] of byAttempt) {
      const attempt = found.get(attemptId);
      const ids = group.map((g) => g.id);
      if (!attempt) {
        // Not ours, or gone. Park the events where they can be replayed — never drop them.
        const { reason } = entryAction({ attemptFound: false });
        for (const entry of group) {
          await redis.xadd(this.stream.keys.deadLetter, '*', ...deadLetterFields(attemptId, reason ?? 'UNKNOWN_ATTEMPT', entry.events, Date.now()));
        }
        this.deadLettered += group.length;
        this.logger.warn(
          `Attempt ${attemptId} is not in this database: parked ${group.length} entry(s) in ${this.stream.keys.deadLetter} (${this.deadLettered} so far). ` +
            'Check that no other environment shares this Redis (REDIS_PREFIX).',
        );
        ack.push(...ids);
        continue;
      }
      const events = contiguousFrom(attempt.lastSeq, group.flatMap((g) => g.events));
      const submittedBy = (attempt.submittedBy as 'CLIENT' | 'SERVER' | null) ?? null;
      const result = acceptBatch(
        { lastSeq: attempt.lastSeq, chainHead: attempt.chainHead, submittedBy, analyticsBuilt: false },
        events,
        { allowedMs: attempt.deadline.getTime() - attempt.startedAt.getTime(), skewMs: EVENT_SKEW_MS },
      );
      ack.push(...ids);
      if (!result.ok) {
        this.logger.warn(`Attempt ${attemptId}: batch refused (${result.error}${result.expectedSeq ? `, expected ${result.expectedSeq}` : ''})`);
        persisted.push([attemptId, attempt.lastSeq]);
        rejections.push([attemptId, { error: result.error, expectedSeq: result.expectedSeq }]);
        refusals.push({ id: attemptId, reason: result.error });
        continue;
      }
      if (result.accepted.length === 0) {
        persisted.push([attemptId, attempt.lastSeq]);
        continue;
      }

      // Violations counted by the server, with the same rules the device shows.
      let proctor = { violations: attempt.violations, refreshes: attempt.refreshes, lastViolationT: attempt.lastViolationT, submitted: attempt.status === ExamAttemptStatus.SUBMITTED };
      let limitHit = false;
      for (const e of result.accepted.filter((x) => x.type === 'VIOLATION')) {
        const d = (e.data ?? {}) as { kind?: string; causedByReload?: boolean };
        const r = recordViolation(proctor, { kind: d.kind ?? 'TAB_HIDDEN', t: e.t, causedByReload: !!d.causedByReload });
        proctor = r.state;
        if (r.action.type === 'AUTO_SUBMIT') limitHit = true;
      }

      const submitEvent = result.accepted.find((e) => e.type === 'SUBMIT');
      const data: Prisma.ExamAttemptUpdateManyMutationInput = {
        lastSeq: result.state.lastSeq,
        chainHead: result.state.chainHead,
        violations: proctor.violations,
        lastViolationT: proctor.lastViolationT,
      };
      if (attempt.status === ExamAttemptStatus.IN_PROGRESS && (submitEvent || limitHit)) {
        data.status = ExamAttemptStatus.SUBMITTED;
        data.submittedAt = new Date();
        data.submittedBy = submitEvent ? 'CLIENT' : 'SERVER';
        const reason = (submitEvent?.data as { reason?: string } | null)?.reason;
        data.submitReason = submitEvent ? (reason ?? 'MANUAL') : 'VIOLATIONS';
        toFinalize.push(attemptId);
      } else if (result.flags.lateSync) {
        data.lateSync = true;
        toFinalize.push(attemptId); // re-score with the tail
      }

      batches.push({
        attemptId,
        fromSeq: result.accepted[0].seq,
        toSeq: result.accepted[result.accepted.length - 1].seq,
        events: result.accepted as unknown as Prisma.InputJsonValue,
      });
      updates.push({ id: attemptId, expectedSeq: attempt.lastSeq, data });
      persisted.push([attemptId, result.state.lastSeq]);
      rejections.push([attemptId, null]);
    }

    const conflicted = new Set<string>();
    await this.prisma.$transaction(async (tx) => {
      // Move each attempt only from the seq we read; if another worker got there first, skip it.
      for (const u of updates) {
        const moved = await tx.examAttempt.updateMany({ where: { id: u.id, lastSeq: u.expectedSeq }, data: u.data });
        if (moved.count === 0) conflicted.add(u.id);
      }
      const mine = batches.filter((b) => !conflicted.has(b.attemptId));
      if (mine.length) await tx.examEventBatch.createMany({ data: mine, skipDuplicates: true });
      for (const r of refusals) {
        await tx.examAttempt.update({ where: { id: r.id }, data: { rejectedBatches: { increment: 1 }, lastRejectReason: r.reason } });
      }
    }, { timeout: 20_000 });

    // Another worker moved these first: leave their entries for re-claim and redo.
    const conflictIds = new Set(entries.filter((e) => conflicted.has(e.attemptId)).map((e) => e.id));
    await this.stream.setPersisted(persisted.filter(([id]) => !conflicted.has(id)));
    const toAck = ack.filter((id) => !conflictIds.has(id));
    if (toAck.length) {
      await redis.xack(key, this.group, ...toAck);
      // Stored in Postgres: remove from the stream so Redis memory stays flat.
      await redis.xdel(key, ...toAck);
    }
    await this.stream.setRejections(rejections.filter(([id]) => !conflicted.has(id)));
    await this.finalizeQueue.finalize(toFinalize.filter((id) => !conflicted.has(id)));
  }
}
