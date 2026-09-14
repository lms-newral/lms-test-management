import { Field, ID, InputType, Int } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AnswerKernel,
  FieldRole,
  FieldType,
  QuestionStatus,
  SolutionKind,
  SolutionVisibility,
  TaxonomyKind,
  VideoProvider,
} from '../question-bank.enums';

// ─── Taxonomy ────────────────────────────────────────────────────────────────

@InputType()
export class CreateTaxonomyInput {
  @Field(() => TaxonomyKind)
  @IsEnum(TaxonomyKind)
  kind: TaxonomyKind;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @Field(() => ID, {
    nullable: true,
    description:
      'Required for CHAPTER (must be a SUBJECT), TOPIC (must be a CHAPTER) ' +
      'and SUBTOPIC (must be a TOPIC). Must be null for SUBJECT.',
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;
}

@InputType()
export class UpdateTaxonomyInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Question types ──────────────────────────────────────────────────────────

@InputType()
export class CreateQuestionTypeInput {
  @Field({
    description: 'Short uppercase code, unique per tenant. e.g. "SCQ".',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be uppercase letters, digits or underscores',
  })
  code: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @Field(() => AnswerKernel)
  @IsEnum(AnswerKernel)
  kernel: AnswerKernel;

  @Field(() => [String], {
    nullable: true,
    description: 'Other spellings a Word file may use for this.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  aliases?: string[];

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  config?: Record<string, unknown>;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  layoutHint?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  icon?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;
}

@InputType()
export class UpdateQuestionTypeInput {
  @Field(() => [String], {
    nullable: true,
    description: 'Other spellings a Word file may use for this.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  aliases?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  config?: Record<string, unknown>;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  layoutHint?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  icon?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;
}

// ─── Difficulty levels ───────────────────────────────────────────────────────

@InputType()
export class CreateDifficultyInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  code: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @Field(() => [String], {
    nullable: true,
    description: 'Other spellings a Word file may use for this.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  aliases?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;
}

@InputType()
export class UpdateDifficultyInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @Field(() => [String], {
    nullable: true,
    description: 'Other spellings a Word file may use for this.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  aliases?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Field definitions ───────────────────────────────────────────────────────

@InputType()
export class QuestionFieldOptionInput {
  @Field({ nullable: true, description: 'Omit to create a new option.' })
  @IsOptional()
  @IsString()
  id?: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  value: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @Field(() => Int, {
    nullable: true,
    description:
      'Numeric ordering used by blueprint targeting, so rules survive a ' +
      'relabelling of the options.',
  })
  @IsOptional()
  @IsInt()
  weight?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;
}

@InputType()
export class CreateQuestionFieldInput {
  @Field({ description: 'Stable machine key, unique per tenant.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'key must be lower_snake_case and start with a letter',
  })
  key: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @Field(() => FieldType)
  @IsEnum(FieldType)
  type: FieldType;

  @Field(() => FieldRole, {
    nullable: true,
    description: 'At most one active field per tenant may hold each role.',
  })
  @IsOptional()
  @IsEnum(FieldRole)
  role?: FieldRole;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  helpText?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;

  @Field(() => [QuestionFieldOptionInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  options?: QuestionFieldOptionInput[];
}

@InputType()
export class UpdateQuestionFieldInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  helpText?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;

  @Field(() => [QuestionFieldOptionInput], {
    nullable: true,
    description:
      'Full replacement set. Options absent from the list are deactivated ' +
      'rather than deleted, so existing questions keep their stored value.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  options?: QuestionFieldOptionInput[];
}

// ─── Questions ───────────────────────────────────────────────────────────────

@InputType()
export class BankMCQOptionInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  id?: string;

  @Field()
  @IsString()
  text: string;

  @Field()
  @IsBoolean()
  isCorrect: boolean;
}

@InputType()
export class CreateBankQuestionInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  questionText: string;

  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  questionTypeId: string;

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

  @Field(() => ID, {
    nullable: true,
    description:
      'Optional fourth level. A question filed only to Topic is valid.',
  })
  @IsOptional()
  @IsString()
  subtopicId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  difficultyId?: string;

  @Field(() => [BankMCQOptionInput], {
    nullable: true,
    description: 'Required for SINGLE_CHOICE and MULTI_CHOICE kernels.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(26)
  mcqOptions?: BankMCQOptionInput[];

  @Field(() => GraphQLJSON, {
    nullable: true,
    description:
      'Kernel payload for NUMERIC, SHORT_TEXT, MATCHING and ORDERING. ' +
      'Validated against the type kernel server-side.',
  })
  @IsOptional()
  answerConfig?: Record<string, unknown>;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  explanation?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  questionBankId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  groupId?: string;

  @Field(() => Int, {
    nullable: true,
    description: 'Marks for a correct answer. Defaults to 1 when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  marks?: number;

  @Field(() => QuestionStatus, { nullable: true })
  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;
}

@InputType()
export class UpdateBankQuestionInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  questionText?: string;

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

  @Field(() => ID, {
    nullable: true,
    description:
      'Optional fourth level. A question filed only to Topic is valid.',
  })
  @IsOptional()
  @IsString()
  subtopicId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  difficultyId?: string;

  @Field(() => [BankMCQOptionInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(26)
  mcqOptions?: BankMCQOptionInput[];

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  answerConfig?: Record<string, unknown>;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  explanation?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  groupId?: string;

  @Field(() => Int, {
    nullable: true,
    description: 'Marks for a correct answer.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  marks?: number;

  @Field({
    nullable: true,
    description: 'Recorded on the version row for the audit trail.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

@InputType()
export class BankQuestionFilterInput {
  @Field({ nullable: true, description: 'Free-text search over the stem.' })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  subjectIds?: string[];

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  chapterIds?: string[];

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  topicIds?: string[];

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  subtopicIds?: string[];

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  questionTypeIds?: string[];

  @Field(() => [QuestionStatus], { nullable: true })
  @IsOptional()
  @IsArray()
  statuses?: QuestionStatus[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  questionBankId?: string;

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  difficultyIds?: string[];

  @Field({
    nullable: true,
    description: 'Only questions whose stem hash collides with another.',
  })
  @IsOptional()
  @IsBoolean()
  duplicatesOnly?: boolean;

  @Field({
    nullable: true,
    description: 'Include soft-deleted questions. Defaults to false.',
  })
  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean;
}

@InputType()
export class PaginationInput {
  @Field(() => Int, { nullable: true, defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Field(() => Int, { nullable: true, defaultValue: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @Field({
    nullable: true,
    description: 'One of: createdAt, updatedAt, marks. Defaults to updatedAt.',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @Field({ nullable: true, description: 'asc | desc. Defaults to desc.' })
  @IsOptional()
  @IsString()
  sortDir?: string;
}

// ─── Solutions ───────────────────────────────────────────────────────────────

@InputType()
export class UpsertSolutionInput {
  @Field({ nullable: true, description: 'Omit to create.' })
  @IsOptional()
  @IsString()
  id?: string;

  @Field(() => SolutionKind)
  @IsEnum(SolutionKind)
  kind: SolutionKind;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  contentHtml?: string;

  @Field(() => VideoProvider, { nullable: true })
  @IsOptional()
  @IsEnum(VideoProvider)
  videoProvider?: VideoProvider;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'videoUrl must be a full URL' })
  videoUrl?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @Field(() => SolutionVisibility, { nullable: true })
  @IsOptional()
  @IsEnum(SolutionVisibility)
  visibility?: SolutionVisibility;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  orderIndex?: number;
}
