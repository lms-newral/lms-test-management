import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RequirePermissions } from 'src/common/decorators/permissions.decorators';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { type AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import { StudentTestSeriesService } from './student-test-series.service';
import { StudentTestSeriesEntity } from './entities/student-test-series.entities';

/** Test series for signed-in students of the session tenant. */
@Resolver()
@UseGuards(GqlAuthGuard)
export class StudentTestSeriesResolver {
  constructor(private readonly series: StudentTestSeriesService) {}

  @Query(() => [StudentTestSeriesEntity], { description: 'Series open to students right now.' })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  studentTestSeriesList(@CurrentUser() user: AuthenticatedUser) {
    return this.series.list(user, false);
  }

  @Query(() => [StudentTestSeriesEntity], { description: 'Series the student is enrolled in.' })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  myTestSeries(@CurrentUser() user: AuthenticatedUser) {
    return this.series.list(user, true);
  }

  @Query(() => StudentTestSeriesEntity)
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  studentTestSeries(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.series.findOne(id, user);
  }

  @Mutation(() => StudentTestSeriesEntity, { description: 'Joins a free series. Paid series are bought through the main backend.' })
  @RequirePermissions(PERMISSIONS.TEST_ATTEMPT)
  enrollFreeTestSeries(
    @Args('seriesId', { type: () => ID }) seriesId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.series.enrollFree(seriesId, user);
  }
}
