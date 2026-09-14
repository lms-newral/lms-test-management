import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TestFormatStatus, TestSeriesStatus, TestStatus, UsageType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { markDeleted, notDeleted } from 'src/prisma/soft-delete';
import { S3Service } from 'src/common/services/s3.service';
import {
  PlacedQuestion,
  RowSlot,
  detailProblems,
  pickProblem,
  publishProblems,
  publishedEditProblem,
  visibleText,
} from './test-format.logic';
import {
  FORMAT_INCLUDE,
  FormatWithTree,
  TestFormatsService,
  toFormatEntity,
} from './test-formats.service';
import { SNAPSHOT_INCLUDE, buildQuestionSnapshot } from './test-snapshot';
import { CreateTestInput, UpdateTestInput } from './dto/test-management.inputs';
import {
  TestEntity,
  TestSummaryEntity,
} from './entities/test-management.entities';

const TEST_INCLUDE = {
  format: { include: FORMAT_INCLUDE },
  syllabi: true,
  questions: {
    orderBy: [{ orderIndex: 'asc' as const }],
    include: {
      question: {
        select: {
          id: true,
          questionText: true,
          status: true,
          deletedAt: true,
          subjectId: true,
          questionTypeId: true,
          mcqOptions: true,
          answerConfig: true,
          explanation: true,
          typeDef: { select: { code: true, kernel: true } },
        },
      },
    },
  },
} satisfies Prisma.TestInclude;

type TestWithDetail = Prisma.TestGetPayload<{ include: typeof TEST_INCLUDE }>;

const PUBLISHED_MESSAGE =
  'This test is published, so its questions and syllabus are frozen. Unpublish it first (only possible before anyone attempts it).';

const plain = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/** The test's details and syllabus, as the publish rules see them. */
const detailsOf = (t: {
  name: string;
  year: number | null;
  descriptionHtml: string | null;
  syllabi: { formatSubjectId: string; syllabusHtml: string | null }[];
  format: { subjects: { id: string; subjectName: string }[] };
}) => ({
  name: t.name,
  year: t.year,
  descriptionHtml: t.descriptionHtml,
  syllabi: t.format.subjects.map((s) => ({
    subjectName: s.subjectName,
    syllabusHtml: t.syllabi.find((x) => x.formatSubjectId === s.id)?.syllabusHtml ?? null,
  })),
});

/** Options as stored on a bank question: { options: [{ text, isCorrect }] }. */
const optionsOf = (stored: Prisma.JsonValue | null) => {
  const list =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as { options?: unknown }).options
      : undefined;
  return Array.isArray(list)
    ? list.map((o) => {
        const r = (o ?? {}) as Record<string, unknown>;
        return { text: typeof r.text === 'string' ? r.text : '', isCorrect: r.isCorrect === true };
      })
    : [];
};

/** The rows of a format, in paper order, as the rules see them. */
export function slotsOf(f: FormatWithTree): RowSlot[] {
  return f.subjects.flatMap((s) =>
    s.sections.flatMap((sec) =>
      sec.rows.map((r, ri) => ({
        rowId: r.id,
        label:
          `${s.subjectName} › ${sec.name} › ${r.questionTypeCode}` +
          (sec.rows.length > 1 ? ` #${ri + 1}` : ''),
        subjectId: s.subjectId,
        questionTypeId: r.questionTypeId,
        questionCount: r.questionCount,
      })),
    ),
  );
}

