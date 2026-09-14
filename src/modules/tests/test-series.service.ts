import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TestSeriesNodeKind, TestSeriesStatus, TestStatus } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3Service } from 'src/common/services/s3.service';
import { SessionService } from '../auth/session.service';
import { markDeleted, notDeleted } from 'src/prisma/soft-delete';
import {
  Schedule,
  moveProblem,
  pricingProblems,
  scheduleProblems,
  seriesPublishProblems,
  startedEditProblem,
  subtreeIds,
  windowProblems,
} from './test-series.logic';
import {
  TestSeriesScheduleInput,
  UpdateTestSeriesInput,
} from './dto/test-series.inputs';
import { TestSeriesEntity, TestSeriesNodeEntity } from './entities/test-series.entities';

const SERIES_INCLUDE = {
  nodes: {
    orderBy: [{ orderIndex: 'asc' as const }],
    include: {
      test: {
        select: {
          name: true,
          year: true,
          status: true,
          deletedAt: true,
          durationMinutes: true,
          format: {
            select: {
              durationMinutes: true,
              subjects: { select: { totalQuestions: true, totalMarks: true } },
            },
          },
        },
      },
    },
  },
  _count: { select: { enrollments: true } },
} satisfies Prisma.TestSeriesInclude;

type SeriesWithTree = Prisma.TestSeriesGetPayload<{ include: typeof SERIES_INCLUDE }>;
type NodeRow = SeriesWithTree['nodes'][number];

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const scheduleOf = (n: { availableFrom: Date | null; availableTo: Date | null; resultAt: Date | null }): Schedule => ({
  availableFrom: n.availableFrom,
  availableTo: n.availableTo,
  resultAt: n.resultAt,
});
const fail = (intro: string, problems: string[]) => {
  throw new BadRequestException(`${intro}\n${problems.map((p) => `• ${p}`).join('\n')}`);
};

