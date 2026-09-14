import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { S3Service } from 'src/common/services/s3.service';
import { QuestionImportService } from './question-import.service';
import { QuestionImportResolver } from './question-import.resolver';
import { QuestionImportQueue } from './question-import.queue';
import {
  QUESTION_IMPORT_QUEUE,
  QuestionImportProcessor,
} from './question-import.processor';
import { LibreOfficeClient } from './libreoffice.client';
import { QuestionBankModule } from '../question-bank.module';

/**
 * There is no `BullModule.forRoot` in this codebase -- every module registers
 * its own queue with an inline Redis connection. Following that rather than
 * introducing a root registration, which would change how five other modules
 * resolve their connection.
 *
 * `attempts: 1`: see the comment on QuestionImportProcessor. A parse re-stages
 * the job's rows, so an automatic retry could discard a reviewer's corrections.
 */
@Module({
  imports: [
    ConfigModule,
    // One direction only: this module depends on the bank (it commits through
    // BankQuestionsService), the bank does not depend on the importer. Wiring
    // it the other way round would need a forwardRef for no benefit.
    QuestionBankModule,
    BullModule.registerQueueAsync({
      name: QUESTION_IMPORT_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      }),
    }),
  ],
  providers: [
    QuestionImportService,
    QuestionImportResolver,
    QuestionImportQueue,
    QuestionImportProcessor,
    LibreOfficeClient,
    S3Service,
  ],
  exports: [QuestionImportService],
})
export class QuestionImportModule {}
