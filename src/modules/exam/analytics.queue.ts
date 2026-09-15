import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ANALYTICS_COMPUTE_JOB,
  ANALYTICS_QUEUE,
  ANALYTICS_SWEEP_JOB,
} from './exam.constants';

@Injectable()
export class AnalyticsQueue implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsQueue.name);

  constructor(@InjectQueue(ANALYTICS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // Catches tests whose analytics fell behind their attempts — a missed
    // compute, a restore, or a batch that finished while nothing was listening.
    await this.queue
      .upsertJobScheduler(
        'analytics-sweep',
        { every: 300_000 },
        { name: ANALYTICS_SWEEP_JOB, data: {} },
      )
      .catch((e: Error) =>
        this.logger.warn(
          `Could not schedule the analytics sweep: ${e.message}`,
        ),
      );
  }

  /**
   * One pending compute per test: a whole hall submitting at once collapses into
   * a single run a minute later, instead of one per student.
   */
  async schedule(testId: string, delayMs = 60_000) {
    await this.queue
      .add(
        ANALYTICS_COMPUTE_JOB,
        { testId },
        {
          jobId: `analytics-${testId}`,
          delay: delayMs,
          removeOnComplete: true,
          removeOnFail: { age: 86_400 },
        },
      )
      .catch((e: Error) =>
        this.logger.warn(
          `Could not queue analytics for test ${testId}: ${e.message}`,
        ),
      );
  }
}
