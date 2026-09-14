import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuestionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { markDeleted, markRestored, notDeleted } from 'src/prisma/soft-delete';
import {
  AnswerKernel,
  QuestionStatus,
  TaxonomyKind,
} from '../question-bank.enums';
import {
  BankQuestionFilterInput,
  CreateBankQuestionInput,
  PaginationInput,
  UpdateBankQuestionInput,
} from '../dto/question-bank.inputs';
import {
  BankFacets,
  BankQuestionEntity,
  BankQuestionPage,
  PollableQuestionEntity,
} from '../entities/question-bank.entities';
import { QuestionValidationService } from '../validation/question-validation.service';
import { stemHash } from '../validation/normalize';

/**
 * Maps a kernel onto the legacy `Question.questionType` enum.
 *
 * That column is NOT NULL and still read by the test-scoped code, so every bank
 * question must carry a plausible value even though `questionTypeId` is now the
 * real answer. It is written, never read, by this service.
 */
const LEGACY_TYPE_FOR: Record<AnswerKernel, QuestionType> = {
  [AnswerKernel.SINGLE_CHOICE]: QuestionType.MCQ,
  [AnswerKernel.MULTI_CHOICE]: QuestionType.MCQ,
  [AnswerKernel.NUMERIC]: QuestionType.TEXT,
  [AnswerKernel.SHORT_TEXT]: QuestionType.TEXT,
  [AnswerKernel.LONG_TEXT]: QuestionType.TEXT,
  [AnswerKernel.MATCHING]: QuestionType.MCQ,
  [AnswerKernel.ORDERING]: QuestionType.MCQ,
  [AnswerKernel.CODE]: QuestionType.CODE,
};

const SORTABLE = new Set(['createdAt', 'updatedAt', 'marks']);

/** Primitive-only string coercion; objects become '' rather than
 *  "[object Object]". See QuestionValidationService.str. */
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

const DETAIL_INCLUDE = {
  typeDef: true,
  difficultyLevel: true,
  subject: true,
  chapter: true,
  topic: true,
  subtopic: true,
  group: { include: { _count: { select: { questions: true } } } },
  solutions: {
    where: { deletedAt: null },
    orderBy: [{ orderIndex: 'asc' as const }],
  },
  _count: { select: { usages: true } },
} satisfies Prisma.QuestionInclude;

type QuestionWithDetail = Prisma.QuestionGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

