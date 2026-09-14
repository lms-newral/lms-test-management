import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import {
  AnswerKernel,
  FieldRole,
  FieldType,
  QuestionStatus,
  SolutionKind,
  SolutionVisibility,
  TaxonomyKind,
  UsageType,
  VideoProvider,
} from '../question-bank.enums';

@ObjectType()
export class TaxonomyNode {
  @Field(() => ID) id: string;
  @Field(() => TaxonomyKind) kind: TaxonomyKind;
  @Field() name: string;
  @Field({ nullable: true }) code?: string;
  @Field(() => ID, { nullable: true }) parentId?: string;
  @Field(() => Int) orderIndex: number;
  @Field() isActive: boolean;

  @Field(() => Int, {
    description: 'Questions referencing this node at its own level.',
  })
  questionCount: number;

  @Field(() => [TaxonomyNode], { nullable: true })
  children?: TaxonomyNode[];
}

@ObjectType()
export class QuestionTypeDefEntity {
  @Field(() => ID) id: string;
  @Field() code: string;
  @Field() label: string;
  @Field(() => AnswerKernel) kernel: AnswerKernel;

  @Field(() => [String], {
    description:
      'Other spellings a Word file may use for this type. Matched case-insensitively, ignoring spaces and underscores.',
  })
  aliases: string[];
  @Field(() => GraphQLJSON, { nullable: true }) config?: unknown;
  @Field({ nullable: true }) layoutHint?: string;
  @Field({ nullable: true }) icon?: string;
  @Field({ nullable: true }) color?: string;
  @Field() isActive: boolean;
  @Field(() => Int) orderIndex: number;

  @Field(() => Int, {
    description: 'Live questions using this type. Non-zero blocks deletion.',
  })
  questionCount: number;
}

@ObjectType()
export class DifficultyLevelEntity {
  @Field(() => ID) id: string;
  @Field() code: string;
  @Field() label: string;
  @Field(() => [String]) aliases: string[];
  @Field({ nullable: true }) color?: string;
  @Field(() => Int) orderIndex: number;
  @Field() isActive: boolean;
  @Field(() => Int) questionCount: number;
}

@ObjectType()
export class QuestionFieldOptionEntity {
  @Field(() => ID) id: string;
  @Field() value: string;
  @Field() label: string;
  @Field(() => Int, { nullable: true }) weight?: number;
  @Field({ nullable: true }) color?: string;
  @Field(() => Int) orderIndex: number;
  @Field() isActive: boolean;
}

@ObjectType()
export class QuestionFieldDefEntity {
  @Field(() => ID) id: string;
  @Field() key: string;
  @Field() label: string;
  @Field(() => FieldType) type: FieldType;
  @Field(() => FieldRole, { nullable: true }) role?: FieldRole;
  @Field() required: boolean;
  @Field() isActive: boolean;
  @Field(() => Int) orderIndex: number;
  @Field({ nullable: true }) helpText?: string;
  @Field(() => [QuestionFieldOptionEntity])
  options: QuestionFieldOptionEntity[];
}

@ObjectType()
export class QuestionSolutionEntity {
  @Field(() => ID) id: string;
  @Field(() => SolutionKind) kind: SolutionKind;
  @Field({ nullable: true }) contentHtml?: string;
  @Field(() => VideoProvider, { nullable: true }) videoProvider?: VideoProvider;
  @Field({ nullable: true }) videoUrl?: string;
  @Field(() => Int, { nullable: true }) durationSec?: number;
  @Field({ nullable: true }) language?: string;
  @Field(() => SolutionVisibility) visibility: SolutionVisibility;
  @Field(() => Int) orderIndex: number;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class QuestionUsageEntity {
  @Field(() => ID) id: string;
  @Field(() => UsageType) usedInType: UsageType;
  @Field(() => ID) usedInId: string;
  @Field(() => Int) version: number;
  @Field(() => Float, { nullable: true }) marks?: number;
  @Field() createdAt: Date;

  @Field({
    nullable: true,
    description: 'Title of the test/quiz/poll, resolved for display.',
  })
  usedInTitle?: string;
}

@ObjectType()
export class QuestionVersionEntity {
  @Field(() => ID) id: string;
  @Field(() => Int) version: number;
  @Field(() => GraphQLJSON) snapshot: unknown;
  @Field(() => ID, { nullable: true }) changedById?: string;
  @Field({ nullable: true }) changeNote?: string;
  @Field() createdAt: Date;
}

@ObjectType()
export class QuestionGroupEntity {
  @Field(() => ID) id: string;
  @Field({ nullable: true }) title?: string;
  @Field({ nullable: true }) passageHtml?: string;
  @Field(() => Int) questionCount: number;
}

/**
 * A question as the bank sees it.
 *
 * NOTE: `mcqOptions` and `answerConfig` carry the answer key. Every resolver
 * returning this type is gated behind a QUESTION_BANK_* permission, which
 * students never hold. This type must never be reachable from a student-facing
 * query.
 */
@ObjectType()
export class BankQuestionEntity {
  @Field(() => ID) id: string;
  @Field() questionText: string;