/**
 * Test series: tests arranged in folders with per-test schedules. A series
 * only links tests, so a test's attempts and results stay on the test and add
 * up across every series it is in.
 */
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class TestSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly session: SessionService,
  ) {}

  async createCoverUpload(seriesId: string, fileName: string, contentType: string, tenantId: string) {
    await this.findOwned(seriesId, tenantId);
    if (!COVER_TYPES.includes(contentType)) {
      throw new BadRequestException('The cover must be a JPG, PNG or WebP image.');
    }
    return this.s3.getTestSeriesCoverUploadUrl(tenantId, seriesId, fileName, contentType);
  }

  async setCover(seriesId: string, key: string | null, tenantId: string) {
    await this.findOwned(seriesId, tenantId);
    // Only a key issued for this series, so a cover can never point at another institute's file.
    if (key && !key.startsWith(`tenants/${tenantId}/test-series/${seriesId}/cover/`)) {
      throw new BadRequestException('That image was not uploaded for this series.');
    }
    await this.prisma.testSeries.update({ where: { id: seriesId }, data: { coverImageKey: key } });
    return this.findOne(seriesId, tenantId);
  }

  /**
   * Adds students by email, for offline payments or free access. Every email is
   * looked up in the main backend under the caller's tenant; name and email are
   * taken from there, never from the request.
   */
  async addStudents(seriesId: string, emails: string[], req: Request, tenantId: string) {
    await this.findOwned(seriesId, tenantId);
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (wanted.length === 0) throw new BadRequestException('Add at least one student.');
    if (wanted.length > 100) throw new BadRequestException('Add at most 100 students at a time.');

    const found: { id: string; email: string; name: string }[] = [];
    const problems: string[] = [];
    for (let i = 0; i < wanted.length; i += 10) {
      const batch = await Promise.all(
        wanted.slice(i, i + 10).map(async (email) => ({ email, user: await this.session.findTenantUserByEmail(req, email) })),
      );
      for (const { email, user } of batch) {
        if (!user) problems.push(`${email}: no account with this email in your institute.`);
        else if (user.role !== 'student') problems.push(`${email}: this account is not a student.`);
        else found.push(user);
      }
    }
    if (problems.length) fail('These students could not be added:', problems);

    await this.prisma.testSeriesEnrollment.createMany({
      data: found.map((u) => ({
        tenantId,
        seriesId,
        userId: u.id,
        userName: u.name,
        userEmail: u.email,
        source: 'MANUAL',
      })),
      skipDuplicates: true,
    });
    return this.enrollments(seriesId, tenantId);
  }

  /** Removes a student an admin added or who joined for free. Paid enrollments stay. */
  async removeStudent(enrollmentId: string, tenantId: string) {
    const e = await this.prisma.testSeriesEnrollment.findFirst({
      where: { id: enrollmentId, tenantId, series: notDeleted() },
    });
    if (!e) throw new NotFoundException('Enrollment not found.');
    if (e.source === 'PAID') {
      throw new ConflictException('This student paid for the series, so they cannot be removed here.');
    }
    await this.prisma.testSeriesEnrollment.delete({ where: { id: enrollmentId } });
    return this.enrollments(e.seriesId, tenantId);
  }

  async list(tenantId: string, status?: TestSeriesStatus) {
    const rows = await this.prisma.testSeries.findMany({
      where: { tenantId, ...notDeleted(), ...(status ? { status } : {}) },
      include: SERIES_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
    });
    return Promise.all(rows.map((s) => this.toEntity(s)));
  }

  async findOne(id: string, tenantId: string): Promise<TestSeriesEntity> {
    const s = await this.prisma.testSeries.findFirst({
      where: { id, tenantId, ...notDeleted() },
      include: SERIES_INCLUDE,
    });
    if (!s) throw new NotFoundException(`Test series not found: ${id}`);
    return this.toEntity(s);
  }

  async create(name: string, userId: string, tenantId: string) {
    const created = await this.prisma.testSeries.create({
      data: { tenantId, name: name.trim(), createdById: userId },
    });
    return this.findOne(created.id, tenantId);
  }

  async update(id: string, input: UpdateTestSeriesInput, tenantId: string) {
    const s = await this.findOwned(id, tenantId);
    const pick = <K extends keyof UpdateTestSeriesInput>(k: K, current: unknown) =>
      input[k] === undefined ? current : input[k];

    const next = {
      isPaid: pick('isPaid', s.isPaid) as boolean,
      price: pick('price', num(s.price)) as number | null,
      discountedPrice: pick('discountedPrice', num(s.discountedPrice)) as number | null,
      startAt: pick('startAt', s.startAt) as Date | null,
      endAt: pick('endAt', s.endAt) as Date | null,
    };
    const problems = [
      ...windowProblems(next, false),
      ...pricingProblems(next.isPaid, next.price, next.discountedPrice, false),
    ];

    // Moving the window must not strand a test scheduled outside it.
    if (input.startAt !== undefined || input.endAt !== undefined) {
      const scheduled = await this.prisma.testSeriesNode.findMany({
        where: { seriesId: id, kind: TestSeriesNodeKind.TEST, availableFrom: { not: null } },
        include: { test: { select: { name: true } } },
      });
      if (s.status === TestSeriesStatus.PUBLISHED && s.startAt && s.startAt <= new Date() &&
          next.startAt?.getTime() !== s.startAt.getTime()) {
        problems.push('The series is already visible to students, so its start date cannot change.');
      }
      for (const n of scheduled) {
        problems.push(
          ...scheduleProblems(scheduleOf(n), next, `"${n.test?.name ?? 'Test'}"`).filter((p) => p.includes('series')),
        );
      }
    }
    if (problems.length) fail('These details cannot be saved:', problems);

    const data: Prisma.TestSeriesUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.classLevel !== undefined) data.classLevel = input.classLevel?.trim() || null;
    if (input.examType !== undefined) data.examType = input.examType?.trim() || null;
    if (input.targetYear !== undefined) data.targetYear = input.targetYear;
    if (input.descriptionHtml !== undefined) data.descriptionHtml = input.descriptionHtml;
    if (input.isPaid !== undefined) data.isPaid = input.isPaid;
    if (input.price !== undefined) data.price = input.price;
    if (input.discountedPrice !== undefined) data.discountedPrice = input.discountedPrice;
    if (input.startAt !== undefined) data.startAt = input.startAt;
    if (input.endAt !== undefined) data.endAt = input.endAt;
    await this.prisma.testSeries.update({ where: { id }, data });
    return this.findOne(id, tenantId);
  }

  async addFolder(seriesId: string, parentId: string | null, name: string, tenantId: string) {
    await this.findOwned(seriesId, tenantId);
    await this.assertParent(seriesId, parentId);
    await this.prisma.testSeriesNode.create({
      data: {
        seriesId,
        parentId,
        kind: TestSeriesNodeKind.FOLDER,
        name: name.trim(),
        orderIndex: await this.nextOrder(seriesId, parentId),
      },
    });
    return this.findOne(seriesId, tenantId);
  }

  async renameFolder(nodeId: string, name: string, tenantId: string) {
    const node = await this.findOwnedNode(nodeId, tenantId);
    if (node.kind !== TestSeriesNodeKind.FOLDER) throw new BadRequestException('Only a folder can be renamed.');
    await this.prisma.testSeriesNode.update({ where: { id: nodeId }, data: { name: name.trim() } });
    return this.findOne(node.seriesId, tenantId);
  }

  async addTests(seriesId: string, parentId: string | null, testIds: string[], tenantId: string) {
    await this.findOwned(seriesId, tenantId);
    await this.assertParent(seriesId, parentId);
    const ids = [...new Set(testIds)];
    const tests = await this.prisma.test.findMany({
      where: { id: { in: ids }, tenantId, ...notDeleted() },
      select: { id: true, name: true },
    });
    if (tests.length !== ids.length) throw new NotFoundException('One or more tests were not found.');
    const already = await this.prisma.testSeriesNode.findMany({
      where: { seriesId, testId: { in: ids } },
      select: { test: { select: { name: true } } },
    });
    if (already.length) {
      fail('Each test can appear once in a series. Already here:', already.map((a) => `"${a.test?.name}"`));
    }

    let order = await this.nextOrder(seriesId, parentId);
    const byId = new Map(tests.map((t) => [t.id, t]));
    await this.prisma.testSeriesNode.createMany({
      data: ids.map((testId) => ({
        seriesId,
        parentId,
        kind: TestSeriesNodeKind.TEST,
        testId: byId.get(testId)!.id,
        orderIndex: order++,
      })),
    });
    return this.findOne(seriesId, tenantId);
  }

  async setSchedule(nodeId: string, input: TestSeriesScheduleInput, tenantId: string) {
    const node = await this.findOwnedNode(nodeId, tenantId);
    if (node.kind !== TestSeriesNodeKind.TEST) throw new BadRequestException('Only a test can be scheduled.');
    const next: Schedule = {
      availableFrom: input.availableFrom ?? null,
      availableTo: input.availableTo ?? null,
      resultAt: input.resultAt ?? null,
    };
    const clearing = !next.availableFrom && !next.availableTo && !next.resultAt;
    const problems = clearing ? [] : scheduleProblems(next, node.series, 'This test');
    if (node.series.status === TestSeriesStatus.PUBLISHED) {
      const started = startedEditProblem(scheduleOf(node), next, new Date());
      if (started) problems.unshift(started);
    }
    if (problems.length) fail('This schedule cannot be saved:', problems);

    await this.prisma.testSeriesNode.update({ where: { id: nodeId }, data: next });
    return this.findOne(node.seriesId, tenantId);
  }

  /** Moves a node under `parentId` (null = top level) at position `orderIndex`. */
  async move(nodeId: string, parentId: string | null, orderIndex: number, tenantId: string) {
    const node = await this.findOwnedNode(nodeId, tenantId);
    const all = await this.prisma.testSeriesNode.findMany({
      where: { seriesId: node.seriesId },
      select: { id: true, parentId: true, kind: true, orderIndex: true },
      orderBy: [{ orderIndex: 'asc' }],
    });
    const problem = moveProblem(all, nodeId, parentId);
    if (problem) throw new BadRequestException(problem);

    const siblings = all.filter((n) => n.parentId === parentId && n.id !== nodeId).map((n) => n.id);
    siblings.splice(Math.max(0, Math.min(orderIndex, siblings.length)), 0, nodeId);
    await this.prisma.$transaction(
      siblings.map((id, i) =>
        this.prisma.testSeriesNode.update({
          where: { id },
          data: id === nodeId ? { parentId, orderIndex: i } : { orderIndex: i },
        }),
      ),
    );
    return this.findOne(node.seriesId, tenantId);
  }

  async removeNode(nodeId: string, tenantId: string) {
    const node = await this.findOwnedNode(nodeId, tenantId);
    if (node.series.status === TestSeriesStatus.PUBLISHED) {
      const all = await this.prisma.testSeriesNode.findMany({
        where: { seriesId: node.seriesId },
        select: { id: true, parentId: true, kind: true, availableFrom: true },
      });
      const ids = new Set(subtreeIds(all, nodeId));
      const now = new Date();
      if (all.some((n) => ids.has(n.id) && n.availableFrom && n.availableFrom <= now)) {
        throw new ConflictException(
          'Students can already see a test here, so it cannot be removed from the published series.',
        );
      }
    }
    await this.prisma.testSeriesNode.delete({ where: { id: nodeId } });
    return this.findOne(node.seriesId, tenantId);
  }

  async publish(id: string, userId: string, tenantId: string) {
    const s = await this.findOne(id, tenantId);
    if (s.status === TestSeriesStatus.PUBLISHED) throw new ConflictException('This series is already published.');
    if (s.problems.length) fail('This series cannot be published yet:', s.problems);
    await this.prisma.testSeries.update({
      where: { id },
      data: { status: TestSeriesStatus.PUBLISHED, publishedAt: new Date(), publishedById: userId },
    });
    return this.findOne(id, tenantId);
  }

  async unpublish(id: string, tenantId: string) {
    const s = await this.findOwned(id, tenantId);
    if (s.status !== TestSeriesStatus.PUBLISHED) throw new ConflictException('Only a published series can be unpublished.');
    const enrolled = await this.prisma.testSeriesEnrollment.count({ where: { seriesId: id } });
    if (enrolled) {
      throw new ConflictException(
        `${enrolled} student${enrolled === 1 ? ' is' : 's are'} enrolled, so this series cannot be unpublished.`,
      );
    }
    await this.prisma.testSeries.update({ where: { id }, data: { status: TestSeriesStatus.UNPUBLISHED } });
    return this.findOne(id, tenantId);
  }

  async remove(id: string, userId: string, tenantId: string) {
    const s = await this.findOwned(id, tenantId);
    if (s.status === TestSeriesStatus.PUBLISHED) throw new ConflictException('Unpublish the series before deleting it.');
    if (await this.prisma.testSeriesEnrollment.count({ where: { seriesId: id } })) {
      throw new ConflictException('Students are enrolled in this series, so it cannot be deleted.');
    }
    await this.prisma.testSeries.update({ where: { id }, data: markDeleted(userId) });
    return true;
  }

  async enrollments(seriesId: string, tenantId: string) {
    await this.findOwned(seriesId, tenantId);
    const rows = await this.prisma.testSeriesEnrollment.findMany({
      where: { seriesId, tenantId },
      orderBy: [{ enrolledAt: 'desc' }],
    });
    return rows.map((e) => ({
      id: e.id,
      userId: e.userId,
      userName: e.userName ?? undefined,
      userEmail: e.userEmail ?? undefined,
      source: e.source,
      amountPaid: num(e.amountPaid) ?? undefined,
      enrolledAt: e.enrolledAt,
    }));
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async toEntity(s: SeriesWithTree): Promise<TestSeriesEntity> {
    const now = new Date();
    const published = s.status === TestSeriesStatus.PUBLISHED;
    const testNodes = s.nodes.filter((n) => n.kind === TestSeriesNodeKind.TEST);

    const nodes: TestSeriesNodeEntity[] = s.nodes.map((n: NodeRow) => {
      const t = n.test;
      const isTest = n.kind === TestSeriesNodeKind.TEST;
      const name = isTest ? (t?.name ?? 'Deleted test') : (n.name ?? 'Folder');
      const problems: string[] = [];
      if (isTest) {
        if (!t || t.deletedAt) problems.push('This test was deleted.');
        else if (t.status !== TestStatus.PUBLISHED) problems.push('This test is not published yet.');
        problems.push(...scheduleProblems(scheduleOf(n), s, 'Schedule'));
      }
      return {
        id: n.id,
        parentId: n.parentId ?? undefined,
        kind: n.kind,
        orderIndex: n.orderIndex,
        name,
        testId: n.testId ?? undefined,
        testStatus: t?.status,
        testYear: t?.year ?? undefined,
        testQuestions: t?.format.subjects.reduce((a, x) => a + x.totalQuestions, 0),
        testMarks: t?.format.subjects.reduce((a, x) => a + Number(x.totalMarks), 0),
        testDurationMinutes: t ? (t.durationMinutes ?? t.format.durationMinutes) : undefined,
        availableFrom: n.availableFrom ?? undefined,
        availableTo: n.availableTo ?? undefined,
        resultAt: n.resultAt ?? undefined,
        started: published && !!n.availableFrom && n.availableFrom <= now,
        problems,
      };
    });

    return {
      id: s.id,
      name: s.name,
      classLevel: s.classLevel ?? undefined,
      examType: s.examType ?? undefined,
      targetYear: s.targetYear ?? undefined,
      descriptionHtml: s.descriptionHtml ?? undefined,
      // Signed for a day: the bucket is private.
      coverImageUrl: s.coverImageKey ? await this.s3.getPresignedGetUrl(s.coverImageKey, 86400) : undefined,
      isPaid: s.isPaid,
      price: num(s.price) ?? undefined,
      discountedPrice: num(s.discountedPrice) ?? undefined,
      startAt: s.startAt ?? undefined,
      endAt: s.endAt ?? undefined,
      status: s.status,
      publishedAt: s.publishedAt ?? undefined,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      testCount: testNodes.length,
      folderCount: s.nodes.length - testNodes.length,
      enrolledCount: s._count.enrollments,
      nodes,
      problems: seriesPublishProblems(
        {
          name: s.name,
          classLevel: s.classLevel,
          examType: s.examType,
          targetYear: s.targetYear,
          descriptionHtml: s.descriptionHtml,
          isPaid: s.isPaid,
          price: num(s.price),
          discountedPrice: num(s.discountedPrice),
          startAt: s.startAt,
          endAt: s.endAt,
        },
        testNodes.map((n) => ({
          testName: n.test?.name ?? 'Deleted test',
          testPublished: !!n.test && !n.test.deletedAt && n.test.status === TestStatus.PUBLISHED,
          schedule: scheduleOf(n),
        })),
      ),
    };
  }

  private async findOwned(id: string, tenantId: string) {
    const s = await this.prisma.testSeries.findFirst({ where: { id, tenantId, ...notDeleted() } });
    if (!s) throw new NotFoundException(`Test series not found: ${id}`);
    return s;
  }

  private async findOwnedNode(id: string, tenantId: string) {
    const node = await this.prisma.testSeriesNode.findFirst({
      where: { id, series: { tenantId, ...notDeleted() } },
      include: { series: true },
    });
    if (!node) throw new NotFoundException(`Series item not found: ${id}`);
    return node;
  }

  private async assertParent(seriesId: string, parentId: string | null) {
    if (!parentId) return;
    const parent = await this.prisma.testSeriesNode.findFirst({ where: { id: parentId, seriesId } });
    if (!parent) throw new NotFoundException('That folder is not in this series.');
    if (parent.kind !== TestSeriesNodeKind.FOLDER) throw new BadRequestException('Items can only go inside a folder.');
  }

  private async nextOrder(seriesId: string, parentId: string | null) {
    const last = await this.prisma.testSeriesNode.findFirst({
      where: { seriesId, parentId },
      orderBy: [{ orderIndex: 'desc' }],
      select: { orderIndex: true },
    });
    return (last?.orderIndex ?? -1) + 1;
  }
}
