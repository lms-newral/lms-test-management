import { Injectable, Logger } from '@nestjs/common';
import { AnswerKernel, Prisma, TaxonomyKind } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * The starter kit every institute needs for JEE/NEET-style tests: subjects,
 * the standard question types and difficulty levels.
 *
 * Two entry points:
 *  - ensureStarterKit: the first time an institute's bank is opened and it is
 *    completely empty. An institute that has anything -- even rows it deleted --
 *    is left alone, so deleted defaults never come back.
 *  - ensureFor: when a test-format template is used, any subject or question
 *    type it needs that the institute lacks is created, so a template is one
 *    click with nothing to map.
 */

export const DEFAULT_SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];

export const DEFAULT_QUESTION_TYPES: Array<{
  code: string;
  label: string;
  kernel: AnswerKernel;
  aliases: string[];
  config?: Prisma.InputJsonValue;
  layoutHint?: string;
}> = [
  { code: 'SCQ', label: 'Single Correct', kernel: AnswerKernel.SINGLE_CHOICE, aliases: ['SINGLE_CORRECT', 'SINGLE_CHOICE', 'SINGLE_CORRECT_QUESTION'], config: { minOptions: 2, maxOptions: 6, defaultOptions: 4, negativeMarks: -1 } },
  { code: 'MCQ', label: 'Multiple Correct', kernel: AnswerKernel.MULTI_CHOICE, aliases: ['MULTIPLE_CORRECT', 'MULTIPLE_CHOICE', 'MULTI_CORRECT'], config: { minOptions: 2, maxOptions: 6, defaultOptions: 4, partialMarking: true, negativeMarks: -2 } },
  { code: 'TF', label: 'True / False', kernel: AnswerKernel.SINGLE_CHOICE, aliases: ['TRUE_FALSE', 'TRUEFALSE'], config: { fixedOptions: ['True', 'False'] }, layoutHint: 'true_false' },
  {
    code: 'AR',
    label: 'Assertion & Reason',
    kernel: AnswerKernel.SINGLE_CHOICE,
    aliases: ['ASSERTION_REASON', 'ASSERTIONS_REASONS', 'ASSERTION_AND_REASON'],
    config: {
      fixedOptions: [
        'Both A and R are true and R is the correct explanation of A',
        'Both A and R are true but R is not the correct explanation of A',
        'A is true but R is false',
        'A is false but R is true',
      ],
    },
    layoutHint: 'assertion_reason',
  },
  { code: 'NAT', label: 'Numerical Answer Type', kernel: AnswerKernel.NUMERIC, aliases: ['NUMERICAL', 'NUMERIC', 'NUM', 'NUMERICALS'], config: { tolerance: 0.01 } },
  { code: 'INT', label: 'Integer Type', kernel: AnswerKernel.NUMERIC, aliases: ['INTEGER', 'INTEGER_TYPE'], config: { tolerance: 0, integerOnly: true } },
  { code: 'MATCH', label: 'Match the Following', kernel: AnswerKernel.MATCHING, aliases: ['MATCH_COLUMN', 'MATCH_THE_COLUMN', 'MTC', 'MATCHING'], config: { leftCount: 4, rightCount: 4 } },
  { code: 'FILL', label: 'Fill in the Blank', kernel: AnswerKernel.SHORT_TEXT, aliases: ['FILL_IN_THE_BLANK', 'BLANK', 'FIB'], config: { caseSensitive: false, trimWhitespace: true } },
  { code: 'SUBJ', label: 'Subjective', kernel: AnswerKernel.LONG_TEXT, aliases: ['SUBJECTIVE', 'DESCRIPTIVE', 'LONG_ANSWER'], config: { manualGrading: true } },
  { code: 'CODE', label: 'Coding', kernel: AnswerKernel.CODE, aliases: ['CODING', 'PROGRAMMING'] },
];

export const DEFAULT_DIFFICULTIES = [
  { code: 'EASY', label: 'Easy', aliases: ['SIMPLE', 'LOW', 'BEGINNER'], color: '#16a34a' },
  { code: 'MODERATE', label: 'Moderate', aliases: ['MEDIUM', 'INTERMEDIATE', 'AVERAGE'], color: '#ca8a04' },
  { code: 'TOUGH', label: 'Tough', aliases: ['HARD', 'DIFFICULT', 'HIGH', 'ADVANCED'], color: '#dc2626' },
  { code: 'OPEN', label: 'Open', aliases: ['OPEN_ENDED'], color: '#6366f1' },
];

