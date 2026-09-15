import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EXAM_FINALIZE_QUEUE, FINALIZE_JOB, SWEEP_JOB } from './exam.constants';

@Injectable()
export class ExamFinalizeQueue implements OnModuleInit {
  private readonly logger = new Logger(ExamFinalizeQueue.name);

  constructor(@InjectQueue(EXAM_FINALIZE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // One deadline sweep a minute across all instances.
    await this.queue
      .upsertJobScheduler('exam-deadline-sweep', { every: 60_000 }, { name: SWEEP_JOB, data: {} })
      .catch((e: Error) => this.logger.warn(`Could not schedule the deadline sweep: ${e.message}`));
  }

  /** Scoring an attempt twice is harmless, so re-queues just rerun it. */
  async finalize(attemptIds: string[]) {
    if (attemptIds.length === 0) return;
    await this.queue.addBulk(
      attemptIds.map((attemptId) => ({ name: FINALIZE_JOB, data: { attemptId }, opts: { jobId: `finalize-${attemptId}-${Date.now()}` } })),
    );
  }
}
