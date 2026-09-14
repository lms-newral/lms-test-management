import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/* ─── Inputs ──────────────────────────────────────────────────────────────── */

@InputType()
export class CreateQuestionImportJobInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Bank the committed questions are filed into.',
  })
  @IsOptional()
  @IsString()
  questionBankId?: string;
}

/**
 * A reviewer's correction to one staged row.
 *
 * Every field is optional and only the ones supplied are written, so the UI can
 * PATCH a single cell without having to send the whole row back and risk
 * clobbering someone else's edit.
 */
@InputType()
export class UpdateQuestionImportRowInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Choice options as [{ text, isCorrect }].',
  })
  @IsOptional()
  optionsJson?: unknown;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  answerConfig?: unknown;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  solutionHtml?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  questionTypeId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  subjectId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  chapterId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  topicId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  subtopicId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  difficultyId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  marks?: number;
}

@InputType()
export class BulkAssignImportRowsInput {
  @Field(() => ID)
  @IsString()
  jobId: string;

  @Field(() => [ID], {
    description: 'Rows to change. Empty means every row in the job.',
  })
  @IsArray()
  @ArrayMaxSize(2000)
  rowIds: string[];

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  questionTypeId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  subjectId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  chapterId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  topicId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  subtopicId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  difficultyId?: string;
}

/* ─── Entities ────────────────────────────────────────────────────────────── */

@ObjectType()
export class QuestionImportJobEntity {
  @Field(() => ID) id: string;
  @Field({ nullable: true }) fileName?: string;

  @Field({
    description:
      'PARSING | AWAITING_REVIEW | COMMITTING | DONE | FAILED. A plain ' +
      'string, not an enum, because the column is.',
  })
  status: string;

  @Field(() => Int) parsedCount: number;
  @Field(() => Int) importedCount: number;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description:
      'Headers as they were understood, unmapped columns and severity counts.',
  })
  report?: unknown;

  @Field({ nullable: true }) failureReason?: string;
  @Field(() => ID, { nullable: true }) questionBankId?: string;
  @Field(() => Date, { nullable: true }) committedAt?: Date;
  @Field(() => Date) createdAt: Date;
  @Field(() => Date) updatedAt: Date;
}

@ObjectType()
export class QuestionImportUploadEntity {
  @Field(() => QuestionImportJobEntity) job: QuestionImportJobEntity;

  @Field({ description: 'Presigned PUT. Upload the .docx here, then start.' })
  uploadUrl: string;

  @Field() key: string;
  @Field(() => Int) expiresIn: number;
}

@ObjectType()
export class QuestionImportRowEntity {
  @Field(() => ID) id: string;
  @Field(() => ID) jobId: string;
  @Field(() => Int) rowIndex: number;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Cells as they were read, including unrecognised columns.',
  })
  raw?: unknown;

  @Field(() => ID, { nullable: true }) questionTypeId?: string;
  @Field(() => ID, { nullable: true }) subjectId?: string;
  @Field(() => ID, { nullable: true }) chapterId?: string;
  @Field(() => ID, { nullable: true }) topicId?: string;
  @Field(() => ID, { nullable: true }) subtopicId?: string;
  @Field(() => ID, { nullable: true }) difficultyId?: string;

  @Field({ nullable: true }) bodyHtml?: string;
  @Field(() => GraphQLJSON, { nullable: true }) optionsJson?: unknown;
  @Field(() => GraphQLJSON, { nullable: true }) answerConfig?: unknown;
  @Field({ nullable: true }) solutionHtml?: string;
  @Field({ nullable: true }) solutionVideoUrl?: string;
  @Field(() => Int, { nullable: true }) marks?: number;

  @Field({ description: 'OK | WARNING | BLOCKING' }) severity: string;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Issues as [{ code, severity, message }].',
  })
  issues?: unknown;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'What the reviewer changed, kept beside the original parse.',
  })
  overrides?: unknown;

  @Field(() => ID, { nullable: true }) duplicateOfId?: string;
  @Field(() => ID, { nullable: true }) createdId?: string;
  @Field() dropped: boolean;
}
