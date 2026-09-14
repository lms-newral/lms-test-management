import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_DURATION_MINUTES } from '../test-format.logic';

// ─── Test formats ────────────────────────────────────────────────────────────
//
// Bounds here only keep input sane. Whether a format adds up is decided by
// test-format.logic validateFormat when it is made ACTIVE -- a DRAFT may be
// saved half-built.

@InputType()
export class TestFormatRowInput {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  questionTypeId: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(1000)
  questionCount: number;

  @Field(() => Int, {
    nullable: true,
    description: 'Attempt at most N of this row. Omit when every question is compulsory.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  attemptLimit?: number | null;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(1000)
  marksPerQuestion: number;

  @Field(() => Float, {
    description: 'A positive number, subtracted for a wrong answer.',
  })
  @IsNumber()
  @Min(0)
  @Max(1000)
  negativeMarks: number;

  @Field({ defaultValue: false })
  @IsBoolean()
  partialMarking: boolean;
}

@InputType()
export class TestFormatSectionInput {
  @Field()
  @IsString()
  @MaxLength(100)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  instructionsHtml?: string | null;

  @Field(() => [TestFormatRowInput])
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TestFormatRowInput)
  rows: TestFormatRowInput[];
}

@InputType()
export class TestFormatSubjectInput {
  @Field(() => ID, { description: "A SUBJECT node from the tenant's question bank." })
  @IsString()
  @IsNotEmpty()
  subjectId: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(5000)
  totalQuestions: number;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(100000)
  totalMarks: number;

  @Field(() => [TestFormatSectionInput])
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TestFormatSectionInput)
  sections: TestFormatSectionInput[];
}

@InputType()
export class PercentileBandInput {
  @Field(() => Float)
  @IsNumber()
  minScore: number;

  @Field(() => Float)
  @IsNumber()
  maxScore: number;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(100)
  percentile: number;
}

@InputType({ description: 'The whole format. Saving replaces the structure.' })
export class SaveTestFormatInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  instructionsHtml?: string | null;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes: number;

  @Field(() => [TestFormatSubjectInput])
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TestFormatSubjectInput)
  subjects: TestFormatSubjectInput[];

  @Field(() => [PercentileBandInput], { defaultValue: [] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PercentileBandInput)
  bands: PercentileBandInput[];
}

@InputType()
export class TemplateSubjectMapInput {
  @Field({ description: 'The subject name as written in the template, e.g. "Biology".' })
  @IsString()
  @IsNotEmpty()
  templateSubjectName: string;

  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  subjectId: string;
}

@InputType()
export class TemplateTypeMapInput {
  @Field({ description: 'The question type code used in the template, e.g. "NAT".' })
  @IsString()
  @IsNotEmpty()
  questionTypeCode: string;

  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  questionTypeId: string;
}

@InputType()
export class UseTestFormatTemplateInput {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @Field({ nullable: true, description: "Defaults to the template's name." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @Field(() => [TemplateSubjectMapInput], {
    nullable: true,
    description: 'Only needed where a template subject name has no match in the bank.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSubjectMapInput)
  subjectMap?: TemplateSubjectMapInput[];

  @Field(() => [TemplateTypeMapInput], {
    nullable: true,
    description: 'Only needed where a template type code has no match.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateTypeMapInput)
  typeMap?: TemplateTypeMapInput[];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

@InputType()
export class CreateTestInput {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  formatId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  descriptionHtml?: string | null;

  @Field(() => Int, {
    nullable: true,
    description: "Overrides the format's duration. Omit to use the format's.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes?: number | null;
}

@InputType({
  description: 'Only the fields sent are changed. Send null to clear year, description or duration.',
})
export class UpdateTestInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  descriptionHtml?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes?: number | null;
}
