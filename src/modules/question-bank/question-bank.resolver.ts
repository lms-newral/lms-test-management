import { Logger, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/common/decorators/permissions.decorators';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { type AuthenticatedUser } from 'src/common/interfaces/auth.interface';

import { TaxonomyService } from './taxonomy/taxonomy.service';
import { QuestionTypesService } from './config/question-types.service';
import { DifficultyService } from './config/difficulty.service';
import { BankQuestionsService } from './questions/bank-questions.service';
import { SolutionsService } from './solutions/solutions.service';
import { BankDefaultsService } from './bank-defaults.service';

import { QuestionStatus } from './question-bank.enums';
import {
  BankFacets,
  BankQuestionEntity,
  BankQuestionPage,
  DifficultyLevelEntity,
  QuestionSolutionEntity,
  PollableQuestionEntity,
  QuestionTypeDefEntity,
  TaxonomyNode,
} from './entities/question-bank.entities';
import {
  BankQuestionFilterInput,
  CreateBankQuestionInput,
  CreateDifficultyInput,
  CreateQuestionTypeInput,
  CreateTaxonomyInput,
  PaginationInput,
  UpdateBankQuestionInput,
  UpdateDifficultyInput,
  UpdateQuestionTypeInput,
  UpdateTaxonomyInput,
  UpsertSolutionInput,
} from './dto/question-bank.inputs';

/**
 * Every operation here is gated behind a QUESTION_BANK_* permission, which no
 * student role holds. That matters: BankQuestionEntity exposes `mcqOptions` and
 * `answerConfig`, i.e. the answer key. Nothing in this resolver may be reused
 * for a student-facing query without stripping those first.
 */
@Resolver()
@UseGuards(GqlAuthGuard)
export class QuestionBankResolver {
  private readonly logger = new Logger(QuestionBankResolver.name);

  constructor(
    private readonly defaults: BankDefaultsService,
    private readonly taxonomy: TaxonomyService,
    private readonly types: QuestionTypesService,
    private readonly difficulty: DifficultyService,
    private readonly questions: BankQuestionsService,
    private readonly solutions: SolutionsService,
  ) {}

  // ─── Taxonomy ──────────────────────────────────────────────────────────────

  @Query(() => [TaxonomyNode], {
    description:
      'Subject > Chapter > Topic > Subtopic tree with per-node question counts.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async taxonomyTree(
    @CurrentUser() user: AuthenticatedUser,
    @Args('includeInactive', { nullable: true }) includeInactive?: boolean,
  ): Promise<TaxonomyNode[]> {
    await this.defaults.ensureStarterKit(user.tenantId, user.userId);
    return this.taxonomy.tree(user.tenantId, includeInactive ?? false);
  }

  @Mutation(() => TaxonomyNode)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async createTaxonomy(
    @Args('input') input: CreateTaxonomyInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaxonomyNode> {
    const row = await this.taxonomy.create(input, user.userId, user.tenantId);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      code: row.code ?? undefined,
      parentId: row.parentId ?? undefined,
      orderIndex: row.orderIndex,
      isActive: row.isActive,
      questionCount: 0,
      children: [],
    };
  }

  @Mutation(() => TaxonomyNode)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async updateTaxonomy(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateTaxonomyInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaxonomyNode> {
    const row = await this.taxonomy.update(id, input, user.tenantId);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      code: row.code ?? undefined,
      parentId: row.parentId ?? undefined,
      orderIndex: row.orderIndex,
      isActive: row.isActive,
      questionCount: 0,
      children: [],
    };
  }

  @Mutation(() => Boolean, {
    description:
      'Soft-deletes the node and its descendants. Refused while questions ' +
      'still reference anything in that subtree.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async deleteTaxonomy(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<boolean> {
    return this.taxonomy.remove(id, user.userId, user.tenantId);
  }

  // ─── Question types ────────────────────────────────────────────────────────

  @Query(() => [QuestionTypeDefEntity], {
    description: 'Admin-defined question types, each bound to an AnswerKernel.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async questionTypes(
    @CurrentUser() user: AuthenticatedUser,
    @Args('includeInactive', { nullable: true }) includeInactive?: boolean,
  ): Promise<QuestionTypeDefEntity[]> {
    await this.defaults.ensureStarterKit(user.tenantId, user.userId);
    return this.types.list(user.tenantId, includeInactive ?? false);
  }

  @Mutation(() => QuestionTypeDefEntity)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async createQuestionType(
    @Args('input') input: CreateQuestionTypeInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionTypeDefEntity> {
    return this.types.create(input, user.userId, user.tenantId);
  }

  @Mutation(() => QuestionTypeDefEntity, {
    description:
      'Kernel is immutable: changing it would reinterpret the stored answers ' +
      'of every existing question of this type.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async updateQuestionType(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateQuestionTypeInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionTypeDefEntity> {
    return this.types.update(id, input, user.tenantId);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async deleteQuestionType(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<boolean> {
    return this.types.remove(id, user.userId, user.tenantId);
  }

  // ─── Difficulty levels ─────────────────────────────────────────────────────

  @Query(() => [DifficultyLevelEntity], {
    description: 'Managed difficulty list, with the aliases import matches on.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async difficultyLevels(
    @CurrentUser() user: AuthenticatedUser,
    @Args('includeInactive', { nullable: true }) includeInactive?: boolean,
  ): Promise<DifficultyLevelEntity[]> {
    await this.defaults.ensureStarterKit(user.tenantId, user.userId);
    return this.difficulty.list(user.tenantId, includeInactive ?? false);
  }

  @Mutation(() => DifficultyLevelEntity)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async createDifficultyLevel(
    @Args('input') input: CreateDifficultyInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DifficultyLevelEntity> {
    return this.difficulty.create(input, user.userId, user.tenantId);
  }

  @Mutation(() => DifficultyLevelEntity, {
    description:
      'Code is immutable — import matching and marking rules use it.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async updateDifficultyLevel(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateDifficultyInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DifficultyLevelEntity> {
    return this.difficulty.update(id, input, user.tenantId);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CONFIGURE)
  async deleteDifficultyLevel(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<boolean> {
    return this.difficulty.remove(id, user.userId, user.tenantId);
  }

  // ─── Questions ─────────────────────────────────────────────────────────────

  @Query(() => BankQuestionPage)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async bankQuestions(
    @CurrentUser() user: AuthenticatedUser,
    @Args('filter', { nullable: true }) filter?: BankQuestionFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<BankQuestionPage> {
    return this.questions.list(filter, pagination, user.tenantId);
  }

  @Query(() => BankFacets, {
    description: 'Counts for the filter sidebar, honouring the current filter.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async bankQuestionFacets(
    @CurrentUser() user: AuthenticatedUser,
    @Args('filter', { nullable: true }) filter?: BankQuestionFilterInput,
  ): Promise<BankFacets> {
    return this.questions.facets(filter, user.tenantId);
  }

  @Query(() => BankQuestionEntity)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async bankQuestion(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BankQuestionEntity> {
    return this.questions.findOne(id, user.tenantId);
  }

  @Mutation(() => BankQuestionEntity)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_CREATE)
  async createBankQuestion(
    @Args('input') input: CreateBankQuestionInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BankQuestionEntity> {
    return this.questions.create(input, user.userId, user.tenantId);
  }

  @Mutation(() => BankQuestionEntity, {
    description: 'Records the prior state as a version row before writing.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_EDIT)
  async updateBankQuestion(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateBankQuestionInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BankQuestionEntity> {
    return this.questions.update(id, input, user.userId, user.tenantId);
  }

  @Mutation(() => BankQuestionEntity)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_REVIEW)
  async setBankQuestionStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('status', { type: () => QuestionStatus }) status: QuestionStatus,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BankQuestionEntity> {
    return this.questions.setStatus(id, status, user.userId, user.tenantId);
  }

  @Mutation(() => Boolean, {
    description:
      'Soft delete. Refused while any assessment uses the question — retire ' +
      'it instead so historical results stay intact.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_DELETE)
  async deleteBankQuestion(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<boolean> {
    return this.questions.remove(id, user.userId, user.tenantId);
  }

  @Mutation(() => BankQuestionEntity)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_DELETE)
  async restoreBankQuestion(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BankQuestionEntity> {
    return this.questions.restore(id, user.tenantId);
  }

  // ─── Live polling ──────────────────────────────────────────────────────────

  @Query(() => [PollableQuestionEntity], {
    description:
      'Approved single- and multiple-choice questions, WITHOUT their answer ' +
      'key, for the live-class poll picker in the desktop app. Use this rather ' +
      'than bankQuestions anywhere the key is not being edited.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_VIEW)
  async pollableQuestions(
    @CurrentUser() user: AuthenticatedUser,
    @Args('filter', { nullable: true }) filter?: BankQuestionFilterInput,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<PollableQuestionEntity[]> {
    return this.questions.listPollable(filter, user.tenantId, limit ?? 50);
  }

  // ─── Solutions ─────────────────────────────────────────────────────────────

  @Mutation(() => QuestionSolutionEntity, {
    description:
      'Adds or updates one solution block. Visibility defaults to ' +
      'AFTER_SUBMIT and is enforced server-side.',
  })
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_EDIT)
  async upsertQuestionSolution(
    @Args('questionId', { type: () => ID }) questionId: string,
    @Args('input') input: UpsertSolutionInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionSolutionEntity> {
    return this.solutions.upsert(questionId, input, user.userId, user.tenantId);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PERMISSIONS.QUESTION_BANK_EDIT)
  async deleteQuestionSolution(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<boolean> {
    return this.solutions.remove(id, user.userId, user.tenantId);
  }
}
