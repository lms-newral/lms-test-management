import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// Bounds here only keep input sane. Whether a series can be published is
// decided by test-series.logic -- a DRAFT may be saved half-built.

@InputType()
export class CreateTestSeriesInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}

@InputType({ description: 'Only the fields sent are changed. Send null to clear one.' })
export class UpdateTestSeriesInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  classLevel?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  examType?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  targetYear?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  descriptionHtml?: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Max(10_000_000)
  price?: number | null;

  @Field(() => Float, { nullable: true, description: 'What students pay when set. At most the price.' })
  @IsOptional()
  @IsNumber()
  @Max(10_000_000)
  discountedPrice?: number | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endAt?: Date | null;
}

@InputType({ description: 'Send all three, or all null to clear the schedule.' })
export class TestSeriesScheduleInput {
  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  availableFrom?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  availableTo?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  resultAt?: Date | null;
}
