import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/common/decorators/permissions.decorators';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { type AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import { TestsService } from './tests.service';
import { TestStatus } from './tests.enums';
import { CreateTestInput, UpdateTestInput } from './dto/test-management.inputs';
import {
  TestEntity,
  TestPlannerUploadEntity,
  TestSummaryEntity,
} from './entities/test-management.entities';

/**
 * Tests built on formats. Staff-only: TestEntity carries each question's answer
 * key, so reads need TEST_EDIT, which no student role holds. The tenant and user
 * always come from the session.
 */
@Resolver()
@UseGuards(GqlAuthGuard)
export class TestsResolver {
  constructor(private readonly testsService: TestsService) {}

  @Query(() => [TestSummaryEntity])
  @RequirePermissions(PERMISSIONS.TEST_VIEW, PERMISSIONS.TEST_EDIT)
  tests(
    @CurrentUser() user: AuthenticatedUser,
    @Args('status', { type: () => TestStatus, nullable: true }) status?: TestStatus,
  ) {
    return this.testsService.list(user.tenantId, status);
  }

  @Query(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_VIEW, PERMISSIONS.TEST_EDIT)
  test(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.testsService.findOne(id, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_CREATE)
  createTest(@Args('input') input: CreateTestInput, @CurrentUser() user: AuthenticatedUser) {
    return this.testsService.create(input, user.userId, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  updateTest(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateTestInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testsService.update(id, input, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  setTestSyllabus(
    @Args('testId', { type: () => ID }) testId: string,
    @Args('formatSubjectId', { type: () => ID }) formatSubjectId: string,
    @Args('syllabusHtml', { type: () => String, nullable: true }) syllabusHtml: string | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testsService.setSyllabus(testId, formatSubjectId, syllabusHtml ?? null, user.tenantId);
  }

  @Mutation(() => TestPlannerUploadEntity, {
    description: 'A presigned PUT for the planner PDF. Call setTestPlanner with the key after uploading.',
  })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  createTestPlannerUpload(
    @Args('testId', { type: () => ID }) testId: string,
    @Args('fileName') fileName: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testsService.createPlannerUpload(testId, fileName, user.tenantId);
  }

  @Mutation(() => TestEntity, { description: 'Pass a null key to remove the planner.' })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  setTestPlanner(
    @Args('testId', { type: () => ID }) testId: string,
    @Args('key', { type: () => String, nullable: true }) key: string | null,
    @Args('fileName', { type: () => String, nullable: true }) fileName: string | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testsService.setPlanner(testId, key ?? null, fileName ?? null, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_CREATE)
  addTestQuestions(
    @Args('testId', { type: () => ID }) testId: string,
    @Args('rowId', { type: () => ID }) rowId: string,
    @Args('questionIds', { type: () => [ID] }) questionIds: string[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testsService.addQuestions(testId, rowId, questionIds, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  removeTestQuestion(
    @Args('testId', { type: () => ID }) testId: string,
    @Args('questionId', { type: () => ID }) questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testsService.removeQuestion(testId, questionId, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  reorderTestQuestions(
    @Args('testId', { type: () => ID }) testId: string,
    @Args('rowId', { type: () => ID }) rowId: string,
    @Args('questionIds', { type: () => [ID] }) questionIds: string[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testsService.reorderQuestions(testId, rowId, questionIds, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_PUBLISH)
  publishTest(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.testsService.publish(id, user.userId, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_PUBLISH)
  unpublishTest(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.testsService.unpublish(id, user.tenantId);
  }

  @Mutation(() => TestEntity)
  @RequirePermissions(PERMISSIONS.TEST_CREATE)
  duplicateTest(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.testsService.duplicate(id, user.userId, user.tenantId);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PERMISSIONS.TEST_DELETE)
  deleteTest(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.testsService.remove(id, user.userId, user.tenantId);
  }
}
