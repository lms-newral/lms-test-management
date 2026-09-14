import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { TestSeriesNodeKind, TestSeriesStatus, TestStatus } from '../tests.enums';

@ObjectType({ description: 'A folder or a linked test. The admin builds the tree from parentId.' })
export class TestSeriesNodeEntity {
  @Field(() => ID) id: string;
  @Field(() => ID, { nullable: true }) parentId?: string;
  @Field(() => TestSeriesNodeKind) kind: TestSeriesNodeKind;
  @Field(() => Int) orderIndex: number;
  @Field({ description: "The folder's name, or the linked test's name." })
  name: string;

  @Field(() => ID, { nullable: true }) testId?: string;
  @Field(() => TestStatus, { nullable: true }) testStatus?: TestStatus;
  @Field(() => Int, { nullable: true }) testYear?: number;
  @Field(() => Int, { nullable: true }) testQuestions?: number;
  @Field(() => Float, { nullable: true }) testMarks?: number;
  @Field(() => Int, { nullable: true }) testDurationMinutes?: number;

  @Field({ nullable: true }) availableFrom?: Date;
  @Field({ nullable: true }) availableTo?: Date;
  @Field({ nullable: true }) resultAt?: Date;
  @Field({ description: 'Opened for students in a published series; its past is fixed.' })
  started: boolean;
  @Field(() => [String], { description: "What is wrong with this test's place in the series." })
  problems: string[];
}

@ObjectType()
export class TestSeriesEntity {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field({ nullable: true }) classLevel?: string;
  @Field({ nullable: true }) examType?: string;
  @Field(() => Int, { nullable: true }) targetYear?: number;
  @Field({ nullable: true }) descriptionHtml?: string;
  @Field({ nullable: true }) coverImageUrl?: string;
  @Field() isPaid: boolean;
  @Field(() => Float, { nullable: true }) price?: number;
  @Field(() => Float, { nullable: true }) discountedPrice?: number;
  @Field({ nullable: true }) startAt?: Date;
  @Field({ nullable: true }) endAt?: Date;
  @Field(() => TestSeriesStatus) status: TestSeriesStatus;
  @Field({ nullable: true }) publishedAt?: Date;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;

  @Field(() => Int) testCount: number;
  @Field(() => Int) folderCount: number;
  @Field(() => Int) enrolledCount: number;
  @Field(() => [TestSeriesNodeEntity]) nodes: TestSeriesNodeEntity[];
  @Field(() => [String], { description: 'What stops publishing. Empty when it can be published.' })
  problems: string[];
}

@ObjectType()
export class TestSeriesCoverUploadEntity {
  @Field() uploadUrl: string;
  @Field() key: string;
  @Field() fileUrl: string;
  @Field(() => Int) expiresIn: number;
}

@ObjectType()
export class TestSeriesEnrollmentEntity {
  @Field(() => ID) id: string;
  @Field(() => ID) userId: string;
  @Field({ nullable: true }) userName?: string;
  @Field({ nullable: true }) userEmail?: string;
  @Field({ description: 'FREE, PAID, or MANUAL (added by an admin).' }) source: string;
  @Field(() => Float, { nullable: true }) amountPaid?: number;
  @Field() enrolledAt: Date;
}