  @Field(() => QuestionTypeDefEntity, { nullable: true })
  typeDef?: QuestionTypeDefEntity;

  @Field(() => TaxonomyNode, { nullable: true }) subject?: TaxonomyNode;
  @Field(() => TaxonomyNode, { nullable: true }) chapter?: TaxonomyNode;
  @Field(() => TaxonomyNode, { nullable: true }) topic?: TaxonomyNode;
  @Field(() => TaxonomyNode, { nullable: true }) subtopic?: TaxonomyNode;

  @Field(() => DifficultyLevelEntity, { nullable: true })
  difficulty?: DifficultyLevelEntity;

  @Field(() => GraphQLJSON, { nullable: true }) mcqOptions?: unknown;
  @Field(() => GraphQLJSON, { nullable: true }) answerConfig?: unknown;

  @Field(() => QuestionStatus) status: QuestionStatus;
  @Field(() => Int) currentVersion: number;

  @Field(() => Float, { nullable: true }) marks?: number;

  @Field({ nullable: true }) explanation?: string;
  @Field({ nullable: true }) mediaUrl?: string;

  @Field(() => ID, { nullable: true }) questionBankId?: string;
  @Field(() => QuestionGroupEntity, { nullable: true })
  group?: QuestionGroupEntity;

  @Field(() => [QuestionSolutionEntity]) solutions: QuestionSolutionEntity[];

  @Field(() => Int, { description: 'How many assessments use this question.' })
  usageCount: number;

  @Field({ nullable: true }) normalizedHash?: string;

  @Field(() => Boolean, {
    description: 'Another live question in this tenant shares the same stem.',
  })
  hasDuplicate: boolean;

  @Field(() => ID, { nullable: true }) createdById?: string;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@ObjectType()
export class BankQuestionPage {
  @Field(() => [BankQuestionEntity]) items: BankQuestionEntity[];
  @Field(() => Int) total: number;
  @Field(() => Int) page: number;
  @Field(() => Int) pageSize: number;
  @Field(() => Int) totalPages: number;
}

@ObjectType()
export class FacetCount {
  @Field() key: string;
  @Field({ nullable: true }) label?: string;
  @Field(() => Int) count: number;
}

@ObjectType()
export class BankFacets {
  @Field(() => [FacetCount]) byStatus: FacetCount[];
  @Field(() => [FacetCount]) byType: FacetCount[];
  @Field(() => [FacetCount]) bySubject: FacetCount[];
  @Field(() => [FacetCount]) byDifficulty: FacetCount[];
  @Field(() => Int) total: number;
}

/**
 * A bank question as the live-poll host picker sees it.
 *
 * Deliberately NOT `BankQuestionEntity`. That type exposes `mcqOptions` and
 * `answerConfig` -- the answer key -- and is fine for the admin UI, where the
 * author is editing the key. The poll picker runs inside the Electron desktop
 * app on a classroom machine that is often projected, so the key has no reason
 * to be on the wire, in a cache, or one devtools panel away from the room.
 *
 * Option text only, no `isCorrect`. Correctness is never needed to *push* a
 * question -- only to score it, which happens server-side later.
 */
@ObjectType()
export class PollableOption {
  @Field(() => ID) id: string;
  @Field() text: string;
  @Field(() => Int) orderIndex: number;
}

@ObjectType()
export class PollableQuestionEntity {
  @Field(() => ID) id: string;
  @Field() questionText: string;
  @Field(() => [PollableOption]) options: PollableOption[];

  @Field(() => AnswerKernel) kernel: AnswerKernel;
  @Field({ nullable: true }) typeLabel?: string;

  @Field({ nullable: true }) subjectName?: string;
  @Field({ nullable: true }) chapterName?: string;
  @Field({ nullable: true }) topicName?: string;
  @Field({ nullable: true }) subtopicName?: string;
  @Field({ nullable: true }) difficultyLabel?: string;
}
