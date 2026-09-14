import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PARSE_JOB,
  ParseJobData,
  QUESTION_IMPORT_QUEUE,
} from './question-import.processor';

/**
 * Thin wrapper so the resolver never touches BullMQ directly.
 *
 * Also the one place that decides what happens when Redis is unreachable: the
 * enqueue is reported as a failure to the caller rather than swallowed, because
 * a job stuck in PARSING that nothing will ever pick up looks identical to one
 * that is merely slow.
 */
@Injectable()
export class QuestionImportQueue {
  private readonly logger = new Logger(QuestionImportQueue.name);

  constructor(
    @InjectQueue(QUESTION_IMPORT_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueueParse(data: ParseJobData): Promise<void> {
    await this.queue.add(PARSE_JOB, data, {
      jobId: `parse:${data.jobId}`,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    });
    this.logger.log(`Queued parse for import ${data.jobId}`);
  }
}
