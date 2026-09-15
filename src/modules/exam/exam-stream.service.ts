import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { examKeys, type ExamKeys } from './exam-keys.logic';

export interface Rejection {
  error: string;
  expectedSeq?: number;
}

/**
 * The write buffer between the event API and Postgres: one Redis Stream per
 * shard (attempts hash to a shard, so one attempt's batches stay in order), and
 * a hash of the highest seq already stored in Postgres per attempt.
 */
@Injectable()
export class ExamStreamService implements OnModuleDestroy {
  readonly shards: number;
  /** Stream, hash and group names for this environment (REDIS_PREFIX). */
  readonly keys: ExamKeys;
  private readonly redis: Redis;
  private readonly host: string;
  private readonly port: number;

  constructor(config: ConfigService) {
    this.host = config.get<string>('REDIS_HOST', 'localhost');
    this.port = Number(config.get('REDIS_PORT', 6379));
    const shards = Number(config.get('EXAM_STREAM_SHARDS', 4));
    this.shards = Number.isInteger(shards) && shards > 0 ? shards : 4;
    this.keys = examKeys(config.get<string>('REDIS_PREFIX'));
    this.redis = new Redis({ host: this.host, port: this.port, maxRetriesPerRequest: 2 });
  }

  /** A separate connection for blocking reads. */
  connection(): Redis {
    return new Redis({ host: this.host, port: this.port, maxRetriesPerRequest: null });
  }

  streamKey(shard: number) {
    return this.keys.stream(shard);
  }

  shardOf(attemptId: string) {
    let h = 2166136261;
    for (let i = 0; i < attemptId.length; i++) {
      h ^= attemptId.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % this.shards;
  }

  async append(attemptId: string, events: unknown[]) {
    await this.redis.xadd(this.streamKey(this.shardOf(attemptId)), '*', 'a', attemptId, 'e', JSON.stringify(events));
  }

  async persistedSeq(attemptId: string): Promise<number> {
    return Number((await this.redis.hget(this.keys.persisted, attemptId)) ?? 0);
  }

  async setPersisted(values: [string, number][]) {
    if (values.length === 0) return;
    await this.redis.hset(this.keys.persisted, Object.fromEntries(values));
  }

  /** Why the last batch for this attempt was refused, so the device can recover. */
  async rejection(attemptId: string): Promise<Rejection | null> {
    const raw = await this.redis.hget(this.keys.rejected, attemptId);
    return raw ? (JSON.parse(raw) as Rejection) : null;
  }

  /** Records refusals; a null clears one once a batch is accepted again. */
  async setRejections(values: [string, Rejection | null][]) {
    const set = values.filter(([, v]) => v !== null);
    const clear = values.filter(([, v]) => v === null).map(([id]) => id);
    if (set.length) await this.redis.hset(this.keys.rejected, Object.fromEntries(set.map(([id, v]) => [id, JSON.stringify(v)])));
    if (clear.length) await this.redis.hdel(this.keys.rejected, ...clear);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