@Injectable()
export class BankQuestionsService {
  private readonly logger = new Logger(BankQuestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: QuestionValidationService,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async list(
    filter: BankQuestionFilterInput | undefined,
    pagination: PaginationInput | undefined,
    tenantId: string,
  ): Promise<BankQuestionPage> {
    const where = await this.buildWhere(filter, tenantId);

    const page = Math.max(1, pagination?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, pagination?.pageSize ?? 25));
    const sortBy = SORTABLE.has(pagination?.sortBy ?? '')
      ? pagination!.sortBy!
      : 'updatedAt';
    const sortDir = pagination?.sortDir === 'asc' ? 'asc' : 'desc';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.question.count({ where }),
      this.prisma.question.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const dupes = await this.duplicateHashes(
      tenantId,
      rows.map((r) => r.normalizedHash).filter((h): h is string => !!h),
    );

    return {
      items: rows.map((r) => this.toEntity(r, dupes)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findOne(id: string, tenantId: string): Promise<BankQuestionEntity> {
    const row = await this.prisma.question.findFirst({
      where: { id, tenantId },
      include: DETAIL_INCLUDE,
    });
    if (!row) throw new NotFoundException(`Question not found: ${id}`);

    const dupes = await this.duplicateHashes(
      tenantId,
      row.normalizedHash ? [row.normalizedHash] : [],
    );
    return this.toEntity(row, dupes);
  }

  async facets(
    filter: BankQuestionFilterInput | undefined,
    tenantId: string,
  ): Promise<BankFacets> {
    const where = await this.buildWhere(filter, tenantId);

    const [byStatus, byType, bySubject, total] = await Promise.all([
      this.prisma.question.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.question.groupBy({
        by: ['questionTypeId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.question.groupBy({
        by: ['subjectId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.question.count({ where }),
    ]);

    const byDifficulty = await this.prisma.question.groupBy({
      by: ['difficultyId'],
      where,
      _count: { _all: true },
    });
    const levels = await this.prisma.difficultyLevel.findMany({
      where: { tenantId },
      select: { id: true, label: true },
    });
    const levelLabel = new Map(levels.map((l) => [l.id, l.label]));

    const [types, subjects] = await Promise.all([
      this.prisma.questionTypeDef.findMany({
        where: { tenantId },
        select: { id: true, label: true },
      }),
      this.prisma.taxonomy.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      }),
    ]);

    const typeLabel = new Map(types.map((t) => [t.id, t.label]));
    const subjectLabel = new Map(subjects.map((s) => [s.id, s.name]));

    return {
      byStatus: byStatus.map((r) => ({
        key: r.status,
        label: r.status,
        count: r._count._all,
      })),
      byType: byType
        .filter((r) => r.questionTypeId)
        .map((r) => ({
          key: r.questionTypeId!,
          label: typeLabel.get(r.questionTypeId!) ?? 'Unknown',
          count: r._count._all,
        })),
      bySubject: bySubject
        .filter((r) => r.subjectId)
        .map((r) => ({
          key: r.subjectId!,
          label: subjectLabel.get(r.subjectId!) ?? 'Unknown',
          count: r._count._all,
        })),
      byDifficulty: byDifficulty
        .filter((r) => r.difficultyId)
        .map((r) => ({
          key: r.difficultyId!,
          label: levelLabel.get(r.difficultyId!) ?? 'Unknown',
          count: r._count._all,
        })),
      total,
    };
  }

  // ─── Writes ───────────────────────────────────────────────────────────

  async create(
    input: CreateBankQuestionInput,
    userId: string,
    tenantId: string,
  ): Promise<BankQuestionEntity> {
    const typeDef = await this.prisma.questionTypeDef.findFirst({
      where: { id: input.questionTypeId, tenantId, ...notDeleted() },
    });
    if (!typeDef) {
      throw new NotFoundException(
        `Question type not found: ${input.questionTypeId}`,
      );
    }

    const answer = this.validation.validateAnswer(
      typeDef.kernel,
      typeDef.config as Record<string, unknown> | null,
      input.mcqOptions,
      input.answerConfig,
    );
    await this.assertTaxonomyCoherent(input, tenantId);

    const created = await this.prisma.question.create({
      data: {
        tenantId,
        createdById: userId,
        testId: null,
        questionText: input.questionText,
        questionType: LEGACY_TYPE_FOR[typeDef.kernel],
        questionTypeId: typeDef.id,
        mcqOptions: answer.mcqOptions ?? Prisma.DbNull,
        answerConfig: answer.answerConfig ?? Prisma.DbNull,
        subjectId: input.subjectId ?? null,
        chapterId: input.chapterId ?? null,
        topicId: input.topicId ?? null,
        subtopicId: input.subtopicId ?? null,
        difficultyId: input.difficultyId ?? null,
        explanation: input.explanation ?? null,
        mediaUrl: input.mediaUrl ?? null,
        questionBankId: input.questionBankId ?? null,
        groupId: input.groupId ?? null,
        // Left to the column default (1) when omitted, rather than forced here,
        // so "no opinion" and "explicitly worth 1" stay the same thing.
        ...(input.marks != null ? { marks: input.marks } : {}),
        status: input.status ?? QuestionStatus.DRAFT,
        normalizedHash: stemHash(input.questionText),
        currentVersion: 1,
      },
      include: DETAIL_INCLUDE,
    });

    this.logger.log(`Created bank question ${created.id} (${typeDef.code})`);
    return this.toEntity(created, new Set());
  }

  /**
   * Updates a question and records the PRIOR state as a version row.
   *
   * The snapshot is taken before the write, so `QuestionVersion` holds what the
   * question looked like at version N while the live row moves to N+1. Any
   * QuestionUsage pinned to N therefore still has a faithful copy to render.
   */
  async update(
    id: string,
    input: UpdateBankQuestionInput,
    userId: string,
    tenantId: string,
  ): Promise<BankQuestionEntity> {
    const existing = await this.prisma.question.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: { typeDef: true },
    });
    if (!existing) throw new NotFoundException(`Question not found: ${id}`);

    const typeDef = input.questionTypeId
      ? await this.prisma.questionTypeDef.findFirst({
          where: { id: input.questionTypeId, tenantId, ...notDeleted() },
        })
      : existing.typeDef;

    if (!typeDef) {
      throw new BadRequestException(
        'This question has no type. Set questionTypeId to repair it.',
      );
    }

    // Re-validate whenever the type OR either payload changes: switching type
    // can invalidate an answer that was previously fine.
    const answerTouched =
      input.questionTypeId !== undefined ||
      input.mcqOptions !== undefined ||
      input.answerConfig !== undefined;

    let mcqOptions = existing.mcqOptions;
    let answerConfig = existing.answerConfig;

    if (answerTouched) {
      const validated = this.validation.validateAnswer(
        typeDef.kernel,
        typeDef.config as Record<string, unknown> | null,
        input.mcqOptions ?? this.optionsFromStored(existing.mcqOptions),
        input.answerConfig ??
          (existing.answerConfig as Record<string, unknown> | null) ??
          undefined,
      );
      mcqOptions = validated.mcqOptions as Prisma.JsonValue;
      answerConfig = validated.answerConfig as Prisma.JsonValue;
    }

    await this.assertTaxonomyCoherent(
      {
        subjectId: input.subjectId ?? existing.subjectId ?? undefined,
        chapterId: input.chapterId ?? existing.chapterId ?? undefined,
        topicId: input.topicId ?? existing.topicId ?? undefined,
        subtopicId: input.subtopicId ?? existing.subtopicId ?? undefined,
      },
      tenantId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.questionVersion.create({
        data: {
          questionId: existing.id,
          version: existing.currentVersion,
          snapshot: this.snapshot(existing),
          changedById: userId,
          changeNote: input.changeNote ?? null,
        },
      });

      return tx.question.update({
        where: { id: existing.id },
        data: {
          ...(input.questionText !== undefined
            ? {
                questionText: input.questionText,
                normalizedHash: stemHash(input.questionText),
              }
            : {}),
          ...(input.questionTypeId !== undefined
            ? {
                questionTypeId: typeDef.id,
                questionType: LEGACY_TYPE_FOR[typeDef.kernel],
              }
            : {}),
          ...(answerTouched
            ? {
                mcqOptions: (mcqOptions ??
                  Prisma.DbNull) as Prisma.InputJsonValue,
                answerConfig: (answerConfig ??
                  Prisma.DbNull) as Prisma.InputJsonValue,
              }
            : {}),
          ...(input.subjectId !== undefined
            ? { subjectId: input.subjectId }
            : {}),
          ...(input.chapterId !== undefined
            ? { chapterId: input.chapterId }
            : {}),
          ...(input.topicId !== undefined ? { topicId: input.topicId } : {}),
          // subtopicId was validated by assertTaxonomyCoherent above but never
          // written here, so re-filing a question to a different subtopic was
          // accepted and then silently dropped.
          ...(input.subtopicId !== undefined
            ? { subtopicId: input.subtopicId }
            : {}),
          ...(input.difficultyId !== undefined
            ? { difficultyId: input.difficultyId }
            : {}),
          ...(input.explanation !== undefined
            ? { explanation: input.explanation }
            : {}),
          ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl } : {}),
          ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
          ...(input.marks !== undefined ? { marks: input.marks } : {}),
          currentVersion: { increment: 1 },
        },
        include: DETAIL_INCLUDE,
      });
    });

    this.logger.log(
      `Updated question ${id} to version ${updated.currentVersion}`,
    );
    return this.toEntity(updated, new Set());
  }

