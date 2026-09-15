import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3Service } from 'src/common/services/s3.service';
import { ANALYTICS_QUEUE, EXAM_FINALIZE_QUEUE } from './exam.constants';
import { examKeys } from './exam-keys.logic';
import { ExamPaperService } from './exam-paper.service';
import { ExamAttemptsService } from './exam-attempts.service';
import { ExamResolver } from './exam.resolver';
import { ExamStreamService } from './exam-stream.service';
import { ExamIngestController } from './exam-ingest.controller';
import { ExamIngestWorker } from './exam-ingest.worker';
import { ExamFinalizeQueue } from './exam-finalize.queue';
import { ExamFinalizeProcessor } from './exam-finalize.processor';
import { AnalyticsComputeService } from './analytics-compute.service';
import { AnalyticsQueue } from './analytics.queue';
import { AnalyticsProcessor } from './analytics.processor';
import { ExamResultService } from './exam-result.service';

// Same inline Redis connection pattern as the question import queue.
@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueueAsync({
      name: EXAM_FINALIZE_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        // Keeps this environment's jobs apart from any other on the same Redis.
        prefix: examKeys(config.get<string>('REDIS_PREFIX')).bullPrefix,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 7 * 86400 },
        },
      }),
    }),
    BullModule.registerQueueAsync({
      name: ANALYTICS_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        // Keeps this environment's jobs apart from any other on the same Redis.
        prefix: examKeys(config.get<string>('REDIS_PREFIX')).bullPrefix,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 7 * 86400 },
        },
      }),
    }),
  ],
  controllers: [ExamIngestController],
  providers: [
    ExamPaperService,
    ExamAttemptsService,
    ExamResolver,
    ExamStreamService,
    ExamIngestWorker,
    ExamFinalizeQueue,
    ExamFinalizeProcessor,
    AnalyticsComputeService,
    AnalyticsQueue,
    AnalyticsProcessor,
    ExamResultService,
    S3Service,
  ],
})
export class ExamModule {}
