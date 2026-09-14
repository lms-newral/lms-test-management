import { Logger, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/common/decorators/permissions.decorators';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { type AuthenticatedUser } from 'src/common/interfaces/auth.interface';

import { QuestionImportService } from './question-import.service';
import { QuestionImportQueue } from './question-import.queue';
import {
  BulkAssignImportRowsInput,
  CreateQuestionImportJobInput,
  QuestionImportJobEntity,
  QuestionImportRowEntity,
  QuestionImportUploadEntity,
  UpdateQuestionImportRowInput,
} from './question-import.dto';

/**
 * Word import, two-phase.
 *
 * The flow a client follows:
 *
 *   createQuestionImportJob  -> job + presigned PUT
 *   (client PUTs the .docx straight to S3)
 *   startQuestionImport      -> queues the parse, returns immediately
 *   questionImportJob        -> poll until AWAITING_REVIEW or FAILED
 *   questionImportRows       -> review, fix, drop
 *   commitQuestionImport     -> writes the bank questions
 *
 * Reads need QUESTION_BANK_VIEW, row edits need QUESTION_BANK_REVIEW, and
 * creating or committing a job needs QUESTION_BANK_CREATE -- committing is
 * what actually writes questions, so it is gated as authoring, not review.
 */
@Resolver()
@UseGuards(GqlAuthGuard)
export class QuestionImportResolver {
  private readonly logger = new Logger(QuestionImportResolver.name);

  constructor(
    private readonly imports: QuestionImportService,
    private readonly queue: QuestionImportQueue,
  ) {}

  // ─── Jobs ──────────────────────────────────────────────────────────────────

  @Mutation(() => QuestionImportUploadEntity, {
    description:
      'Creates an import job and returns a presigned PUT for the .docx. ' +
      'Upload the file, then call startQuestionImport.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CREATE)
  async createQuestionImportJob(
    @Args('input') input: CreateQuestionImportJobInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportUploadEntity> {
    const { job, upload } = await this.imports.createJob(
      input.fileName,
      input.questionBankId,
      user.userId,
      user.tenantId,
    );

    return {
      job: job as QuestionImportJobEntity,
      uploadUrl: upload.uploadUrl,
      key: upload.key,
      expiresIn: upload.expiresIn,
    };
  }

  @Mutation(() => QuestionImportJobEntity, {
    description:
      'Queues the parse. Returns at once -- poll questionImportJob for the ' +
      'result, which is AWAITING_REVIEW on success and FAILED with a reason ' +
      'on failure.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CREATE)
  async startQuestionImport(
    @Args('jobId', { type: () => ID }) jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportJobEntity> {
    const job = await this.imports.findJob(jobId, user.tenantId);
    await this.queue.enqueueParse({ jobId, tenantId: user.tenantId });
    return job as QuestionImportJobEntity;
  }

  @Query(() => QuestionImportJobEntity)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async questionImportJob(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportJobEntity> {
    return (await this.imports.findJob(id, user.tenantId)) as QuestionImportJobEntity;
  }

  @Query(() => [QuestionImportJobEntity])
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async questionImportJobs(
    @CurrentUser() user: AuthenticatedUser,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<QuestionImportJobEntity[]> {
    return (await this.imports.listJobs(
      user.tenantId,
      limit ?? 20,
    )) as QuestionImportJobEntity[];
  }

  // ─── Review ────────────────────────────────────────────────────────────────

  @Query(() => [QuestionImportRowEntity], {
    description:
      'Staged rows for one job. Filter by severity to show BLOCKING first.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async questionImportRows(
    @Args('jobId', { type: () => ID }) jobId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Args('severity', { nullable: true }) severity?: string,
    @Args('includeDropped', { nullable: true }) includeDropped?: boolean,
  ): Promise<QuestionImportRowEntity[]> {
    const rows = await this.imports.listRows(
      jobId,
      user.tenantId,
      severity as 'OK' | 'WARNING' | 'BLOCKING' | undefined,
      includeDropped ?? false,
    );
    return rows as unknown as QuestionImportRowEntity[];
  }

  @Mutation(() => QuestionImportRowEntity, {
    description:
      'Corrects one staged row and re-runs its checks, so fixing a BLOCKING ' +
      'row clears it without a re-parse.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_REVIEW)
  async updateQuestionImportRow(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateQuestionImportRowInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportRowEntity> {
    const row = await this.imports.updateRow(id, input, user.tenantId);
    return row as unknown as QuestionImportRowEntity;
  }

  @Mutation(() => QuestionImportRowEntity, {
    description: 'Leaves a row out of the commit, or puts it back in.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_REVIEW)
  async dropQuestionImportRow(
    @Args('id', { type: () => ID }) id: string,
    @Args('dropped') dropped: boolean,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportRowEntity> {
    const row = await this.imports.dropRow(id, dropped, user.tenantId);
    return row as unknown as QuestionImportRowEntity;
  }

  @Mutation(() => Int, {
    description:
      'Applies one taxonomy/type/difficulty choice to many rows and returns ' +
      'how many were changed. This is the fix for a single mis-spelled header ' +
      'breaking fifty rows identically.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_REVIEW)
  async bulkAssignImportRows(
    @Args('input') input: BulkAssignImportRowsInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<number> {
    const { jobId, rowIds, ...patch } = input;
    return this.imports.bulkAssign(jobId, rowIds, patch, user.tenantId);
  }

  // ─── Commit ────────────────────────────────────────────────────────────────

  @Mutation(() => QuestionImportJobEntity, {
    description:
      'Writes every reviewed row into the bank. Refused while any row is ' +
      'still BLOCKING -- fix or drop those first.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CREATE)
  async commitQuestionImport(
    @Args('jobId', { type: () => ID }) jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportJobEntity> {
    return (await this.imports.commit(
      jobId,
      user.userId,
      user.tenantId,
    )) as QuestionImportJobEntity;
  }
}
