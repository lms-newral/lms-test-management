import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnswerKernel, Prisma, TestFormatStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { BankDefaultsService } from '../question-bank/bank-defaults.service';
import { markDeleted, notDeleted } from 'src/prisma/soft-delete';
import {
  FormatShape,
  formatLockReason,
  formatTotals,
  rowMaxMarks,
  validateFormat,
} from './test-format.logic';
import {
  SaveTestFormatInput,
  UseTestFormatTemplateInput,
} from './dto/test-management.inputs';
import { TestFormatEntity } from './entities/test-management.entities';

export const FORMAT_INCLUDE = {
  subjects: {
    orderBy: [{ orderIndex: 'asc' as const }],
    include: {
      sections: {
        orderBy: [{ orderIndex: 'asc' as const }],
        include: { rows: { orderBy: [{ orderIndex: 'asc' as const }] } },
      },
    },
  },
  bands: { orderBy: [{ minScore: 'asc' as const }] },
} satisfies Prisma.TestFormatInclude;

export type FormatWithTree = Prisma.TestFormatGetPayload<{
  include: typeof FORMAT_INCLUDE;
}>;

const num = (d: Prisma.Decimal | number) => Number(d);

/** One problem per line, so the admin shows every issue at once. */
const problemsError = (intro: string, problems: string[]) =>
  new BadRequestException(`${intro}\n${problems.map((p) => `• ${p}`).join('\n')}`);

export function toShape(f: FormatWithTree): FormatShape {
  return {
    name: f.name,
    durationMinutes: f.durationMinutes,
    bands: f.bands.map((b) => ({
      minScore: num(b.minScore),
      maxScore: num(b.maxScore),
      percentile: num(b.percentile),
    })),
    subjects: f.subjects.map((s) => ({
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      totalQuestions: s.totalQuestions,
      totalMarks: num(s.totalMarks),
      sections: s.sections.map((sec) => ({
        name: sec.name,
        rows: sec.rows.map((r) => ({
          questionTypeCode: r.questionTypeCode,
          kernel: r.kernel,
          questionCount: r.questionCount,
          attemptLimit: r.attemptLimit,
          marksPerQuestion: num(r.marksPerQuestion),
          negativeMarks: num(r.negativeMarks),
          partialMarking: r.partialMarking,
        })),
      })),
    })),
  };
}

export function toFormatEntity(
  f: FormatWithTree,
  testCount: number,
): TestFormatEntity {
  const shape = toShape(f);
  const totals = formatTotals(shape);
  return {
    id: f.id,
    name: f.name,
    status: f.status,
    instructionsHtml: f.instructionsHtml ?? undefined,
    durationMinutes: f.durationMinutes,
    isTemplate: f.tenantId === null,
    templateNote: f.templateNote ?? undefined,
    sourceTemplateId: f.sourceTemplateId ?? undefined,
    totalQuestions: totals.questions,
    totalMarks: totals.marks,
    minScore: totals.minScore,
    testCount,
    locked: formatLockReason(testCount) !== null,
    problems: validateFormat(shape),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    bands: f.bands.map((b) => ({
      id: b.id,
      minScore: num(b.minScore),
      maxScore: num(b.maxScore),
      percentile: num(b.percentile),
      orderIndex: b.orderIndex,
    })),
    subjects: f.subjects.map((s, si) => ({
      id: s.id,
      subjectId: s.subjectId ?? undefined,
      subjectName: s.subjectName,
      totalQuestions: s.totalQuestions,
      totalMarks: num(s.totalMarks),
      orderIndex: s.orderIndex,
      sections: s.sections.map((sec, xi) => ({
        id: sec.id,
        name: sec.name,
        instructionsHtml: sec.instructionsHtml ?? undefined,
        orderIndex: sec.orderIndex,
        rows: sec.rows.map((r, ri) => ({
          id: r.id,
          questionTypeId: r.questionTypeId ?? undefined,
          questionTypeCode: r.questionTypeCode,
          kernel: r.kernel,
          questionCount: r.questionCount,
          attemptLimit: r.attemptLimit ?? undefined,
          marksPerQuestion: num(r.marksPerQuestion),
          negativeMarks: num(r.negativeMarks),
          partialMarking: r.partialMarking,
          orderIndex: r.orderIndex,
          maxMarks: rowMaxMarks(shape.subjects[si].sections[xi].rows[ri]),
        })),
      })),
    })),
  };
}