  async setStatus(
    id: string,
    status: QuestionStatus,
    userId: string,
    tenantId: string,
  ): Promise<BankQuestionEntity> {
    const existing = await this.prisma.question.findFirst({
      where: { id, tenantId, ...notDeleted() },
      select: { id: true, status: true, questionTypeId: true },
    });
    if (!existing) throw new NotFoundException(`Question not found: ${id}`);

    if (status === QuestionStatus.APPROVED && !existing.questionTypeId) {
      throw new BadRequestException(
        'Set a question type before approving this question.',
      );
    }

    const row = await this.prisma.question.update({
      where: { id },
      data: { status },
      include: DETAIL_INCLUDE,
    });

    this.logger.log(
      `Question ${id} status ${existing.status} -> ${status} by ${userId}`,
    );
    return this.toEntity(row, new Set());
  }

  /**
   * Soft delete. Refused while the question is used by any assessment: those
   * rows hold a snapshot, but the FK is RESTRICT and the "Used in" list would
   * point at something the bank claims no longer exists.
   */
  async remove(id: string, userId: string, tenantId: string): Promise<boolean> {
    const row = await this.prisma.question.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: { _count: { select: { usages: true } } },
    });
    if (!row) throw new NotFoundException(`Question not found: ${id}`);

    if (row._count.usages > 0) {
      throw new ConflictException(
        `This question is used by ${row._count.usages} assessment(s). ` +
          `Retire it instead — retired questions stay out of new tests but keep ` +
          `historical results intact.`,
      );
    }

    await this.prisma.question.update({
      where: { id },
      data: { ...markDeleted(userId), status: QuestionStatus.RETIRED },
    });
    return true;
  }

  async restore(id: string, tenantId: string): Promise<BankQuestionEntity> {
    const row = await this.prisma.question.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });
    if (!row) throw new NotFoundException(`Deleted question not found: ${id}`);

    const restored = await this.prisma.question.update({
      where: { id },
      data: { ...markRestored(), status: QuestionStatus.DRAFT },
      include: DETAIL_INCLUDE,
    });
    return this.toEntity(restored, new Set());
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async buildWhere(
    filter: BankQuestionFilterInput | undefined,
    tenantId: string,
  ): Promise<Prisma.QuestionWhereInput> {
    const where: Prisma.QuestionWhereInput = { tenantId };

    if (!filter?.includeDeleted) where.deletedAt = null;
    if (filter?.search?.trim()) {
      const q = filter.search.trim();
      const like = { contains: q, mode: 'insensitive' as const };
      where.OR = [
        { questionText: like },
        { subject: { name: like } },
        { chapter: { name: like } },
        { topic: { name: like } },
        { subtopic: { name: like } },
        { typeDef: { OR: [{ label: like }, { code: like }] } },
        { difficultyLevel: { OR: [{ label: like }, { code: like }] } },
      ];
    }
    if (filter?.subjectIds?.length) where.subjectId = { in: filter.subjectIds };
    if (filter?.chapterIds?.length) where.chapterId = { in: filter.chapterIds };
    if (filter?.topicIds?.length) where.topicId = { in: filter.topicIds };
    if (filter?.subtopicIds?.length) {
      where.subtopicId = { in: filter.subtopicIds };
    }
    if (filter?.questionTypeIds?.length) {
      where.questionTypeId = { in: filter.questionTypeIds };
    }
    if (filter?.statuses?.length) where.status = { in: filter.statuses };
    if (filter?.questionBankId) where.questionBankId = filter.questionBankId;

    if (filter?.difficultyIds?.length) {
      where.difficultyId = { in: filter.difficultyIds };
    }

    if (filter?.duplicatesOnly) {
      const hashes = await this.allDuplicateHashes(tenantId);
      // An empty `in` matches nothing, which is the correct result when the
      // tenant has no duplicates at all.
      where.normalizedHash = { in: hashes };
    }

    return where;
  }

  /** Hashes shared by two or more live questions in the tenant. */
  private async allDuplicateHashes(tenantId: string): Promise<string[]> {
    const groups = await this.prisma.question.groupBy({
      by: ['normalizedHash'],
      where: { tenantId, ...notDeleted(), normalizedHash: { not: null } },
      _count: { _all: true },
      having: { normalizedHash: { _count: { gt: 1 } } },
    });
    return groups
      .map((g) => g.normalizedHash)
      .filter((h): h is string => h !== null);
  }

  /** Restricted to the hashes on the current page, so the check stays cheap. */
  private async duplicateHashes(
    tenantId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();

    const groups = await this.prisma.question.groupBy({
      by: ['normalizedHash'],
      where: {
        tenantId,
        ...notDeleted(),
        normalizedHash: { in: [...new Set(hashes)] },
      },
      _count: { _all: true },
      having: { normalizedHash: { _count: { gt: 1 } } },
    });

    return new Set(
      groups
        .map((g) => g.normalizedHash)
        .filter((h): h is string => h !== null),
    );
  }

  /**
   * Asserts the supplied taxonomy ids form one real path down the tree.
   *
   * Checks three things, because each catches a different mistake:
   *
   *   1. every id exists, in this tenant, and is not deleted;
   *   2. every id sits at the level it was passed as -- a chapter id handed in
   *      as `topicId` is rejected rather than silently filed one level off;
   *   3. every supplied id appears in the ancestor chain of the deepest one.
   *
   * (3) is what makes gaps safe. The levels are all optional, so a question may
   * be filed at Subject only, or at Subject + Topic with no Chapter. The old
   * pairwise check compared adjacent levels and therefore validated nothing at
   * all when the level between two supplied ones was blank -- a Physics subject
   * with a Chemistry topic passed. Walking the chain instead means a missing
   * level is genuinely optional rather than an unchecked hole, which the Word
   * importer depends on: it resolves each column independently and a document
   * that names Subject and Topic but not Chapter is entirely normal.
   */
  /**
   * Approved choice questions, stripped of their answer key, for the live-poll
   * host picker.
   *
   * Separate from `list()` on purpose. `list()` returns BankQuestionEntity,
   * which carries `mcqOptions` including `isCorrect`; this returns option text
   * only. See PollableQuestionEntity for why the desktop app must not receive
   * the key.
   *
   * Only APPROVED questions are offered: pushing a draft to a live class puts
   * unreviewed wording in front of a room, and there is no way to take it back.
   */
  async listPollable(
    filter: BankQuestionFilterInput | undefined,
    tenantId: string,
    limit = 50,
  ): Promise<PollableQuestionEntity[]> {
    const where = await this.buildWhere(filter, tenantId);

    const rows = await this.prisma.question.findMany({
      where: {
        ...where,
        deletedAt: null,
        status: QuestionStatus.APPROVED,
        typeDef: {
          kernel: {
            in: [AnswerKernel.SINGLE_CHOICE, AnswerKernel.MULTI_CHOICE],
          },
        },
      },
      include: DETAIL_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });

    const out: PollableQuestionEntity[] = [];
    for (const r of rows) {
      const stored = this.optionsFromStored(r.mcqOptions);
      if (!stored || stored.length < 2) continue;

      out.push({
        id: r.id,
        questionText: r.questionText,
        // isCorrect is dropped here and nowhere else -- do not "simplify" this
        // by returning `stored` directly.
        options: stored.map((o, i) => ({
          id: o.id ?? `opt_${i}`,
          text: o.text,
          orderIndex: i,
        })),
        kernel: r.typeDef?.kernel as AnswerKernel,
        typeLabel: r.typeDef?.label,
        subjectName: r.subject?.name,
        chapterName: r.chapter?.name,
        topicName: r.topic?.name,
        subtopicName: r.subtopic?.name,
        difficultyLabel: r.difficultyLevel?.label,
      });
    }
    return out;
  }

  private async assertTaxonomyCoherent(
    input: {
      subjectId?: string;
      chapterId?: string;
      topicId?: string;
      subtopicId?: string;
    },
    tenantId: string,
  ): Promise<void> {
    type Node = {
      id: string;
      kind: TaxonomyKind;
      parentId: string | null;
      name: string;
    };
    type Level = { id: string; kind: TaxonomyKind; label: string };

    const LEVELS: { id?: string; kind: TaxonomyKind; label: string }[] = [
      { id: input.subjectId, kind: TaxonomyKind.SUBJECT, label: 'subject' },
      { id: input.chapterId, kind: TaxonomyKind.CHAPTER, label: 'chapter' },
      { id: input.topicId, kind: TaxonomyKind.TOPIC, label: 'topic' },
      { id: input.subtopicId, kind: TaxonomyKind.SUBTOPIC, label: 'subtopic' },
    ];

    const supplied: Level[] = [];
    for (const level of LEVELS) {
      if (level.id) supplied.push({ ...level, id: level.id });
    }
    if (supplied.length === 0) return;

    const rows = await this.prisma.taxonomy.findMany({
      where: {
        id: { in: supplied.map((l) => l.id) },
        tenantId,
        ...notDeleted(),
      },
      select: { id: true, kind: true, parentId: true, name: true },
    });
    const byId = new Map<string, Node>(rows.map((r) => [r.id, r]));

    for (const level of supplied) {
      const row = byId.get(level.id);
      if (!row) throw new NotFoundException(`Taxonomy not found: ${level.id}`);
      if (row.kind !== level.kind) {
        throw new BadRequestException(
          `"${row.name}" is a ${row.kind.toLowerCase()}, not a ${level.label}.`,
        );
      }
    }

    // Walk up from the deepest supplied node. The tree is four levels, so this
    // is at most three extra lookups and they are all primary-key reads.
    const deepest = supplied[supplied.length - 1];
    const chain = new Map<TaxonomyKind, string>();
    let cursor: Node | null = byId.get(deepest.id)!;
    chain.set(cursor.kind, cursor.id);

    while (cursor?.parentId) {
      const parent: Node | null = await this.prisma.taxonomy.findFirst({
        where: { id: cursor.parentId, tenantId, ...notDeleted() },
        select: { id: true, kind: true, parentId: true, name: true },
      });
      // A parent that is missing or deleted leaves the chain short; the loop
      // below then reports the specific level that does not line up.
      if (!parent) break;
      chain.set(parent.kind, parent.id);
      cursor = parent;
    }

    for (const level of supplied) {
      if (chain.get(level.kind) !== level.id) {
        const name = byId.get(level.id)!.name;
        throw new BadRequestException(
          `The selected ${deepest.label} does not sit under the selected ` +
            `${level.label} ("${name}").`,
        );
      }
    }
  }

  private optionsFromStored(stored: Prisma.JsonValue | null) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return undefined;
    }
    const opts = (stored as { options?: unknown }).options;
    if (!Array.isArray(opts)) return undefined;
    return opts.map((o) => {
      const r = o as Record<string, unknown>;
      return {
        id: r.id ? str(r.id) : undefined,
        text: str(r.text),
        isCorrect: r.isCorrect === true,
      };
    });
  }

  private snapshot(q: {
    questionText: string;
    marks: number;
    questionTypeId: string | null;
    mcqOptions: Prisma.JsonValue | null;
    answerConfig: Prisma.JsonValue | null;
    difficultyId: string | null;
    subjectId: string | null;
    chapterId: string | null;
    topicId: string | null;
    subtopicId: string | null;
    explanation: string | null;
    status: string;
  }) {
    return {
      questionText: q.questionText,
      marks: q.marks,
      questionTypeId: q.questionTypeId,
      mcqOptions: q.mcqOptions,
      answerConfig: q.answerConfig,
      difficultyId: q.difficultyId,
      subjectId: q.subjectId,
      chapterId: q.chapterId,
      topicId: q.topicId,
      subtopicId: q.subtopicId,
      explanation: q.explanation,
      status: q.status,
    };
  }

  private toEntity(
    r: QuestionWithDetail,
    duplicateHashes: Set<string>,
  ): BankQuestionEntity {
    const node = (t: typeof r.subject) =>
      t
        ? {
            id: t.id,
            kind: t.kind,
            name: t.name,
            code: t.code ?? undefined,
            parentId: t.parentId ?? undefined,
            orderIndex: t.orderIndex,
            isActive: t.isActive,
            questionCount: 0,
          }
        : undefined;

    return {
      id: r.id,
      questionText: r.questionText,
      typeDef: r.typeDef
        ? {
            id: r.typeDef.id,
            code: r.typeDef.code,
            label: r.typeDef.label,
            kernel: r.typeDef.kernel,
            config: r.typeDef.config ?? undefined,
            layoutHint: r.typeDef.layoutHint ?? undefined,
            icon: r.typeDef.icon ?? undefined,
            color: r.typeDef.color ?? undefined,
            aliases: r.typeDef.aliases,
            isActive: r.typeDef.isActive,
            orderIndex: r.typeDef.orderIndex,
            questionCount: 0,
          }
        : undefined,
      subject: node(r.subject),
      chapter: node(r.chapter),
      topic: node(r.topic),
      subtopic: node(r.subtopic),
      difficulty: r.difficultyLevel
        ? {
            id: r.difficultyLevel.id,
            code: r.difficultyLevel.code,
            label: r.difficultyLevel.label,
            aliases: r.difficultyLevel.aliases,
            color: r.difficultyLevel.color ?? undefined,
            orderIndex: r.difficultyLevel.orderIndex,
            isActive: r.difficultyLevel.isActive,
            questionCount: 0,
          }
        : undefined,
      mcqOptions: r.mcqOptions ?? undefined,
      answerConfig: r.answerConfig ?? undefined,
      status: r.status,
      currentVersion: r.currentVersion,
      marks: r.marks,
      explanation: r.explanation ?? undefined,
      mediaUrl: r.mediaUrl ?? undefined,
      questionBankId: r.questionBankId ?? undefined,
      group: r.group
        ? {
            id: r.group.id,
            title: r.group.title ?? undefined,
            passageHtml: r.group.passageHtml ?? undefined,
            questionCount: r.group._count.questions,
          }
        : undefined,
      solutions: r.solutions.map((s) => ({
        id: s.id,
        kind: s.kind,
        contentHtml: s.contentHtml ?? undefined,
        videoProvider: s.videoProvider ?? undefined,
        videoUrl: s.videoUrl ?? undefined,
        durationSec: s.durationSec ?? undefined,
        language: s.language ?? undefined,
        visibility: s.visibility,
        orderIndex: s.orderIndex,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      usageCount: r._count.usages,
      normalizedHash: r.normalizedHash ?? undefined,
      hasDuplicate: r.normalizedHash
        ? duplicateHashes.has(r.normalizedHash)
        : false,
      createdById: r.createdById ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
