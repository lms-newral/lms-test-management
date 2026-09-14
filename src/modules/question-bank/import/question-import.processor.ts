import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QuestionImportService } from './question-import.service';

export const QUESTION_IMPORT_QUEUE = 'question-import';
export const PARSE_JOB = 'parse-docx';

export interface ParseJobData {
  jobId: string;
  tenantId: string;
}

/**
 * Runs the parse off the request thread.
 *
 * The quiz importer does this work synchronously inside the GraphQL resolver
 * and returns a `processingTime`. That is survivable for a 30-question quiz and
 * not for a 500-question bank import: pandoc, a LibreOffice round trip per
 * legacy image and an S3 upload each add up, and an HTTP request that takes
 * four minutes will be cut off by something in between long before it finishes.
 *
 * `attempts: 1` deliberately. `parseJob` is not idempotent in the cheap sense --
 * it deletes and re-stages the job's rows -- and a retry after a partial failure
 * would silently discard a reviewer's in-progress corrections. A failed parse is
 * re-run explicitly by a human instead.
 */
@Processor(QUESTION_IMPORT_QUEUE)
export class QuestionImportProcessor extends WorkerHost {
  private readonly logger = new Logger(QuestionImportProcessor.name);

  constructor(private readonly imports: QuestionImportService) {
    super();
  }

  async process(job: Job<ParseJobData, void, string>): Promise<void> {
    if (job.name !== PARSE_JOB) {
      this.logger.warn(`Ignoring unknown job: ${job.name}`);
      return;
    }

    const { jobId, tenantId } = job.data;
    this.logger.log(`Parsing import ${jobId}`);

    // parseJob records its own failures against the job row, so anything that
    // escapes here is a bug rather than a bad document. Let it surface.
    await this.imports.parseJob(jobId, tenantId);
  }
}
