import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { TestSeriesNodeKind } from '../tests.enums';

// What students see. None of these types carries questions, options or answer
// keys -- only what helps a student decide, prepare and show up on time.

@ObjectType()
export class StudentTestSubjectEntity {
  @Field() name: string;
  @Field(() => Int) questions: number;
  @Field(() => Float) marks: number;
  @Field({ nullable: true }) syllabusHtml?: string;
}

@ObjectType()
export class StudentTestMarkingEntity {
  @Field() subjectName: string;
  @Field() sectionName: string;
  @Field() questionTypeCode: string;
  @Field(() => Int) questionCount: number;
  @Field(() => Int, { nullable: true, description: 'Attempt any N of these.' }) attemptLimit?: number;
  @Field(() => Float) marksPerQuestion: number;
  @Field(() => Float) negativeMarks: number;
  @Field() partialMarking: boolean;
}

@ObjectType()
export class StudentSeriesTestEntity {
  @Field(() => ID) testId: string;
  @Field(() => Int) durationMinutes: number;
  @Field(() => Int) totalQuestions: number;
  @Field(() => Float) totalMarks: number;
  @Field(() => [StudentTestSubjectEntity]) subjects: StudentTestSubjectEntity[];
  @Field(() => [StudentTestMarkingEntity]) marking: StudentTestMarkingEntity[];
  @Field({ nullable: true }) instructionsHtml?: string;
  @Field() availableFrom: Date;
  @Field() availableTo: Date;
  @Field() resultAt: Date;
  @Field({ description: 'UPCOMING, LIVE, AWAITING_RESULT or RESULT_OUT at serverTime.' })
  state: string;

  @Field({ nullable: true, description: 'Your attempt at this test, if any: IN_PROGRESS or SUBMITTED.' })
  attemptStatus?: string;
}

@ObjectType()
export class StudentSeriesNodeEntity {
  @Field(() => ID) id: string;
  @Field(() => ID, { nullable: true }) parentId?: string;
  @Field(() => TestSeriesNodeKind) kind: TestSeriesNodeKind;
  @Field() name: string;
  @Field(() => Int) orderIndex: number;
  @Field(() => StudentSeriesTestEntity, { nullable: true }) test?: StudentSeriesTestEntity;
}

@ObjectType()
export class StudentTestSeriesEntity {
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
  @Field(() => Float, { description: 'What the student pays: the discounted price when set, 0 when free.' })
  payable: number;
  @Field() startAt: Date;
  @Field() endAt: Date;

  @Field() isEnrolled: boolean;
  @Field({ nullable: true }) enrolledAt?: Date;

  @Field(() => Int) testCount: number;
  @Field(() => Int) folderCount: number;
  @Field(() => Int) liveCount: number;
  @Field(() => Int) upcomingCount: number;
  @Field(() => Int) completedCount: number;
  @Field({ nullable: true, description: 'When the next upcoming test opens.' }) nextTestAt?: Date;

  @Field(() => [StudentSeriesNodeEntity], { description: 'Folders and scheduled tests; empty in lists.' })
  nodes: StudentSeriesNodeEntity[];
  @Field({ description: 'Server clock, so countdowns do not trust the device clock.' })
  serverTime: Date;
}