/** Nested-create data for a format's subjects and bands. */
type StructureData = Pick<Prisma.TestFormatCreateInput, 'subjects' | 'bands'>;

@Injectable()
export class TestFormatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaults: BankDefaultsService,
  ) {}

  async list(tenantId: string, status?: TestFormatStatus) {
    const rows = await this.prisma.testFormat.findMany({
      where: { tenantId, ...notDeleted(), ...(status ? { status } : {}) },
      include: FORMAT_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
    });
    const counts = await this.usageCounts(rows.map((r) => r.id));
    return rows.map((r) => toFormatEntity(r, counts.get(r.id) ?? 0));
  }

  async templates() {
    const rows = await this.prisma.testFormat.findMany({
      where: { tenantId: null, status: TestFormatStatus.ACTIVE, ...notDeleted() },
      include: FORMAT_INCLUDE,
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((r) => toFormatEntity(r, 0));
  }

  async findOne(id: string, tenantId: string) {
    const f = await this.findOwned(id, tenantId);
    return toFormatEntity(f, await this.usageCount(id));
  }

  async create(input: SaveTestFormatInput, userId: string, tenantId: string) {
    const { data } = await this.resolveStructure(input, tenantId);
    const created = await this.prisma.testFormat.create({
      data: {
        tenantId,
        name: input.name.trim(),
        instructionsHtml: input.instructionsHtml ?? null,
        durationMinutes: input.durationMinutes,
        status: TestFormatStatus.DRAFT,
        createdById: userId,
        ...data,
      },
      include: FORMAT_INCLUDE,
    });
    return toFormatEntity(created, 0);
  }

  async update(id: string, input: SaveTestFormatInput, tenantId: string) {
    const existing = await this.findOwned(id, tenantId);
    await this.assertUnlocked(id);
    const { data, shape } = await this.resolveStructure(input, tenantId);

    // An ACTIVE format may be building tests any moment, so it must stay valid.
    if (existing.status !== TestFormatStatus.DRAFT) {
      const problems = validateFormat(shape);
      if (problems.length) {
        throw problemsError('This format is active, so it must still add up:', problems);
      }
    }

    const [, , updated] = await this.prisma.$transaction([
      this.prisma.testFormatSubject.deleteMany({ where: { formatId: id } }),
      this.prisma.testPercentileBand.deleteMany({ where: { formatId: id } }),
      this.prisma.testFormat.update({
        where: { id },
        data: {
          name: input.name.trim(),
          instructionsHtml: input.instructionsHtml ?? null,
          durationMinutes: input.durationMinutes,
          ...data,
        },
        include: FORMAT_INCLUDE,
      }),
    ]);
    return toFormatEntity(updated, 0);
  }

  async setStatus(id: string, status: TestFormatStatus, tenantId: string) {
    const f = await this.findOwned(id, tenantId);
    const count = await this.usageCount(id);
    if (f.status === status) return toFormatEntity(f, count);

    if (status === TestFormatStatus.DRAFT && count > 0) {
      throw new ConflictException(formatLockReason(count));
    }
    if (status === TestFormatStatus.ACTIVE) {
      const problems = [
        ...validateFormat(toShape(f)),
        ...(await this.staleReferences(f, tenantId)),
      ];
      if (problems.length) {
        throw problemsError('This format cannot be made active yet:', problems);
      }
    }

    const updated = await this.prisma.testFormat.update({
      where: { id },
      data: { status },
      include: FORMAT_INCLUDE,
    });
    return toFormatEntity(updated, count);
  }

  async duplicate(
    id: string,
    name: string | undefined,
    userId: string,
    tenantId: string,
  ) {
    const source = await this.findOwned(id, tenantId);
    const created = await this.prisma.testFormat.create({
      data: {
        tenantId,
        name: name?.trim() || `${source.name} (copy)`,
        instructionsHtml: source.instructionsHtml,
        durationMinutes: source.durationMinutes,
        status: TestFormatStatus.DRAFT,
        sourceTemplateId: source.sourceTemplateId,
        createdById: userId,
        ...this.copyStructure(source),
      },
      include: FORMAT_INCLUDE,
    });
    return toFormatEntity(created, 0);
  }

  async remove(id: string, userId: string, tenantId: string) {
    await this.findOwned(id, tenantId);
    const count = await this.usageCount(id);
    if (count > 0) {
      throw new ConflictException(
        `This format is used by ${count} test(s) and cannot be deleted. Archive it instead.`,
      );
    }
    await this.prisma.testFormat.update({
      where: { id },
      data: markDeleted(userId),
    });
    return true;
  }

  /**
   * Copies a platform template into the institute as a DRAFT. Subjects match
   * the bank by name and question types by code, case-insensitively; anything
   * without a match must be mapped explicitly, and all of it is reported at once.
   */
  async useTemplate(
    input: UseTestFormatTemplateInput,
    userId: string,
    tenantId: string,
  ) {
    const template = await this.prisma.testFormat.findFirst({
      where: { id: input.templateId, tenantId: null, ...notDeleted() },
      include: FORMAT_INCLUDE,
    });
    if (!template) throw new NotFoundException('Template not found');

    // Nothing to map: give the institute any subject or question type the
    // template needs that it doesn't have yet.
    await this.defaults.ensureFor(
      tenantId,
      template.subjects.map((s) => s.subjectName),
      template.subjects.flatMap((s) => s.sections.flatMap((sec) => sec.rows.map((r) => r.questionTypeCode))),
      userId,
    );

    const [subjects, types] = await Promise.all([
      this.prisma.taxonomy.findMany({
        where: { tenantId, kind: 'SUBJECT', ...notDeleted() },
        select: { id: true, name: true },
      }),
      this.prisma.questionTypeDef.findMany({
        where: { tenantId, isActive: true, deletedAt: null },
        select: { id: true, code: true, kernel: true },
      }),
    ]);

    const subjectOverride = new Map(
      (input.subjectMap ?? []).map((m) => [m.templateSubjectName.trim().toLowerCase(), m.subjectId]),
    );
    const typeOverride = new Map(
      (input.typeMap ?? []).map((m) => [m.questionTypeCode.trim().toUpperCase(), m.questionTypeId]),
    );

    const missing: string[] = [];
    const subjectFor = new Map<string, { id: string; name: string }>();
    for (const s of template.subjects) {
      const key = s.subjectName.trim().toLowerCase();
      const wanted = subjectOverride.get(key);
      const match = wanted
        ? subjects.find((x) => x.id === wanted)
        : subjects.find((x) => x.name.trim().toLowerCase() === key);
      if (match) subjectFor.set(s.id, match);
      else missing.push(wanted ? `Subject "${s.subjectName}" is mapped to a subject that doesn't exist in your bank.` : `Subject "${s.subjectName}" has no match in your question bank. Choose which subject to use.`);
    }

    const typeFor = new Map<string, { id: string; code: string; kernel: AnswerKernel }>();
    const codes = [...new Set(template.subjects.flatMap((s) => s.sections.flatMap((sec) => sec.rows.map((r) => r.questionTypeCode.toUpperCase()))))];
    for (const code of codes) {
      const wanted = typeOverride.get(code);
      const match = wanted
        ? types.find((t) => t.id === wanted)
        : types.find((t) => t.code.toUpperCase() === code);
      if (match) typeFor.set(code, match);
      else missing.push(wanted ? `Question type "${code}" is mapped to a type that doesn't exist.` : `Question type "${code}" has no match in your question types. Choose which type to use.`);
    }

    if (missing.length) {
      throw problemsError('Map these before using the template:', missing);
    }

    const created = await this.prisma.testFormat.create({
      data: {
        tenantId,
        name: input.name?.trim() || template.name,
        instructionsHtml: template.instructionsHtml,
        durationMinutes: template.durationMinutes,
        status: TestFormatStatus.DRAFT,
        sourceTemplateId: template.id,
        createdById: userId,
        subjects: {
          create: template.subjects.map((s) => ({
            subjectId: subjectFor.get(s.id)!.id,
            subjectName: subjectFor.get(s.id)!.name,
            totalQuestions: s.totalQuestions,
            totalMarks: s.totalMarks,
            orderIndex: s.orderIndex,
            sections: {
              create: s.sections.map((sec) => ({
                name: sec.name,
                instructionsHtml: sec.instructionsHtml,
                orderIndex: sec.orderIndex,
                rows: {
                  create: sec.rows.map((r) => {
                    const t = typeFor.get(r.questionTypeCode.toUpperCase())!;
                    return {
                      questionTypeId: t.id,
                      questionTypeCode: t.code,
                      kernel: t.kernel,
                      questionCount: r.questionCount,
                      attemptLimit: r.attemptLimit,
                      marksPerQuestion: r.marksPerQuestion,
                      negativeMarks: r.negativeMarks,
                      partialMarking: r.partialMarking,
                      orderIndex: r.orderIndex,
                    };
                  }),
                },
              })),
            },
          })),
        },
        bands: {
          create: template.bands.map((b) => ({
            minScore: b.minScore,
            maxScore: b.maxScore,
            percentile: b.percentile,
            orderIndex: b.orderIndex,
          })),
        },
      },
      include: FORMAT_INCLUDE,
    });
    // Templates are complete patterns, so the copy is ready for tests at once.
    if (validateFormat(toShape(created)).length === 0) {
      const active = await this.prisma.testFormat.update({
        where: { id: created.id },
        data: { status: TestFormatStatus.ACTIVE },
        include: FORMAT_INCLUDE,
      });
      return toFormatEntity(active, 0);
    }
    return toFormatEntity(created, 0);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  async findOwned(id: string, tenantId: string): Promise<FormatWithTree> {
    const f = await this.prisma.testFormat.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: FORMAT_INCLUDE,
    });
    if (!f) throw new NotFoundException(`Test format not found: ${id}`);
    return f;
  }

  /**
   * Tests that lock a format: every live test, plus any test that was ever
   * published (a deleted published test still has scores behind it).
   */
  private usageWhere(formatIds: string[]): Prisma.TestWhereInput {
    return {
      formatId: { in: formatIds },
      OR: [{ deletedAt: null }, { publishedAt: { not: null } }],
    };
  }

  async usageCount(formatId: string): Promise<number> {
    return this.prisma.test.count({ where: this.usageWhere([formatId]) });
  }

  private async usageCounts(formatIds: string[]): Promise<Map<string, number>> {
    if (!formatIds.length) return new Map();
    const groups = await this.prisma.test.groupBy({
      by: ['formatId'],
      where: this.usageWhere(formatIds),
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.formatId, g._count._all]));
  }

  private async assertUnlocked(formatId: string) {
    const reason = formatLockReason(await this.usageCount(formatId));
    if (reason) throw new ConflictException(reason);
  }

  /** Subjects or types a saved format points at that have since been deleted. */
  private async staleReferences(f: FormatWithTree, tenantId: string) {
    const subjectIds = f.subjects.map((s) => s.subjectId).filter((x): x is string => !!x);
    const typeIds = [...new Set(f.subjects.flatMap((s) => s.sections.flatMap((sec) => sec.rows.map((r) => r.questionTypeId))).filter((x): x is string => !!x))];
    const [liveSubjects, liveTypes] = await Promise.all([
      this.prisma.taxonomy.findMany({
        where: { id: { in: subjectIds }, tenantId, kind: 'SUBJECT', ...notDeleted() },
        select: { id: true },
      }),
      this.prisma.questionTypeDef.findMany({
        where: { id: { in: typeIds }, tenantId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    const problems: string[] = [];
    const subjectsLive = new Set(liveSubjects.map((s) => s.id));
    const typesLive = new Set(liveTypes.map((t) => t.id));
    for (const s of f.subjects) {
      if (!s.subjectId || !subjectsLive.has(s.subjectId)) {
        problems.push(`${s.subjectName}: this subject no longer exists in the question bank.`);
      }
      for (const sec of s.sections) {
        for (const r of sec.rows) {
          if (!r.questionTypeId || !typesLive.has(r.questionTypeId)) {
            problems.push(`${s.subjectName} › ${sec.name}: question type ${r.questionTypeCode} no longer exists.`);
          }
        }
      }
    }
    return problems;
  }

  /**
   * Checks every subject and type in the input belongs to the tenant, then
   * builds the nested-create data and the shape the rules validate.
   */
  private async resolveStructure(
    input: SaveTestFormatInput,
    tenantId: string,
  ): Promise<{ data: StructureData; shape: FormatShape }> {
    const subjectIds = input.subjects.map((s) => s.subjectId);
    if (new Set(subjectIds).size !== subjectIds.length) {
      throw new BadRequestException('A subject is added more than once.');
    }
    const typeIds = [...new Set(input.subjects.flatMap((s) => s.sections.flatMap((sec) => sec.rows.map((r) => r.questionTypeId))))];

    const [subjects, types] = await Promise.all([
      this.prisma.taxonomy.findMany({
        where: { id: { in: subjectIds }, tenantId, kind: 'SUBJECT', ...notDeleted() },
        select: { id: true, name: true },
      }),
      this.prisma.questionTypeDef.findMany({
        where: { id: { in: typeIds }, tenantId, isActive: true, deletedAt: null },
        select: { id: true, code: true, kernel: true },
      }),
    ]);
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const typeById = new Map(types.map((t) => [t.id, t]));

    const unknown = [
      ...subjectIds.filter((id) => !subjectById.has(id)).map((id) => `Subject ${id} is not a subject in your question bank.`),
      ...typeIds.filter((id) => !typeById.has(id)).map((id) => `Question type ${id} is not an active type.`),
    ];
    if (unknown.length) throw problemsError('Some choices are not valid:', unknown);

    const shape: FormatShape = {
      name: input.name,
      durationMinutes: input.durationMinutes,
      bands: input.bands,
      subjects: input.subjects.map((s) => ({
        subjectId: s.subjectId,
        subjectName: subjectById.get(s.subjectId)!.name,
        totalQuestions: s.totalQuestions,
        totalMarks: s.totalMarks,
        sections: s.sections.map((sec) => ({
          name: sec.name,
          rows: sec.rows.map((r) => ({
            questionTypeCode: typeById.get(r.questionTypeId)!.code,
            kernel: typeById.get(r.questionTypeId)!.kernel,
            questionCount: r.questionCount,
            attemptLimit: r.attemptLimit ?? null,
            marksPerQuestion: r.marksPerQuestion,
            negativeMarks: r.negativeMarks,
            partialMarking: r.partialMarking,
          })),
        })),
      })),
    };

    const data: StructureData = {
      subjects: {
        create: input.subjects.map((s, si) => ({
          subjectId: s.subjectId,
          subjectName: subjectById.get(s.subjectId)!.name,
          totalQuestions: s.totalQuestions,
          totalMarks: s.totalMarks,
          orderIndex: si,
          sections: {
            create: s.sections.map((sec, xi) => ({
              name: sec.name.trim(),
              instructionsHtml: sec.instructionsHtml ?? null,
              orderIndex: xi,
              rows: {
                create: sec.rows.map((r, ri) => {
                  const t = typeById.get(r.questionTypeId)!;
                  return {
                    questionTypeId: t.id,
                    questionTypeCode: t.code,
                    kernel: t.kernel,
                    questionCount: r.questionCount,
                    attemptLimit: r.attemptLimit ?? null,
                    marksPerQuestion: r.marksPerQuestion,
                    negativeMarks: r.negativeMarks,
                    partialMarking: r.partialMarking,
                    orderIndex: ri,
                  };
                }),
              },
            })),
          },
        })),
      },
      bands: {
        create: input.bands.map((b, i) => ({
          minScore: b.minScore,
          maxScore: b.maxScore,
          percentile: b.percentile,
          orderIndex: i,
        })),
      },
    };

    return { data, shape };
  }

  private copyStructure(f: FormatWithTree): StructureData {
    return {
      subjects: {
        create: f.subjects.map((s) => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          totalQuestions: s.totalQuestions,
          totalMarks: s.totalMarks,
          orderIndex: s.orderIndex,
          sections: {
            create: s.sections.map((sec) => ({
              name: sec.name,
              instructionsHtml: sec.instructionsHtml,
              orderIndex: sec.orderIndex,
              rows: {
                create: sec.rows.map((r) => ({
                  questionTypeId: r.questionTypeId,
                  questionTypeCode: r.questionTypeCode,
                  kernel: r.kernel,
                  questionCount: r.questionCount,
                  attemptLimit: r.attemptLimit,
                  marksPerQuestion: r.marksPerQuestion,
                  negativeMarks: r.negativeMarks,
                  partialMarking: r.partialMarking,
                  orderIndex: r.orderIndex,
                })),
              },
            })),
          },
        })),
      },
      bands: {
        create: f.bands.map((b) => ({
          minScore: b.minScore,
          maxScore: b.maxScore,
          percentile: b.percentile,
          orderIndex: b.orderIndex,
        })),
      },
    };
  }
}
