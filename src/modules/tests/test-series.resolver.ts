import { UseGuards } from '@nestjs/common';
import { Args, Context, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { Request } from 'express';
import { GqlAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/common/decorators/permissions.decorators';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { type AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import { TestSeriesService } from './test-series.service';
import { TestSeriesStatus } from './tests.enums';
import {
  CreateTestSeriesInput,
  TestSeriesScheduleInput,
  UpdateTestSeriesInput,
} from './dto/test-series.inputs';
import {
  TestSeriesCoverUploadEntity,
  TestSeriesEnrollmentEntity,
  TestSeriesEntity,
} from './entities/test-series.entities';

/** Test series authoring. Staff-only; the tenant and user come from the session. */
@Resolver()
@UseGuards(GqlAuthGuard)
export class TestSeriesResolver {
  constructor(private readonly series: TestSeriesService) {}

  @Query(() => [TestSeriesEntity])
  @RequirePermissions(PERMISSIONS.TEST_VIEW, PERMISSIONS.TEST_EDIT)
  testSeriesList(
    @CurrentUser() user: AuthenticatedUser,
    @Args('status', { type: () => TestSeriesStatus, nullable: true }) status?: TestSeriesStatus,
  ) {
    return this.series.list(user.tenantId, status);
  }

  @Query(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_VIEW, PERMISSIONS.TEST_EDIT)
  testSeries(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.series.findOne(id, user.tenantId);
  }

  @Query(() => [TestSeriesEnrollmentEntity])
  @RequirePermissions(PERMISSIONS.TEST_VIEW, PERMISSIONS.TEST_EDIT)
  testSeriesEnrollments(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.enrollments(seriesId, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_CREATE)
  createTestSeries(@Args('input') input: CreateTestSeriesInput, @CurrentUser() user: AuthenticatedUser) {
    return this.series.create(input.name, user.userId, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  updateTestSeries(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateTestSeriesInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.update(id, input, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  addTestSeriesFolder(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @Args('parentId', { type: () => ID, nullable: true }) parentId: string | null,
    @Args('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.addFolder(seriesId, parentId ?? null, name, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  renameTestSeriesFolder(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @Args('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.renameFolder(nodeId, name, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  addTestSeriesTests(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @Args('parentId', { type: () => ID, nullable: true }) parentId: string | null,
    @Args('testIds', { type: () => [ID] }) testIds: string[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.addTests(seriesId, parentId ?? null, testIds, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  setTestSeriesSchedule(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @Args('input') input: TestSeriesScheduleInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.setSchedule(nodeId, input, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity, { description: 'parentId null is the top level.' })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  moveTestSeriesNode(
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @Args('parentId', { type: () => ID, nullable: true }) parentId: string | null,
    @Args('orderIndex', { type: () => Int }) orderIndex: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.move(nodeId, parentId ?? null, orderIndex, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity, { description: 'Removing a folder removes everything inside it.' })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  removeTestSeriesNode(@Args('nodeId', { type: () => ID }) nodeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.series.removeNode(nodeId, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_PUBLISH)
  publishTestSeries(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.series.publish(id, user.userId, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_PUBLISH)
  unpublishTestSeries(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.series.unpublish(id, user.tenantId);
  }

  @Mutation(() => TestSeriesCoverUploadEntity, {
    description: 'A presigned PUT for the cover image. Call setTestSeriesCover with the key after uploading.',
  })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  createTestSeriesCoverUpload(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @Args('fileName') fileName: string,
    @Args('contentType') contentType: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.createCoverUpload(seriesId, fileName, contentType, user.tenantId);
  }

  @Mutation(() => TestSeriesEntity, { description: 'Pass a null key to remove the cover.' })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  setTestSeriesCover(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @Args('key', { type: () => String, nullable: true }) key: string | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.setCover(seriesId, key ?? null, user.tenantId);
  }

  @Mutation(() => [TestSeriesEnrollmentEntity], {
    description: 'Enrolls students of your institute by email (offline payment or free access).',
  })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  addTestSeriesStudents(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @Args('emails', { type: () => [String] }) emails: string[],
    @Context('req') req: Request,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.addStudents(seriesId, emails, req, user.tenantId);
  }

  @Mutation(() => [TestSeriesEnrollmentEntity])
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  removeTestSeriesStudent(
    @Args('enrollmentId', { type: () => ID }) enrollmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.removeStudent(enrollmentId, user.tenantId);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PERMISSIONS.TEST_DELETE)
  deleteTestSeries(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.series.remove(id, user.userId, user.tenantId);
  }
}