@Injectable()
export class BankDefaultsService {
  private readonly logger = new Logger(BankDefaultsService.name);
  /** Tenants already checked by this process, so an open bank costs no extra queries. */
  private readonly checked = new Set<string>();
  /** One check per tenant at a time: the bank screen fires three queries at once. */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  ensureStarterKit(tenantId: string, userId?: string): Promise<void> {
    if (this.checked.has(tenantId)) return Promise.resolve();
    let run = this.inflight.get(tenantId);
    if (!run) {
      run = this.seedIfEmpty(tenantId, userId).finally(() => {
        this.inflight.delete(tenantId);
      });
      this.inflight.set(tenantId, run);
    }
    return run;
  }

  /** Creates whichever of these subjects and question types the institute lacks. */
  async ensureFor(
    tenantId: string,
    subjectNames: string[],
    typeCodes: string[],
    userId?: string,
  ): Promise<void> {
    const [subjects, types] = await Promise.all([
      this.prisma.taxonomy.findMany({
        where: { tenantId, kind: TaxonomyKind.SUBJECT, parentId: null, deletedAt: null },
        select: { name: true },
      }),
      this.prisma.questionTypeDef.findMany({
        where: { tenantId, deletedAt: null },
        select: { code: true },
      }),
    ]);
    const haveSubjects = new Set(subjects.map((s) => s.name.trim().toLowerCase()));
    const haveTypes = new Set(types.map((t) => t.code.toUpperCase()));

    const missingSubjects = [...new Set(subjectNames)].filter((n) => !haveSubjects.has(n.trim().toLowerCase()));
    const missingTypes = DEFAULT_QUESTION_TYPES.filter(
      (t) => typeCodes.some((c) => c.toUpperCase() === t.code) && !haveTypes.has(t.code),
    );

    if (missingSubjects.length) await this.createSubjects(tenantId, missingSubjects, userId);
    if (missingTypes.length) await this.createTypes(tenantId, missingTypes, userId);
  }

  private async seedIfEmpty(tenantId: string, userId?: string) {
    // Counts include deleted rows on purpose: an institute that cleared its
    // bank made a choice, and must not be refilled behind its back.
    const [taxonomy, types, difficulty] = await Promise.all([
      this.prisma.taxonomy.count({ where: { tenantId } }),
      this.prisma.questionTypeDef.count({ where: { tenantId } }),
      this.prisma.difficultyLevel.count({ where: { tenantId } }),
    ]);
    if (taxonomy === 0 && types === 0 && difficulty === 0) {
      await this.createSubjects(tenantId, DEFAULT_SUBJECTS, userId);
      await this.createTypes(tenantId, DEFAULT_QUESTION_TYPES, userId);
      await this.prisma.difficultyLevel.createMany({
        data: DEFAULT_DIFFICULTIES.map((d, i) => ({ tenantId, ...d, orderIndex: i + 1, createdById: userId ?? null })),
        skipDuplicates: true,
      });
      this.logger.log(`Starter kit created for tenant ${tenantId}`);
    }
    this.checked.add(tenantId);
  }

  // skipDuplicates makes both safe if two requests race: the unique indexes
  // (root subject name, type code) turn the second insert into a no-op.
  private createSubjects(tenantId: string, names: string[], userId?: string) {
    return this.prisma.taxonomy.createMany({
      data: names.map((name, i) => ({
        tenantId,
        kind: TaxonomyKind.SUBJECT,
        name,
        parentId: null,
        orderIndex: i,
        createdById: userId ?? null,
      })),
      skipDuplicates: true,
    });
  }

  private createTypes(
    tenantId: string,
    list: typeof DEFAULT_QUESTION_TYPES,
    userId?: string,
  ) {
    return this.prisma.questionTypeDef.createMany({
      data: list.map((t) => ({
        tenantId,
        code: t.code,
        label: t.label,
        kernel: t.kernel,
        aliases: t.aliases,
        config: t.config ?? Prisma.DbNull,
        layoutHint: t.layoutHint ?? null,
        orderIndex: DEFAULT_QUESTION_TYPES.findIndex((d) => d.code === t.code),
        createdById: userId ?? null,
      })),
      skipDuplicates: true,
    });
  }
}