@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formats: TestFormatsService,
    private readonly s3: S3Service,
  ) {}

  async list(tenantId: string, status?: TestStatus): Promise<TestSummaryEntity[]> {
    const rows = await this.prisma.test.findMany({
      where: { tenantId, ...notDeleted(), ...(status ? { status } : {}) },
      include: {
        format: {
          select: {
            name: true,
            durationMinutes: true,
            subjects: {
              orderBy: [{ orderIndex: 'asc' }],
              select: {
                id: true,
                subjectName: true,
                totalMarks: true,
                sections: { select: { rows: { select: { id: true, questionCount: true } } } },
              },
            },
          },
        },
        syllabi: { select: { formatSubjectId: true, syllabusHtml: true } },
        questions: { select: { rowId: true } },
        seriesNodes: { where: { series: notDeleted() }, select: { id: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((t) => {
      const rowsOf = t.format.subjects.flatMap((s) => s.sections.flatMap((sec) => sec.rows));
      const filled = rowsOf.every((r) => t.questions.filter((q) => q.rowId === r.id).length === r.questionCount);
      return {
        id: t.id,
        name: t.name,
        year: t.year ?? undefined,
        status: t.status,
        formatId: t.formatId,
        formatName: t.format.name,
        durationMinutes: t.durationMinutes ?? t.format.durationMinutes,
        picked: t.questions.length,
        required: rowsOf.reduce((n, r) => n + r.questionCount, 0),
        totalMarks: t.format.subjects.reduce((n, s) => n + Number(s.totalMarks), 0),
        subjects: t.format.subjects.map((s) => s.subjectName),
        syllabusDone: t.syllabi.filter((s) => visibleText(s.syllabusHtml)).length,
        hasDescription: !!visibleText(t.descriptionHtml),
        plannerFileName: t.plannerFileName ?? undefined,
        seriesCount: t.seriesNodes.length,
        ready: t.status === TestStatus.DRAFT && filled && detailProblems(detailsOf(t)).length === 0,
        publishedAt: t.publishedAt ?? undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    });
  }

  async findOne(id: string, tenantId: string): Promise<TestEntity> {
    const t = await this.prisma.test.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: TEST_INCLUDE,
    });
    if (!t) throw new NotFoundException(`Test not found: ${id}`);
    return this.toEntity(t);
  }

  async create(input: CreateTestInput, userId: string, tenantId: string) {
    const format = await this.prisma.testFormat.findFirst({
      where: { id: input.formatId, tenantId, ...notDeleted() },
      select: { id: true, status: true, subjects: { select: { id: true } } },
    });
    if (!format) throw new NotFoundException('Test format not found');
    if (format.status !== TestFormatStatus.ACTIVE) {
      throw new BadRequestException('Only an active format can be used to build a test.');
    }

    const created = await this.prisma.test.create({
      data: {
        tenantId,
        formatId: format.id,
        name: input.name.trim(),
        year: input.year ?? null,
        descriptionHtml: input.descriptionHtml ?? null,
        durationMinutes: input.durationMinutes ?? null,
        createdById: userId,
        syllabi: { create: format.subjects.map((s) => ({ formatSubjectId: s.id })) },
      },
    });
    return this.findOne(created.id, tenantId);
  }

  async update(id: string, input: UpdateTestInput, tenantId: string) {
    const t = await this.findOwned(id, tenantId);

    const changes: Prisma.TestUpdateInput = {};
    const changed: string[] = [];
    if (input.name !== undefined && input.name.trim() !== t.name) {
      changes.name = input.name.trim();
      changed.push('name');
    }
    if (input.year !== undefined && input.year !== t.year) {
      changes.year = input.year;
      changed.push('year');
    }
    if (input.descriptionHtml !== undefined && input.descriptionHtml !== t.descriptionHtml) {
      changes.descriptionHtml = input.descriptionHtml;
      changed.push('descriptionHtml');
    }
    if (input.durationMinutes !== undefined && input.durationMinutes !== t.durationMinutes) {
      changes.durationMinutes = input.durationMinutes;
      changed.push('durationMinutes');
    }

    if (t.status !== TestStatus.DRAFT) {
      const problem = publishedEditProblem(changed);
      if (problem) throw new ConflictException(problem);
    }
    if (changed.length) {
      await this.prisma.test.update({ where: { id }, data: changes });
    }
    return this.findOne(id, tenantId);
  }

  async setSyllabus(
    testId: string,
    formatSubjectId: string,
    syllabusHtml: string | null,
    tenantId: string,
  ) {
    const t = await this.findOwned(testId, tenantId);
    this.assertDraft(t.status);
    const subject = await this.prisma.testFormatSubject.findFirst({
      where: { id: formatSubjectId, formatId: t.formatId },
      select: { id: true },
    });
    if (!subject) throw new NotFoundException("That subject is not part of this test's format.");

    await this.prisma.testSubjectSyllabus.upsert({
      where: { testId_formatSubjectId: { testId, formatSubjectId } },
      create: { testId, formatSubjectId, syllabusHtml },
      update: { syllabusHtml },
    });
    return this.findOne(testId, tenantId);
  }

  async createPlannerUpload(testId: string, fileName: string, tenantId: string) {
    await this.findOwned(testId, tenantId);
    if (!/\.pdf$/i.test(fileName.trim())) {
      throw new BadRequestException('The planner must be a PDF.');
    }
    const upload = await this.s3.getTestPlannerUploadUrl(tenantId, testId, fileName);
    return { uploadUrl: upload.uploadUrl, key: upload.key, expiresIn: upload.expiresIn };
  }

  async setPlanner(
    testId: string,
    key: string | null,
    fileName: string | null,
    tenantId: string,
  ) {
    await this.findOwned(testId, tenantId);
    // Only accept an object this tenant was given an upload slot for, so a
    // planner can never be pointed at another institute's file.
    if (key && !key.startsWith(`tenants/${tenantId}/tests/${testId}/planner/`)) {
      throw new BadRequestException('That file was not uploaded for this test.');
    }
    await this.prisma.test.update({
      where: { id: testId },
      data: { plannerFileKey: key, plannerFileName: key ? fileName : null },
    });
    return this.findOne(testId, tenantId);
  }

  /** All-or-nothing: if any question can't go in, none do, and every reason is listed. */
  async addQuestions(
    testId: string,
    rowId: string,
    questionIds: string[],
    tenantId: string,
  ) {
    const t = await this.findOwned(testId, tenantId);
    this.assertDraft(t.status);
    const row = await this.findRow(rowId, t.formatId);

    const ids = [...new Set(questionIds)];
    if (!ids.length) throw new BadRequestException('Choose at least one question.');
    const questions = await this.prisma.question.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, questionText: true, subjectId: true, questionTypeId: true, deletedAt: true },
    });
    const byId = new Map(questions.map((q) => [q.id, q]));
    const notFound = ids.filter((id) => !byId.has(id));
    if (notFound.length) throw new NotFoundException(`Question(s) not found: ${notFound.join(', ')}`);

    const existing = await this.prisma.testQuestion.findMany({
      where: { testId },
      select: { questionId: true, rowId: true, orderIndex: true },
    });
    const inTest = new Set(existing.map((e) => e.questionId));
    const inRow = existing.filter((e) => e.rowId === rowId);
    let count = inRow.length;
    let order = inRow.reduce((m, e) => Math.max(m, e.orderIndex), -1);

    const problems: string[] = [];
    const data: Prisma.TestQuestionCreateManyInput[] = [];
    for (const id of ids) {
      const q = byId.get(id)!;
      const problem = pickProblem(
        row.slot,
        count,
        { questionId: id, subjectId: q.subjectId, questionTypeId: q.questionTypeId, deleted: !!q.deletedAt },
        inTest.has(id),
      );
      if (problem) {
        problems.push(`"${plain(q.questionText)}": ${problem}`);
        continue;
      }
      data.push({ testId, rowId, questionId: id, orderIndex: ++order });
      inTest.add(id);
      count++;
    }
    if (problems.length) {
      throw new BadRequestException(`No questions were added:\n${problems.map((p) => `• ${p}`).join('\n')}`);
    }

    await this.prisma.testQuestion.createMany({ data });
    return this.findOne(testId, tenantId);
  }

  async removeQuestion(testId: string, questionId: string, tenantId: string) {
    const t = await this.findOwned(testId, tenantId);
    this.assertDraft(t.status);
    const pick = await this.prisma.testQuestion.findUnique({
      where: { testId_questionId: { testId, questionId } },
      select: { id: true, rowId: true },
    });
    if (!pick) throw new NotFoundException('That question is not in this test.');

    const rest = await this.prisma.testQuestion.findMany({
      where: { testId, rowId: pick.rowId, NOT: { id: pick.id } },
      orderBy: [{ orderIndex: 'asc' }],
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.testQuestion.delete({ where: { id: pick.id } }),
      ...rest.map((r, i) =>
        this.prisma.testQuestion.update({ where: { id: r.id }, data: { orderIndex: i } }),
      ),
    ]);
    return this.findOne(testId, tenantId);
  }

  async reorderQuestions(
    testId: string,
    rowId: string,
    orderedQuestionIds: string[],
    tenantId: string,
  ) {
    const t = await this.findOwned(testId, tenantId);
    this.assertDraft(t.status);
    await this.findRow(rowId, t.formatId);

    const current = await this.prisma.testQuestion.findMany({
      where: { testId, rowId },
      select: { id: true, questionId: true },
    });
    const byQuestion = new Map(current.map((c) => [c.questionId, c.id]));
    const sameSet =
      orderedQuestionIds.length === current.length &&
      new Set(orderedQuestionIds).size === current.length &&
      orderedQuestionIds.every((q) => byQuestion.has(q));
    if (!sameSet) {
      throw new BadRequestException('The new order must list exactly the questions in this row.');
    }

    await this.prisma.$transaction(
      orderedQuestionIds.map((q, i) =>
        this.prisma.testQuestion.update({ where: { id: byQuestion.get(q)! }, data: { orderIndex: i } }),
      ),
    );
    return this.findOne(testId, tenantId);
  }

  /**
   * Freezes every picked question into QuestionUsage and marks the test
   * published, in one transaction. From here on scores read the snapshot, and
   * the bank refuses to delete these questions.
   */
  async publish(id: string, userId: string, tenantId: string) {
    const t = await this.prisma.test.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: {
        format: { include: FORMAT_INCLUDE },
        syllabi: true,
        questions: {
          orderBy: [{ orderIndex: 'asc' }],
          include: { question: { include: SNAPSHOT_INCLUDE } },
        },
      },
    });
    if (!t) throw new NotFoundException(`Test not found: ${id}`);

    const slots = slotsOf(t.format);
    const placed: PlacedQuestion[] = t.questions.map((tq) => ({
      rowId: tq.rowId,
      questionId: tq.questionId,
      subjectId: tq.question.subjectId,
      questionTypeId: tq.question.questionTypeId,
      deleted: !!tq.question.deletedAt,
    }));
    const problems = [
      ...detailProblems(detailsOf(t)),
      ...publishProblems(t.status, slots, placed),
    ];
    if (problems.length) {
      throw new BadRequestException(`This test cannot be published yet:\n${problems.map((p) => `• ${p}`).join('\n')}`);
    }

    const rows = new Map(
      t.format.subjects.flatMap((s) => s.sections.flatMap((sec) => sec.rows.map((r) => [r.id, r] as const))),
    );
    let order = 0;
    const usages: Prisma.QuestionUsageCreateManyInput[] = slots.flatMap((slot) =>
      t.questions
        .filter((tq) => tq.rowId === slot.rowId)
        .map((tq) => {
          const row = rows.get(slot.rowId)!;
          return {
            tenantId,
            questionId: tq.questionId,
            usedInType: UsageType.TEST,
            usedInId: t.id,
            version: tq.question.currentVersion,
            snapshot: buildQuestionSnapshot(tq.question, row),
            marks: Number(row.marksPerQuestion),
            negativeMarks: Number(row.negativeMarks),
            orderIndex: order++,
          };
        }),
    );

    await this.prisma.$transaction([
      this.prisma.questionUsage.deleteMany({ where: { usedInType: UsageType.TEST, usedInId: t.id } }),
      this.prisma.questionUsage.createMany({ data: usages }),
      this.prisma.test.update({
        where: { id: t.id },
        data: { status: TestStatus.PUBLISHED, publishedAt: new Date(), publishedById: userId },
      }),
    ]);
    return this.findOne(id, tenantId);
  }

  async unpublish(id: string, tenantId: string) {
    const t = await this.findOwned(id, tenantId);
    if (t.status !== TestStatus.PUBLISHED) {
      throw new ConflictException('Only a published test can be unpublished.');
    }
    if (await this.hasAttempts(id)) {
      throw new ConflictException('Students have already attempted this test, so it can no longer be unpublished.');
    }
    const inPublished = await this.prisma.testSeriesNode.count({
      where: { testId: id, series: { status: TestSeriesStatus.PUBLISHED, ...notDeleted() } },
    });
    if (inPublished) {
      throw new ConflictException(
        `This test is in ${inPublished} published test series, so it cannot be unpublished. Unpublish those series or remove the test from them first.`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.questionUsage.deleteMany({ where: { usedInType: UsageType.TEST, usedInId: id } }),
      this.prisma.test.update({
        where: { id },
        data: { status: TestStatus.DRAFT, publishedAt: null, publishedById: null },
      }),
    ]);
    return this.findOne(id, tenantId);
  }

  async duplicate(id: string, userId: string, tenantId: string) {
    const source = await this.prisma.test.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: {
        syllabi: true,
        questions: { include: { question: { select: { deletedAt: true } } } },
      },
    });
    if (!source) throw new NotFoundException(`Test not found: ${id}`);

    const created = await this.prisma.test.create({
      data: {
        tenantId,
        formatId: source.formatId,
        name: `${source.name} (copy)`,
        year: source.year,
        descriptionHtml: source.descriptionHtml,
        plannerFileKey: null,
        plannerFileName: null,
        durationMinutes: source.durationMinutes,
        createdById: userId,
        syllabi: {
          create: source.syllabi.map((s) => ({ formatSubjectId: s.formatSubjectId, syllabusHtml: s.syllabusHtml })),
        },
        questions: {
          create: source.questions
            .filter((q) => !q.question.deletedAt)
            .map((q) => ({ rowId: q.rowId, questionId: q.questionId, orderIndex: q.orderIndex })),
        },
      },
    });
    return this.findOne(created.id, tenantId);
  }

  async remove(id: string, userId: string, tenantId: string) {
    const t = await this.findOwned(id, tenantId);
    if (t.status !== TestStatus.DRAFT) {
      throw new ConflictException('Only a draft test can be deleted. Unpublish it first.');
    }
    const inSeries = await this.prisma.testSeriesNode.count({ where: { testId: id, series: notDeleted() } });
    if (inSeries) {
      throw new ConflictException(
        `This test is in ${inSeries} test series. Remove it from ${inSeries === 1 ? 'that series' : 'those series'} before deleting it.`,
      );
    }
    await this.prisma.test.update({ where: { id }, data: markDeleted(userId) });
    return true;
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async findOwned(id: string, tenantId: string) {
    const t = await this.prisma.test.findFirst({ where: { id, tenantId, ...notDeleted() } });
    if (!t) throw new NotFoundException(`Test not found: ${id}`);
    return t;
  }

  private assertDraft(status: TestStatus) {
    if (status !== TestStatus.DRAFT) throw new ConflictException(PUBLISHED_MESSAGE);
  }

  /** A row of this test's own format, with the slot the rules check picks against. */
  private async findRow(rowId: string, formatId: string) {
    const row = await this.prisma.testFormatRow.findFirst({
      where: { id: rowId, section: { formatSubject: { formatId } } },
      include: { section: { include: { formatSubject: true, rows: { select: { id: true } } } } },
    });
    if (!row) throw new NotFoundException("That question row is not part of this test's format.");
    const idx = row.section.rows.findIndex((r) => r.id === row.id);
    const slot: RowSlot = {
      rowId: row.id,
      label:
        `${row.section.formatSubject.subjectName} › ${row.section.name} › ${row.questionTypeCode}` +
        (row.section.rows.length > 1 ? ` #${idx + 1}` : ''),
      subjectId: row.section.formatSubject.subjectId,
      questionTypeId: row.questionTypeId,
      questionCount: row.questionCount,
    };
    return { row, slot };
  }

  /**
   * Whether any student has started this test. There is no attempt table until
   * the exam player is built, so nothing can have been attempted yet. This is
   * the single place that must change when attempts exist.
   */
  private hasAttempts(_testId: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  private async toEntity(t: TestWithDetail): Promise<TestEntity> {
    const slots = slotsOf(t.format);
    const slotById = new Map(slots.map((s) => [s.rowId, s]));
    const placed: PlacedQuestion[] = t.questions.map((tq) => ({
      rowId: tq.rowId,
      questionId: tq.questionId,
      subjectId: tq.question.subjectId,
      questionTypeId: tq.question.questionTypeId,
      deleted: !!tq.question.deletedAt,
    }));
    const subjectName = new Map(t.format.subjects.map((s) => [s.id, s.subjectName]));

    return {
      id: t.id,
      name: t.name,
      year: t.year ?? undefined,
      status: t.status,
      descriptionHtml: t.descriptionHtml ?? undefined,
      plannerFileName: t.plannerFileName ?? undefined,
      // Signed for a day: the bucket is private.
      plannerUrl: t.plannerFileKey ? await this.s3.getPresignedGetUrl(t.plannerFileKey, 86400) : undefined,
      durationMinutes: t.durationMinutes ?? t.format.durationMinutes,
      durationOverride: t.durationMinutes ?? undefined,
      publishedAt: t.publishedAt ?? undefined,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      format: toFormatEntity(t.format, await this.formats.usageCount(t.formatId)),
      syllabi: t.format.subjects.map((s) => ({
        formatSubjectId: s.id,
        subjectName: s.subjectName,
        syllabusHtml: t.syllabi.find((x) => x.formatSubjectId === s.id)?.syllabusHtml ?? undefined,
      })),
      questions: t.questions.map((tq) => {
        const slot = slotById.get(tq.rowId);
        return {
          id: tq.id,
          rowId: tq.rowId,
          questionId: tq.questionId,
          orderIndex: tq.orderIndex,
          questionText: tq.question.questionText,
          questionStatus: tq.question.status,
          questionTypeCode: tq.question.typeDef?.code ?? '',
          kernel: tq.question.typeDef?.kernel ?? undefined,
          options: optionsOf(tq.question.mcqOptions),
          answerConfig: tq.question.answerConfig ?? undefined,
          explanation: tq.question.explanation ?? undefined,
          deleted: !!tq.question.deletedAt,
          matchesRow:
            !!slot &&
            tq.question.subjectId === slot.subjectId &&
            tq.question.questionTypeId === slot.questionTypeId,
        };
      }),
      progress: slots.map((s) => ({
        rowId: s.rowId,
        label: s.label,
        picked: placed.filter((p) => p.rowId === s.rowId).length,
        required: s.questionCount,
      })),
      publishProblems:
        t.status === TestStatus.DRAFT
          ? [...detailProblems(detailsOf(t)), ...publishProblems(t.status, slots, placed)]
          : [],
    };
  }
}

// Kept for readers of subjectName lookups in other modules.
export type { TestWithDetail };
