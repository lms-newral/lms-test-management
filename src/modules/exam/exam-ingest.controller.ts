import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from 'src/common/decorators/public.decorator';
import { verifyAttemptToken } from './attempt-ingest.logic';
import { ExamStreamService } from './exam-stream.service';
import { EVENT_TYPES, MAX_BATCH_EVENTS } from './exam.constants';

interface IncomingEvent {
  seq: number;
  t: number;
  type: string;
  q?: string | null;
  data?: unknown;
  hash: string;
}

/**
 * The hot path during an exam. Checks the signed attempt token locally (no
 * database, no main-backend call), shapes the batch, appends it to a Redis
 * Stream and answers how far the server has stored. Ingest workers do the rest.
 * Not throttled per IP: a whole school can sit behind one address.
 */
@Public()
@SkipThrottle()
@Controller('exam/attempts')
export class ExamIngestController {
  private readonly secret: string;

  constructor(
    private readonly stream: ExamStreamService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('EXAM_TOKEN_SECRET') ?? '';
  }

  @Post(':id/events')
  @HttpCode(200)
  async ingest(
    @Param('id') attemptId: string,
    @Headers('x-attempt-token') token: string | undefined,
    @Body() body: { events?: unknown },
  ) {
    const payload = this.secret ? verifyAttemptToken(token ?? '', this.secret, Date.now()) : null;
    if (!payload || payload.attemptId !== attemptId) throw new UnauthorizedException('Invalid attempt token');

    const events = this.shape(body?.events);
    try {
      if (events.length) await this.stream.append(attemptId, events);
      return {
        receivedSeq: events.reduce((max, e) => Math.max(max, e.seq), 0),
        persistedSeq: await this.stream.persistedSeq(attemptId),
        rejected: await this.stream.rejection(attemptId),
      };
    } catch {
      // The browser keeps the events and retries.
      throw new ServiceUnavailableException('Could not accept events right now');
    }
  }

  private shape(raw: unknown): IncomingEvent[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > MAX_BATCH_EVENTS) throw new BadRequestException('events must be an array of at most 500');
    return raw.map((e, i) => {
      const x = (e ?? {}) as Record<string, unknown>;
      const dataSize = x.data === undefined ? 0 : JSON.stringify(x.data).length;
      const valid =
        Number.isInteger(x.seq) && (x.seq as number) >= 1 &&
        typeof x.t === 'number' && Number.isFinite(x.t) &&
        typeof x.type === 'string' && EVENT_TYPES.has(x.type) &&
        (x.q === undefined || x.q === null || (typeof x.q === 'string' && x.q.length <= 64)) &&
        dataSize <= 2000 &&
        typeof x.hash === 'string' && /^[0-9a-f]{64}$/.test(x.hash);
      if (!valid) throw new BadRequestException(`Invalid event at index ${i}`);
      return { seq: x.seq as number, t: x.t as number, type: x.type as string, q: (x.q as string | null | undefined) ?? null, data: x.data ?? null, hash: x.hash as string };
    });
  }
}
