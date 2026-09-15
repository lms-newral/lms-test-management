import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
  ID,
  Int,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
import type { Request } from 'express';
import GraphQLJSON from 'graphql-type-json';
import { GqlAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/common/decorators/permissions.decorators';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { type AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import { ExamAttemptsService } from './exam-attempts.service';
import { ExamResultService } from './exam-result.service';
import { ExamSessionEntity, MyExamAttemptEntity } from './exam.entities';

/** Students taking tests. Events are uploaded over REST (exam-ingest.controller), not GraphQL. */
@Resolver()
@UseGuards(GqlAuthGuard)
export class ExamResolver {
  constructor(
    private readonly attempts: ExamAttemptsService,
    private readonly results: ExamResultService,
  ) {}

  @Query(() => MyExamAttemptEntity, { nullable: true })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  myExamAttempt(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attempts.myAttempt(nodeId, user);
  }

  @Query(() => GraphQLJSON, {
    description:
      'View solution: key, solutions and your answers. Opens once your attempt is submitted and scored.',
  })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  examReview(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attempts.review(nodeId, user);
  }

  @Query(() => GraphQLJSON, {
    description:
      'Your result and analysis. Opens at the result time set for the test.',
  })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  examResult(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.result(nodeId, user);
  }

  @Mutation(() => GraphQLJSON, {
    description: 'Save your "Points to be Noted" on a submitted test.',
  })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  saveExamNote(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @Args('note') note: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.saveNote(nodeId, note, user);
  }

  // ─── Admin: results and integrity ─────────────────────────────────────────

  @Query(() => GraphQLJSON, {
    description:
      "One student's full analysis, with the integrity panel. Admins do not wait for the result time.",
  })
  @RequirePermissions(PERMISSIONS.TEST_VIEW_RESULTS)
  studentExamResult(
    @Args('attemptId', { type: () => ID }) attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.adminResult(attemptId, user);
  }

  @Query(() => GraphQLJSON, {
    description: 'Everyone who attempted a scheduled test, best first.',
  })
  @RequirePermissions(PERMISSIONS.TEST_VIEW_ALL_ATTEMPTS)
  testAttempts(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @Args('search', { type: () => String, nullable: true })
    search: string | null,
    @Args('take', { type: () => Int, defaultValue: 50 }) take: number,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.testAttempts(nodeId, user, { search, take, skip });
  }

  @Query(() => GraphQLJSON, {
    description: "One student's attempts across a series, in schedule order.",
  })
  @RequirePermissions(PERMISSIONS.TEST_VIEW_ALL_ATTEMPTS)
  studentSeriesAttempts(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.studentSeriesAttempts(seriesId, userId, user);
  }

  @Mutation(() => ExamSessionEntity, {
    description:
      'PROCEED on the instructions page, or reopening the exam. Re-entering a running attempt counts as a refresh.',
  })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  enterExam(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Context('req') req: Request,
  ) {
    return this.attempts.enter(nodeId, user, req);
  }

  @Query(() => [GraphQLJSON], {
    description:
      'Stored events from fromSeq, to restore an attempt on a new device.',
  })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  examAttemptEvents(
    @Args('attemptId', { type: () => ID }) attemptId: string,
    @Args('fromSeq', { type: () => Int, defaultValue: 1 }) fromSeq: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attempts.committedEvents(attemptId, fromSeq, user);
  }
}
