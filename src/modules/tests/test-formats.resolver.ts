import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/common/decorators/permissions.decorators';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { type AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import { TestFormatsService } from './test-formats.service';
import { TestFormatStatus } from './tests.enums';
import {
  SaveTestFormatInput,
  UseTestFormatTemplateInput,
} from './dto/test-management.inputs';
import { TestFormatEntity } from './entities/test-management.entities';

/**
 * Test formats. The tenant and user always come from the session -- no
 * argument here can name a tenant.
 */
@Resolver()
@UseGuards(GqlAuthGuard)
export class TestFormatsResolver {
  constructor(private readonly formats: TestFormatsService) {}

  @Query(() => [TestFormatEntity])
  @RequirePermissions(PERMISSIONS.TEST_VIEW)
  testFormats(
    @CurrentUser() user: AuthenticatedUser,
    @Args('status', { type: () => TestFormatStatus, nullable: true })
    status?: TestFormatStatus,
  ) {
    return this.formats.list(user.tenantId, status);
  }

  @Query(() => [TestFormatEntity], {
    description: 'Platform templates (JEE Main, JEE Advanced, NEET) an institute can copy.',
  })
  @RequirePermissions(PERMISSIONS.TEST_VIEW)
  testFormatTemplates() {
    return this.formats.templates();
  }

  @Query(() => TestFormatEntity)
  @RequirePermissions(PERMISSIONS.TEST_VIEW)
  testFormat(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formats.findOne(id, user.tenantId);
  }

  @Mutation(() => TestFormatEntity)
  @RequirePermissions(PERMISSIONS.TEST_CREATE)
  createTestFormat(
    @Args('input') input: SaveTestFormatInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formats.create(input, user.userId, user.tenantId);
  }

  @Mutation(() => TestFormatEntity, {
    description: 'Replaces the whole structure. Refused once any test uses the format.',
  })
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  updateTestFormat(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: SaveTestFormatInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formats.update(id, input, user.tenantId);
  }

  @Mutation(() => TestFormatEntity)
  @RequirePermissions(PERMISSIONS.TEST_EDIT)
  setTestFormatStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('status', { type: () => TestFormatStatus }) status: TestFormatStatus,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formats.setStatus(id, status, user.tenantId);
  }

  @Mutation(() => TestFormatEntity)
  @RequirePermissions(PERMISSIONS.TEST_CREATE)
  duplicateTestFormat(
    @Args('id', { type: () => ID }) id: string,
    @Args('name', { type: () => String, nullable: true }) name: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formats.duplicate(id, name, user.userId, user.tenantId);
  }

  @Mutation(() => Boolean)
  @RequirePermissions(PERMISSIONS.TEST_DELETE)
  deleteTestFormat(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formats.remove(id, user.userId, user.tenantId);
  }

  @Mutation(() => TestFormatEntity)
  @RequirePermissions(PERMISSIONS.TEST_CREATE)
  useTestFormatTemplate(
    @Args('input') input: UseTestFormatTemplateInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.formats.useTemplate(input, user.userId, user.tenantId);
  }
}
