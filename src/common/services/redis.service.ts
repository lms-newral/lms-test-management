import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * A small shared Redis client for caches that every process should see the same
 * way — currently the session cache, which was per-process and so cost one
 * `me` call to the main backend per process a student's requests landed on.
 *
 * Every call fails soft: if Redis is unreachable the caller simply misses its
 * cache, and nothing throws. Commands are not queued while disconnected, so a
 * dead Redis cannot stall a request.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;
  private warned = false;
  /** Namespace for this environment, so two deployments never share a key. */
  readonly prefix: string;

  constructor(config: ConfigService) {
    this.prefix = (config.get<string>('REDIS_PREFIX') ?? '')
      .trim()
      .replace(/:+$/, '');
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(config.get('REDIS_PORT', 6379)),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.redis.on('error', (e: Error) => {
      if (this.warned) return;
      this.warned = true;
      this.logger.warn(
        `Redis cache unavailable, falling back to in-process caching: ${e.message}`,
      );
    });
    void this.redis.connect().catch(() => undefined);
  }

  key(...parts: string[]): string {
    return [this.prefix, ...parts].filter(Boolean).join(':');
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    if (ttlSeconds <= 0) return;
    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        Math.ceil(ttlSeconds),
      );
    } catch {
      // A cache write that fails costs a lookup next time, nothing more.
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
