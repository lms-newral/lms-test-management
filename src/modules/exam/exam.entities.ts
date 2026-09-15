import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ExamActionEntity {
  @Field({ description: 'NONE, REFRESH_NOTICE or AUTO_SUBMIT.' }) type: string;
  @Field(() => Int, { nullable: true }) count?: number;
  @Field(() => Int, { nullable: true }) max?: number;
  @Field({ nullable: true }) reason?: string;
  @Field({ nullable: true }) message?: string;
}

@ObjectType({ description: 'Everything the exam screen needs. Never contains answer keys.' })
export class ExamSessionEntity {
  @Field(() => ID) attemptId: string;
  @Field({ description: 'IN_PROGRESS or SUBMITTED.' }) status: string;
  @Field({ description: 'Signs event uploads (x-attempt-token).' }) token: string;
  @Field() startedAt: Date;
  @Field() deadline: Date;
  @Field({ description: 'Server clock, for the countdown.' }) serverTime: Date;
  @Field() testName: string;
  @Field() candidateName: string;
  @Field({ nullable: true, description: 'Encrypted paper download (IN_PROGRESS only).' }) paperUrl?: string;
  @Field({ nullable: true, description: 'AES-GCM key for the paper (IN_PROGRESS only).' }) paperSecret?: string;
  @Field(() => Int) violations: number;
  @Field(() => Int) refreshes: number;
  @Field(() => Int) maxWarnings: number;
  @Field(() => Int) maxRefreshes: number;
  @Field(() => Int, { description: 'Highest event seq the server has stored.' }) lastSeq: number;
  @Field() chainHead: string;
  @Field({ nullable: true }) submitReason?: string;
  @Field(() => ExamActionEntity) action: ExamActionEntity;
}

@ObjectType()
export class MyExamAttemptEntity {
  @Field(() => ID) attemptId: string;
  @Field() status: string;
  @Field() startedAt: Date;
  @Field() deadline: Date;
  @Field({ nullable: true }) submittedAt?: Date;
  @Field({ nullable: true }) submitReason?: string;
}
