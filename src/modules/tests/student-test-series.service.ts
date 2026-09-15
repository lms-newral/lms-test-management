import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TestSeriesNodeKind,
  TestSeriesStatus,
  TestStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { notDeleted } from 'src/prisma/soft-delete';
import { S3Service } from 'src/common/services/s3.service';
import type { AuthenticatedUser } from 'src/common/interfaces/auth.interface';
import {
  enrollProblem,
  payableOf,
  seriesReadable,
  testState,
} from './test-series.logic';
import {
  StudentSeriesNodeEntity,
  StudentTestSeriesEntity,
} from './entities/student-test-series.entities';

const studentInclude = (userId: string) =>
  ({
    enrollments: { where: { userId }, select: { enrolledAt: true } },
    nodes: {
      orderBy: [{ orderIndex: 'asc' as const }],
      include: {
        test: {
          select: {
            id: true,
            name: true,
            status: true,
            deletedAt: true,
            durationMinutes: true,
            syllabi: { select: { formatSubjectId: true, syllabusHtml: true } },
            format: {
              select: {
                durationMinutes: true,
                instructionsHtml: true,
                subjects: {
                  orderBy: [{ orderIndex: 'asc' as const }],
                  select: {
                    id: true,
                    subjectName: true,
                    totalQuestions: true,
                    totalMarks: true,
                    sections: {
                      orderBy: [{ orderIndex: 'asc' as const }],
                      select: {
                        name: true,
                        rows: {
                          orderBy: [{ orderIndex: 'asc' as const }],
                          select: {
                            questionTypeCode: true,
                            questionCount: true,
                            attemptLimit: true,
                            marksPerQuestion: true,
                            negativeMarks: true,
                            partialMarking: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }) satisfies Prisma.TestSeriesInclude;

type StudentSeries = Prisma.TestSeriesGetPayload<{
  include: ReturnType<typeof studentInclude>;
}>;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/**
 * Test series as students see them. Only published series inside their window,
 * and only tests that are published and fully scheduled. Enrollment lives here;
 * payment lives in the main backend, which enrolls paid students through the
 * internal controller.
 */
@Injectable()
export class StudentTestSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async list(
    user: AuthenticatedUser,
    enrolledOnly: boolean,
  ): Promise<StudentTestSeriesEntity[]> {
    const now = new Date();
    const rows = await this.prisma.testSeries.findMany({
      where: {
        tenantId: user.tenantId,
        ...notDeleted(),
        // Browsing shows what is on sale now; a student's own series stay theirs after they end.
        ...(enrolledOnly
          ? {
              publishedAt: { not: null },
              enrollments: { some: { userId: user.userId } },
            }
          : {
              status: TestSeriesStatus.PUBLISHED,
              startAt: { lte: now },
              endAt: { gte: now },
            }),
      },
      include: studentInclude(user.userId),
      orderBy: [{ publishedAt: 'desc' }],
    });
    return Promise.all(rows.map((s) => this.toEntity(s, now, false)));
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<StudentTestSeriesEntity> {
    const now = new Date();
    const s = await this.prisma.testSeries.findFirst({
      where: { id, tenantId: user.tenantId, ...notDeleted() },
      include: studentInclude(user.userId),
    });
    if (!s || !seriesReadable(s, now, s.enrollments.length > 0)) {
      throw new NotFoundException('This test series is not available.');
    }
    return this.toEntity(s, now, true, user.userId);
  }

  async enrollFree(
    seriesId: string,
    user: AuthenticatedUser,
  ): Promise<StudentTestSeriesEntity> {
    const now = new Date();
    const s = await this.prisma.testSeries.findFirst({
      where: { id: seriesId, tenantId: user.tenantId, ...notDeleted() },
      include: {
        enrollments: { where: { userId: user.userId }, select: { id: true } },
      },
    });
    if (!s) throw new NotFoundException('This test series is not available.');
    const problem = enrollProblem(s, now, s.enrollments.length > 0);
    if (problem) throw new BadRequestException(problem);

    await this.prisma.testSeriesEnrollment.createMany({
      data: [
        {
          tenantId: user.tenantId,
          seriesId,
          userId: user.userId,
          userName:
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            user.email,
          userEmail: user.email,
          source: 'FREE',
        },
      ],
      skipDuplicates: true,
    });
    return this.findOne(seriesId, user);
  }

  private async toEntity(
    s: StudentSeries,
    now: Date,
    withTree: boolean,
    userId?: string,
  ): Promise<StudentTestSeriesEntity> {
    // Tests a student may see: published, not deleted, fully scheduled.
    const testNodes = s.nodes.filter(
      (n) =>
        n.kind === TestSeriesNodeKind.TEST &&
        n.test &&
        !n.test.deletedAt &&
        n.test.status === TestStatus.PUBLISHED &&
        testState(n, now) !== 'NOT_SCHEDULED',
    );
    const shown = new Set(testNodes.map((n) => n.id));
    // A folder is shown when anything inside it is.
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of s.nodes) {
        if (n.parentId && shown.has(n.id) && !shown.has(n.parentId)) {
          shown.add(n.parentId);
          grew = true;
        }
      }
    }

    const states = testNodes.map((n) => testState(n, now));
    const upcoming = testNodes
      .filter((n) => n.availableFrom! > now)
      .map((n) => n.availableFrom!);

    // One attempt per student per test, whichever series it was taken in.
    const attempts =
      withTree && userId && testNodes.length
        ? await this.prisma.examAttempt.findMany({
            where: { userId, testId: { in: testNodes.map((n) => n.test!.id) } },
            select: { testId: true, status: true },
          })
        : [];
    const attemptOf = new Map(
      attempts.map((a) => [a.testId, a.status as string]),
    );

    const nodes: StudentSeriesNodeEntity[] = withTree
      ? s.nodes
          .filter((n) => shown.has(n.id))
          .map((n) => {
            const t = n.test;
            if (n.kind !== TestSeriesNodeKind.TEST || !t) {
              return {
                id: n.id,
                parentId: n.parentId ?? undefined,
                kind: n.kind,
                name: n.name ?? 'Folder',
                orderIndex: n.orderIndex,
              };
            }
            const subjects = t.format.subjects;
            return {
              id: n.id,
              parentId: n.parentId ?? undefined,
              kind: n.kind,
              name: t.name,
              orderIndex: n.orderIndex,
              test: {
                testId: t.id,
                durationMinutes: t.durationMinutes ?? t.format.durationMinutes,
                totalQuestions: subjects.reduce(
                  (a, x) => a + x.totalQuestions,
                  0,
                ),
                totalMarks: subjects.reduce(
                  (a, x) => a + Number(x.totalMarks),
                  0,
                ),
                subjects: subjects.map((x) => ({
                  name: x.subjectName,
                  questions: x.totalQuestions,
                  marks: Number(x.totalMarks),
                  syllabusHtml:
                    t.syllabi.find((y) => y.formatSubjectId === x.id)
                      ?.syllabusHtml ?? undefined,
                })),
                marking: subjects.flatMap((x) =>
                  x.sections.flatMap((sec) =>
                    sec.rows.map((r) => ({
                      subjectName: x.subjectName,
                      sectionName: sec.name,
                      questionTypeCode: r.questionTypeCode,
                      questionCount: r.questionCount,
                      attemptLimit: r.attemptLimit ?? undefined,
                      marksPerQuestion: Number(r.marksPerQuestion),
                      negativeMarks: Number(r.negativeMarks),
                      partialMarking: r.partialMarking,
                    })),
                  ),
                ),
                instructionsHtml: t.format.instructionsHtml ?? undefined,
                availableFrom: n.availableFrom!,
                availableTo: n.availableTo!,
                resultAt: n.resultAt!,
                state: testState(n, now),
                attemptStatus: attemptOf.get(t.id),
              },
            };
          })
      : [];

    const price = num(s.price);
    const discountedPrice = num(s.discountedPrice);
    return {
      id: s.id,
      name: s.name,
      classLevel: s.classLevel ?? undefined,
      examType: s.examType ?? undefined,
      targetYear: s.targetYear ?? undefined,
      descriptionHtml: withTree ? (s.descriptionHtml ?? undefined) : undefined,
      coverImageUrl: s.coverImageKey
        ? await this.s3.getPresignedGetUrl(s.coverImageKey, 86400)
        : undefined,
      isPaid: s.isPaid,
      price: price ?? undefined,
      discountedPrice: discountedPrice ?? undefined,
      payable: payableOf({ isPaid: s.isPaid, price, discountedPrice }),
      startAt: s.startAt!,
      endAt: s.endAt!,
      isEnrolled: s.enrollments.length > 0,
      enrolledAt: s.enrollments[0]?.enrolledAt,
      testCount: testNodes.length,
      folderCount: s.nodes.filter(
        (n) => n.kind === TestSeriesNodeKind.FOLDER && shown.has(n.id),
      ).length,
      liveCount: states.filter((x) => x === 'LIVE').length,
      upcomingCount: states.filter((x) => x === 'UPCOMING').length,
      completedCount: states.filter(
        (x) => x === 'AWAITING_RESULT' || x === 'RESULT_OUT',
      ).length,
      nextTestAt: upcoming.length
        ? new Date(Math.min(...upcoming.map((x) => x.getTime())))
        : undefined,
      nodes,
      serverTime: now,
    };
  }
}
