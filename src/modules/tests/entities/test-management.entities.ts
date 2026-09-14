import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import { AnswerKernel, QuestionStatus } from '../../question-bank/question-bank.enums';
import { TestFormatStatus, TestStatus } from '../tests.enums';

// ─── Test formats ────────────────────────────────────────────────────────────

@ObjectType()
export class TestFormatRowEntity {
  @Field(() => ID) id: string;
  @Field(() => ID, { nullable: true }) questionTypeId?: string;
  @Field() questionTypeCode: string;
  @Field(() => AnswerKernel) kernel: AnswerKernel;
  @Field(() => Int) questionCount: number;
  @Field(() => Int, { nullable: true }) attemptLimit?: number;
  @Field(() => Float) marksPerQuestion: number;
  @Field(() => Float) negativeMarks: number;
  @Field() partialMarking: boolean;
  @Field(() => Int) orderIndex: number;
  @Field(() => Float, { description: 'Best possible marks from this row.' })
  maxMarks: number;
}

@ObjectType()
export class TestFormatSectionEntity {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field({ nullable: true }) instructionsHtml?: string;
  @Field(() => Int) orderIndex: number;
  @Field(() => [TestFormatRowEntity]) rows: TestFormatRowEntity[];
}

@ObjectType()
export class TestFormatSubjectEntity {
  @Field(() => ID) id: string;
  @Field(() => ID, { nullable: true }) subjectId?: string;
  @Field() subjectName: string;
  @Field(() => Int) totalQuestions: number;
  @Field(() => Float) totalMarks: number;
  @Field(() => Int) orderIndex: number;
  @Field(() => [TestFormatSectionEntity]) sections: TestFormatSectionEntity[];
}

@ObjectType()
export class PercentileBandEntity {
  @Field(() => ID) id: string;
  @Field(() => Float) minScore: number;
  @Field(() => Float) maxScore: number;
  @Field(() => Float) percentile: number;
  @Field(() => Int) orderIndex: number;
}

@ObjectType()
export class TestFormatEntity {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field(() => TestFormatStatus) status: TestFormatStatus;
  @Field({ nullable: true }) instructionsHtml?: string;
  @Field(() => Int) durationMinutes: number;
  @Field({ description: 'A platform template, copied into institutes.' })
  isTemplate: boolean;
  @Field({ nullable: true }) templateNote?: string;
  @Field(() => ID, { nullable: true }) sourceTemplateId?: string;

  @Field(() => Int) totalQuestions: number;
  @Field(() => Float) totalMarks: number;
  @Field(() => Float, { description: 'Lowest possible score after negative marking.' })
  minScore: number;

  @Field(() => Int, { description: 'Tests using this format. Non-zero locks it.' })
  testCount: number;
  @Field() locked: boolean;
  @Field(() => [String], {
    description: 'What stops this format being made ACTIVE. Empty when it adds up.',
  })
  problems: string[];

  @Field(() => [TestFormatSubjectEntity]) subjects: TestFormatSubjectEntity[];
  @Field(() => [PercentileBandEntity]) bands: PercentileBandEntity[];
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

@ObjectType()
export class TestSyllabusEntity {
  @Field(() => ID) formatSubjectId: string;
  @Field() subjectName: string;
  @Field({ nullable: true }) syllabusHtml?: string;
}

@ObjectType()
export class TestQuestionOptionEntity {
  @Field() text: string;
  @Field() isCorrect: boolean;
}

@ObjectType()
export class TestQuestionEntity {
  @Field(() => ID) id: string;
  @Field(() => ID) rowId: string;
  @Field(() => ID) questionId: string;
  @Field(() => Int) orderIndex: number;
  @Field() questionText: string;
  @Field(() => QuestionStatus) questionStatus: QuestionStatus;
  @Field() questionTypeCode: string;
  @Field(() => AnswerKernel, { nullable: true }) kernel?: AnswerKernel;
  @Field(() => [TestQuestionOptionEntity], { description: 'Choice options with correctness: the answer key. Staff only.' })
  options: TestQuestionOptionEntity[];
  @Field(() => GraphQLJSON, { nullable: true, description: 'Numeric, text or matching answer key. Staff only.' })
  answerConfig?: unknown;
  @Field(() => String, { nullable: true }) explanation?: string;
  @Field({ description: 'Deleted from the bank after it was picked.' })
  deleted: boolean;
  @Field({ description: "False when the bank question's subject or type no longer matches its row." })
  matchesRow: boolean;
}

@ObjectType()
export class TestRowProgressEntity {
  @Field(() => ID) rowId: string;
  @Field() label: string;
  @Field(() => Int) picked: number;
  @Field(() => Int) required: number;
}

@ObjectType()
export class TestSummaryEntity {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field(() => Int, { nullable: true }) year?: number;
  @Field(() => TestStatus) status: TestStatus;
  @Field(() => ID) formatId: string;
  @Field() formatName: string;
  @Field(() => Int) durationMinutes: number;
  @Field(() => Int) picked: number;
  @Field(() => Int) required: number;
  @Field(() => Float) totalMarks: number;
  @Field(() => [String]) subjects: string[];
  @Field(() => Int, { description: 'Subjects with a written syllabus.' })
  syllabusDone: number;
  @Field() hasDescription: boolean;
  @Field({ nullable: true }) plannerFileName?: string;
  @Field(() => Int, { description: 'Test series this test is linked into.' })
  seriesCount: number;
  @Field({ description: 'A draft with everything filled in, ready to publish.' })
  ready: boolean;
  @Field({ nullable: true }) publishedAt?: Date;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class TestEntity {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field(() => Int, { nullable: true }) year?: number;
  @Field(() => TestStatus) status: TestStatus;
  @Field({ nullable: true }) descriptionHtml?: string;
  @Field({ nullable: true }) plannerFileName?: string;
  @Field({ nullable: true }) plannerUrl?: string;
  @Field(() => Int, { description: 'The duration in effect: the override, else the format.' })
  durationMinutes: number;
  @Field(() => Int, { nullable: true }) durationOverride?: number;
  @Field({ nullable: true }) publishedAt?: Date;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;

  @Field(() => TestFormatEntity) format: TestFormatEntity;
  @Field(() => [TestSyllabusEntity]) syllabi: TestSyllabusEntity[];
  @Field(() => [TestQuestionEntity]) questions: TestQuestionEntity[];
  @Field(() => [TestRowProgressEntity]) progress: TestRowProgressEntity[];
  @Field(() => [String], { description: 'What stops publishing. Empty when it can be published.' })
  publishProblems: string[];
}

@ObjectType()
export class TestPlannerUploadEntity {
  @Field() uploadUrl: string;
  @Field() key: string;
  @Field(() => Int) expiresIn: number;
}
