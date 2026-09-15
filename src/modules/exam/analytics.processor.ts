import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AnalyticsComputeService } from './analytics-compute.service';
import { AnalyticsQueue } from './analytics.queue';
import {
  ANALYTICS_COMPUTE_JOB,
  ANALYTICS_QUEUE,
  ANALYTICS_SWEEP_JOB,
} from './exam.constants';

/**
 * Runs the per-test aggregation. Concurrency is low on purpose: each job is a
 * few large SQL statements, so the database, not the worker, is the limit.
 */
@Processor(ANALYTICS_QUEUE, { concurrency: 2 })
export class AnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(
    private readonly analytics: AnalyticsComputeService,
    private readonly queue: AnalyticsQueue,
  ) {
    super();
  }

  async process(job: Job<{ testId?: string }>): Promise<void> {
    if (job.name === ANALYTICS_SWEEP_JOB) {
      const stale = await this.analytics.staleTests();
      for (const testId of stale) await this.queue.schedule(testId, 0);
      if (stale.length)
        this.logger.log(`Analytics sweep queued ${stale.length} test(s)`);
      return;
    }
    if (job.name === ANALYTICS_COMPUTE_JOB && job.data.testId)
      await this.analytics.compute(job.data.testId);
  }
}
